import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { z } from "zod";
import type { AiReading, Meeting } from "@/lib/types";
import { isGenericSpeaker } from "./text";

/** Anything that can read a meeting and report facts. The real one calls OpenAI; tests use a fake. */
export interface Reader {
  model: string;
  read(meeting: Meeting): Promise<AiReading>;
}

// ---------- Output format the model must follow ----------

const QuoteZ = z.object({ segmentId: z.string(), quote: z.string() });
export const ReadingZ = z.object({
  speakers: z.array(z.object({ speaker: z.string(), name: z.string(), evidence: QuoteZ, reasoning: z.string() })),
  commitments: z.array(
    z.object({
      id: z.string(),
      task: z.string(),
      kind: z.enum(["self", "assigned", "volunteered_other"]),
      ownerSpeaker: z.string(),
      statement: QuoteZ,
      response: QuoteZ.nullable(),
      ownerResponse: z.enum(["agreed", "declined_or_hedged", "no_response", "not_applicable"]),
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
          required: ["speaker", "name", "evidence", "reasoning"],
          properties: { speaker: { type: "string" }, name: { type: "string" }, evidence: quote, reasoning: { type: "string" } },
        },
      },
      commitments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "task", "kind", "ownerSpeaker", "statement", "response", "ownerResponse"],
          properties: {
            id: { type: "string" },
            task: { type: "string" },
            kind: { type: "string", enum: ["self", "assigned", "volunteered_other"] },
            ownerSpeaker: { type: "string" },
            statement: quote,
            response: { anyOf: [quote, { type: "null" }] },
            ownerResponse: { type: "string", enum: ["agreed", "declined_or_hedged", "no_response", "not_applicable"] },
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
   Give the single line that shows it. The quote MUST contain the name. Skip a speaker if you are not sure. Never rename real names.

2. commitments: list every task someone in the meeting took on or was given. Include tasks that are NOT in the action item list.
   - kind "self": the speaker commits themselves ("I'll send the deck").
   - kind "assigned": someone gives the task to a specific person ("as the designer you'll do the mockups", "can you take this, Sam?").
   - kind "volunteered_other": someone suggests a colleague without asking them ("Lena can run the training").
   ownerSpeaker = the transcript speaker label of the person who would do the task.
   statement = the line that makes the commitment or assignment.
   response = the owner's reply right after, if any; ownerResponse = agreed, declined_or_hedged ("let me check", "not sure"), no_response, or not_applicable for kind "self".
   Not commitments: vague ideas ("we should", "someday", "at some point"), questions, and small talk.
   Transcripts can split one sentence across two speakers by mistake (e.g. "I'll" then "look into it"). Use context.

3. items: for EVERY action item, give one entry.
   - commitmentId: the matching commitment, or null.
   - taskSupport: supported (matches a commitment), weak (discussed but nobody took it on), contradicted (transcript says the opposite, e.g. a discount was refused), unsupported (not discussed).
   - evidence: up to 3 lines that show it.
   - rationale: one or two plain sentences.

Every quote must be copied EXACTLY from the line whose segmentId you give. A short exact phrase is better than a long paraphrase.`;

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
