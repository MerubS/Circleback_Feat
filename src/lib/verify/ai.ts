import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { z } from "zod";
import { OWNER_RESPONSES, type AiReading, type Meeting } from "@/lib/types";
import { isGenericSpeaker } from "./text";

/** Anything that can read a meeting and report facts. The real one calls OpenAI; tests use a fake. */
export interface Reader {
  model: string;
  read(meeting: Meeting): Promise<AiReading>;
}

// ---------- Output format the model must follow ----------

const QuoteZ = z.object({ segmentId: z.string(), quote: z.string() });
export const ReadingZ = z.object({
  speakers: z.array(z.object({ speaker: z.string(), name: z.string(), how: z.enum(["self_intro", "named_by_other"]), evidence: QuoteZ, reasoning: z.string() })),
  commitments: z.array(
    z.object({
      id: z.string(),
      task: z.string(),
      kind: z.enum(["self", "assigned", "volunteered_other"]),
      owners: z.array(z.string()),
      statement: QuoteZ,
      response: QuoteZ.nullable(),
      ownerResponse: z.enum(OWNER_RESPONSES),
    }),
  ),
  items: z.array(
    z.object({
      actionItemId: z.string(),
      commitmentId: z.string().nullable(),
      taskSupport: z.enum(["supported", "weak", "unsupported", "contradicted"]),
      evidence: z.array(QuoteZ),
      rationale: z.string(),
    }),
  ),
});

const quote = {
  type: "object",
  additionalProperties: false,
  required: ["segmentId", "quote"],
  properties: { segmentId: { type: "string" }, quote: { type: "string" } },
};

const JSON_SCHEMA = {
  name: "meeting_reading",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["speakers", "commitments", "items"],
    properties: {
      speakers: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["speaker", "name", "how", "evidence", "reasoning"],
          properties: {
            speaker: { type: "string" },
            name: { type: "string" },
            how: { type: "string", enum: ["self_intro", "named_by_other"] },
            evidence: quote,
            reasoning: { type: "string" },
          },
        },
      },
      commitments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "task", "kind", "owners", "statement", "response", "ownerResponse"],
          properties: {
            id: { type: "string" },
            task: { type: "string" },
            kind: { type: "string", enum: ["self", "assigned", "volunteered_other"] },
            owners: { type: "array", items: { type: "string" } },
            statement: quote,
            response: { anyOf: [quote, { type: "null" }] },
            ownerResponse: { type: "string", enum: [...OWNER_RESPONSES] },
          },
        },
      },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["actionItemId", "commitmentId", "taskSupport", "evidence", "rationale"],
          properties: {
            actionItemId: { type: "string" },
            commitmentId: { type: ["string", "null"] },
            taskSupport: { type: "string", enum: ["supported", "weak", "unsupported", "contradicted"] },
            evidence: { type: "array", items: quote },
            rationale: { type: "string" },
          },
        },
      },
    },
  },
} as const;

// ---------- Instructions ----------

export const SYSTEM_PROMPT = `You check AI-written meeting action items against the meeting transcript.
Transcript lines look like: [segmentId] Speaker: text
Speakers may be real names or placeholders like "Participant 2".

Do three things.

1. speakers: for each placeholder speaker ("Participant N") ONLY, say who they are if the transcript makes it clear.
   Good evidence: they introduce themselves ("I'm Rose"), or someone hands over to them by name ("take it away, Poppy") and they speak next.
   how = "self_intro" when the speaker names THEMSELVES, or "named_by_other" when a different speaker names them.
   Careful: a speaker saying a name is usually talking TO that person ("Steph, your part is the design"), which tells you nothing about the speaker.
   Give the single line that shows it. The quote MUST contain the name. Skip a speaker if you are not sure. Never rename real names.

2. commitments: list every task someone in the meeting took on or was given. Include tasks that are NOT in the action item list.
   - kind "self": the speaker commits themselves ("I'll send the deck").
   - kind "assigned": someone gives the task to a specific person ("as the designer you'll do the mockups", "can you take this, Sam?").
   - kind "volunteered_other": someone commits a colleague without asking them ("Lena can run the training", "Sam's got it").
   owners = EVERYONE who would do the task. Use the transcript speaker label for anyone who speaks in this meeting; otherwise their name exactly as said in the statement.
     "Raj and I will split it" said by Priya -> owners [Priya's label, Raj's label]. "Sam's got it" -> owners [Sam's label, or "Sam" if Sam never speaks].
   statement = the line that makes the commitment or assignment.
   response = an owner's reply right after, if any.
   ownerResponse = how firmly the owner took it on, in their OWN words:
     committed = a clear yes ("I'll do it", "yes, I'm on it", "sure, I'll send it today");
     hedged = a maybe ("I'll try", "let me check", "probably", "if I have time", a bare "mm-hmm" or "okay" that doesn't take the task on);
     declined = no ("I can't", "not me");
     no_response = the owner said nothing about it.
     For kind "self", judge the statement itself: "I'll send it" is committed, "I might look into it" is hedged.
   Quotes and statements can be in any language; copy them in the original language.
   Not commitments: vague ideas ("we should", "someday", "at some point"), questions, and small talk.
   Transcripts can split one sentence across two speakers by mistake (e.g. "I'll" then "look into it"). Use context.

3. items: for EVERY action item, give one entry.
   - commitmentId: the matching commitment, or null. Link it even if the owner only hedged: how firm the owner was is judged separately, in ownerResponse.
   - taskSupport: supported (matches a commitment or assignment, even one the owner answered with a maybe), weak (discussed but nobody took it on or was given it), contradicted (transcript says the opposite, e.g. a discount was refused), unsupported (not discussed at all).
     If you found lines about it, it is not "unsupported": use weak or contradicted.
   - evidence: up to 3 lines that show it.
   - rationale: one or two plain sentences.

Every quote must be copied EXACTLY from the line whose segmentId you give, without the "Speaker:" prefix.
Use at least two words (or the whole line). A short exact phrase is better than a long paraphrase.`;

function userPrompt(m: Meeting) {
  const generic = [...new Set(m.transcript.map((s) => s.speaker))].filter(isGenericSpeaker);
  return `Meeting: ${m.name}
Attendees: ${m.attendees.map((a) => a.name).join(", ") || "unknown"}
Placeholder speakers to identify if possible: ${generic.join(", ") || "none"}

Action items:
${m.actionItems.map((a) => `- id=${a.id} | owner=${a.assignee?.name ?? "none"} | ${a.title}${a.description ? ` (${a.description})` : ""}`).join("\n") || "(none)"}

Transcript:
${m.transcript.map((s) => `[${s.id}] ${s.speaker}: ${s.text}`).join("\n")}`;
}

// ---------- OpenAI reader with a response cache ----------

const CACHE_DIR = path.join(process.cwd(), ".data", "ai-cache");
const MAX_CHARS = 400_000; // ~100k tokens; longer meetings would need splitting

export function createOpenAIReader(opts: { apiKey?: string; model?: string; cache?: boolean } = {}): Reader {
  const model = opts.model || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const useCache = opts.cache ?? true;
  let client: OpenAI | null = null;

  return {
    model,
    async read(meeting) {
      const user = userPrompt(meeting);
      if (user.length > MAX_CHARS) throw new Error(`Transcript too long (${user.length} chars). Splitting long meetings isn't supported yet.`);

      // Same meeting + same prompt + same model = same answer, so reruns are free and repeatable.
      const key = createHash("sha256").update(model + SYSTEM_PROMPT + user).digest("hex").slice(0, 24);
      const file = path.join(CACHE_DIR, `${meeting.id.replace(/[^\w-]/g, "_")}-${key}.json`);
      if (useCache) {
        try {
          return ReadingZ.parse(JSON.parse(await readFile(file, "utf8")));
        } catch {}
      }

      const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_API_KEY is not set. Add it to .env to verify meetings.");
      client ??= new OpenAI({ apiKey });
      const res = await client.chat.completions.create({
        model,
        temperature: 0,
        response_format: { type: "json_schema", json_schema: JSON_SCHEMA },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
      });
      const reading = ReadingZ.parse(JSON.parse(res.choices[0]?.message?.content ?? "{}"));
      if (useCache) {
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(file, JSON.stringify(reading, null, 2));
      }
      return reading;
    },
  };
}
