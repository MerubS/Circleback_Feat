import type { Judgment } from "@/lib/types";
import { retrieve } from "../retrieve";
import type { Judge } from "./types";

const COMMIT = /\b(i'll|i will|i can (?!'t)|i'm going to|i am going to|on it|will do|i've got it|i got it)\b/i;
const HEDGE = /\b(can't|cannot|not sure|let me check|maybe|someday|at some point|probably)\b/i;

/**
 * Offline judge: lexical retrieval + commitment phrases. No API calls, so the
 * app and tests run without a key. It is the baseline the LLM judge is scored against.
 */
export const heuristicJudge: Judge = {
  name: "heuristic",
  async judge({ item, meeting }) {
    const query = `${item.title} ${item.description ?? ""}`;
    const hits = retrieve(query, meeting.transcript, 6);
    const relevant = hits.filter((h) => h.coverage >= 0.34);

    if (relevant.length === 0) {
      return none(hits.length ? "Only weak keyword overlap with the transcript." : "No related lines found.");
    }

    const idx = new Map(meeting.transcript.map((s, i) => [s.id, i]));
    // A commitment line must itself mention the task, not just sit next to it.
    const commit = relevant.find(
      (h) => h.ownCoverage >= 0.25 && COMMIT.test(h.segment.text) && !HEDGE.test(h.segment.text),
    );
    const top = relevant[0].segment;

    if (commit) {
      const assignee = item.assignee?.name ?? "";
      // Look one line ahead for the assignee saying yes after being volunteered.
      const next = meeting.transcript[(idx.get(commit.segment.id) ?? -2) + 1];
      const agree =
        next && assignee && next.speaker === assignee && /\b(yes|yep|sure|sounds good|will do|on it)\b/i.test(next.text) && !HEDGE.test(next.text)
          ? next.id
          : null;
      return {
        topic: "explicit_commitment",
        commitmentSegmentId: commit.segment.id,
        ownerAgreementSegmentId: agree,
        evidence: [{ segmentId: commit.segment.id, quote: commit.segment.text }],
        rationale: `${commit.segment.speaker} commits in a line that covers ${Math.round(commit.coverage * 100)}% of the item's key words.`,
      };
    }
    return {
      topic: "discussed_no_commitment",
      commitmentSegmentId: null,
      ownerAgreementSegmentId: null,
      evidence: [{ segmentId: top.id, quote: top.text }],
      rationale: "The topic comes up, but no line contains a clear commitment.",
    };
  },
};

function none(rationale: string): Judgment {
  return { topic: "not_discussed", commitmentSegmentId: null, ownerAgreementSegmentId: null, evidence: [], rationale };
}
