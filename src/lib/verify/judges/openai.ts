import OpenAI from "openai";
import { z } from "zod";
import type { Judgment, Segment } from "@/lib/types";
import { retrieve } from "../retrieve";
import type { Judge } from "./types";

const JudgmentSchema = z.object({
  topic: z.enum(["explicit_commitment", "discussed_no_commitment", "contradicted", "not_discussed"]),
  commitmentSegmentId: z.string().nullable(),
  ownerAgreementSegmentId: z.string().nullable(),
  evidence: z.array(z.object({ segmentId: z.string(), quote: z.string() })).max(4),
  rationale: z.string(),
});

const JSON_SCHEMA = {
  name: "action_item_judgment",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["topic", "commitmentSegmentId", "ownerAgreementSegmentId", "evidence", "rationale"],
    properties: {
      topic: { type: "string", enum: ["explicit_commitment", "discussed_no_commitment", "contradicted", "not_discussed"] },
      commitmentSegmentId: { type: ["string", "null"] },
      ownerAgreementSegmentId: { type: ["string", "null"] },
      evidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["segmentId", "quote"],
          properties: { segmentId: { type: "string" }, quote: { type: "string" } },
        },
      },
      rationale: { type: "string" },
    },
  },
} as const;

const SYSTEM = `You audit meeting action items against the meeting transcript.
You get ONE action item and transcript lines formatted as [segmentId] Speaker: text.

Classify "topic":
- explicit_commitment: a speaker clearly agrees to do this specific task ("I'll...", "I will...", "Yes, I'll take it").
- discussed_no_commitment: the task is talked about, but nobody takes it on (suggestions, "we should", "someday", "let me check", "maybe X could").
- contradicted: the transcript says the opposite (for example the item says a discount was approved, but the speaker refused to promise one).
- not_discussed: nothing in the transcript is about this task.

Rules:
- commitmentSegmentId: the segment where someone commits, else null. Volunteering another person ("Lena can do it") is NOT a commitment.
- ownerAgreementSegmentId: a segment where the ASSIGNEE agrees, if different from the commitment line, else null.
- evidence: up to 3 quotes copied EXACTLY, character for character, from the cited segment. Short is fine. Never paraphrase.
- Do not decide whether the assignee is correct; just report who said what.
- rationale: one or two plain sentences.`;

function format(lines: Segment[]) {
  return lines.map((s) => `[${s.id}] ${s.speaker}: ${s.text}`).join("\n");
}

export function createOpenAIJudge(opts: { apiKey: string; model?: string; maxTranscriptChars?: number }): Judge {
  const client = new OpenAI({ apiKey: opts.apiKey });
  const model = opts.model || "gpt-4.1-mini";
  const maxChars = opts.maxTranscriptChars ?? 40_000;

  return {
    name: `openai:${model}`,
    async judge({ item, meeting }) {
      // Short meetings: send everything. Long ones: send the best-matching windows.
      let lines = meeting.transcript;
      if (format(lines).length > maxChars) {
        const keep = new Set<number>();
        const pos = new Map(meeting.transcript.map((s, i) => [s.id, i]));
        for (const h of retrieve(item.title, meeting.transcript, 12)) {
          const i = pos.get(h.segment.id)!;
          for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < lines.length) keep.add(j);
        }
        lines = [...keep].sort((a, b) => a - b).map((i) => meeting.transcript[i]);
      }

      const user = `Action item: "${item.title}"${item.description ? `\nDetails: ${item.description}` : ""}
Assignee: ${item.assignee?.name ?? "none"}
Attendees: ${meeting.attendees.map((a) => a.name).join(", ")}

Transcript:
${format(lines)}`;

      const res = await client.chat.completions.create({
        model,
        temperature: 0,
        response_format: { type: "json_schema", json_schema: JSON_SCHEMA },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
      });
      const raw = res.choices[0]?.message?.content ?? "{}";
      const parsed = JudgmentSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        return {
          topic: "not_discussed",
          commitmentSegmentId: null,
          ownerAgreementSegmentId: null,
          evidence: [],
          rationale: `Model output failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}`,
        } satisfies Judgment;
      }
      return parsed.data;
    },
  };
}
