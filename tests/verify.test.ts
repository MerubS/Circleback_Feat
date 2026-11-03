import { test } from "node:test";
import assert from "node:assert/strict";
import type { Judgment, Meeting } from "@/lib/types";
import { decide } from "@/lib/verify/decide";
import { ownerStatus } from "@/lib/verify/owner";
import { verifyMeeting } from "@/lib/verify";
import { heuristicJudge } from "@/lib/verify/judges/heuristic";

const meeting: Meeting = {
  id: "t1",
  name: "Test",
  createdAt: "2026-11-01T00:00:00Z",
  durationSeconds: 30,
  attendees: [{ name: "Ana Diaz" }, { name: "Raj Patel" }],
  transcript: [
    { id: "s1", speaker: "Ana Diaz", start: 0, end: 4, text: "The export button is broken on Safari." },
    { id: "s2", speaker: "Raj Patel", start: 5, end: 9, text: "I'll fix the Safari export bug tomorrow." },
    { id: "s3", speaker: "Ana Diaz", start: 10, end: 14, text: "We should redo the pricing page someday." },
  ],
  actionItems: [
    { id: "a1", title: "Fix the Safari export bug", assignee: { name: "Raj Patel" } },
    { id: "a2", title: "Redo the pricing page", assignee: { name: "Ana Diaz" } },
    { id: "a3", title: "Renew the SOC 2 audit contract", assignee: { name: "Ana Diaz" } },
    { id: "a4", title: "Fix the Safari export bug", assignee: { name: "Kim Lo" } },
    { id: "a5", title: "Fix the Safari export bug", assignee: { name: "Participant 3" } },
  ],
};

const j = (p: Partial<Judgment>): Judgment => ({
  topic: "explicit_commitment",
  commitmentSegmentId: "s2",
  ownerAgreementSegmentId: null,
  evidence: [{ segmentId: "s2", quote: "I'll fix the Safari export bug" }],
  rationale: "",
  ...p,
});

test("owner status: present, not present, unidentified, unassigned", () => {
  assert.equal(ownerStatus(meeting.actionItems[0], meeting), "present");
  assert.equal(ownerStatus(meeting.actionItems[3], meeting), "not_present");
  assert.equal(ownerStatus(meeting.actionItems[4], meeting), "unidentified");
  assert.equal(ownerStatus({ id: "x", title: "x" }, meeting), "unassigned");
});

test("supported when the assignee commits", () => {
  const v = decide(meeting.actionItems[0], meeting, "present", j({}));
  assert.equal(v.label, "SUPPORTED");
  assert.equal(v.evidence[0].start, 5);
});

test("fabricated quote is dropped and the item becomes unsupported", () => {
  const v = decide(
    meeting.actionItems[0],
    meeting,
    "present",
    j({ commitmentSegmentId: null, topic: "discussed_no_commitment", evidence: [{ segmentId: "s2", quote: "I promise to ship it Friday" }] }),
  );
  assert.equal(v.label, "UNSUPPORTED");
  assert.match(v.guardrailNotes.join(" "), /Dropped a quote/);
});

test("claimed commitment without a segment is downgraded", () => {
  const v = decide(meeting.actionItems[1], meeting, "present", j({ commitmentSegmentId: null, evidence: [{ segmentId: "s3", quote: "redo the pricing page" }] }));
  assert.equal(v.label, "WEAK");
});

test("someone else committing means owner not confirmed", () => {
  const item = { id: "z", title: "Fix the Safari export bug", assignee: { name: "Ana Diaz" } };
  assert.equal(decide(item, meeting, "present", j({})).label, "OWNER_NOT_CONFIRMED");
});

test("assignee absent from the meeting means owner not confirmed", () => {
  assert.equal(decide(meeting.actionItems[3], meeting, "not_present", j({})).label, "OWNER_NOT_CONFIRMED");
});

test("contradicted maps to unsupported", () => {
  assert.equal(decide(meeting.actionItems[0], meeting, "present", j({ topic: "contradicted" })).label, "UNSUPPORTED");
});

test("heuristic judge end to end", async () => {
  const r = await verifyMeeting(meeting, heuristicJudge);
  const got = Object.fromEntries(r.verdicts.map((v) => [v.actionItemId, v.label]));
  assert.deepEqual(got, {
    a1: "SUPPORTED",
    a2: "WEAK",
    a3: "UNSUPPORTED",
    a4: "OWNER_NOT_CONFIRMED",
    a5: "OWNER_NOT_CONFIRMED",
  });
});
