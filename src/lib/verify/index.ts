import type { Meeting, VerificationReport } from "@/lib/types";
import { decide } from "./decide";
import { heuristicJudge } from "./judges/heuristic";
import { createOpenAIJudge } from "./judges/openai";
import type { Judge } from "./judges/types";
import { ownerStatus } from "./owner";

export type { Judge } from "./judges/types";

export function defaultJudge(kind?: string): Judge {
  const want = kind ?? (process.env.OPENAI_API_KEY ? "openai" : "heuristic");
  if (want === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set. Add it to .env or use the heuristic judge.");
    return createOpenAIJudge({ apiKey, model: process.env.OPENAI_MODEL });
  }
  return heuristicJudge;
}

export async function verifyMeeting(
  meeting: Meeting,
  judge: Judge = defaultJudge(),
  concurrency = 4,
): Promise<VerificationReport> {
  const items = meeting.actionItems;
  const verdicts = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      const item = items[i];
      const owner = ownerStatus(item, meeting);
      const judgment = await judge.judge({ item, meeting, owner });
      verdicts[i] = decide(item, meeting, owner, judgment);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));

  return { meetingId: meeting.id, judge: judge.name, createdAt: new Date().toISOString(), verdicts };
}
