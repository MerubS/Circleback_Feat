/**
 * These tests use a fake AI ("FakeReader") that returns hand-written answers,
 * so they check the referee's rules without calling OpenAI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AiCommitment, AiItemMatch, AiReading, Meeting } from "@/lib/types";
import { verifyMeeting, type Reader } from "@/lib/verify";
import { referee } from "@/lib/verify/referee";

const meeting: Meeting = {
  id: "t1",
  name: "Test",
  createdAt: "2026-11-01T00:00:00Z",
  durationSeconds: 60,
  attendees: [{ name: "Ana Diaz" }, { name: "Raj Patel" }, { name: "Participant 3" }],
  transcript: [
    { id: "s1", speaker: "Ana Diaz", start: 0, end: 4, text: "The export button is broken on Safari." },
    { id: "s2", speaker: "Raj Patel", start: 5, end: 9, text: "I'll fix the Safari export bug tomorrow." },
    { id: "s3", speaker: "Ana Diaz", start: 10, end: 14, text: "Raj, can you also update the changelog?" },
    { id: "s4", speaker: "Raj Patel", start: 15, end: 17, text: "Hmm, not sure I have time this week." },
    { id: "s5", speaker: "Ana Diaz", start: 18, end: 22, text: "We should redo the pricing page someday. Over to you, Mei." },
    { id: "s6", speaker: "Participant 3", start: 23, end: 27, text: "Thanks. I'll send the survey results by Friday." },
    { id: "s7", speaker: "Ana Diaz", start: 28, end: 31, text: "No discount this quarter, sorry." },
  ],
  actionItems: [],
};

const item = (id: string, title: string, owner?: string) => ({ id, title, assignee: owner ? { name: owner } : null });
const commit = (c: Partial<AiCommitment> & Pick<AiCommitment, "id" | "ownerSpeaker" | "statement">): AiCommitment => ({
  task: "task",
  kind: "self",
  response: null,
  ownerResponse: "not_applicable",
  ...c,
});
const match = (m: Partial<AiItemMatch> & Pick<AiItemMatch, "actionItemId">): AiItemMatch => ({
  commitmentId: null,
  taskSupport: "unsupported",
  evidence: [],
  rationale: "",
  ...m,
});
const run = (items: Meeting["actionItems"], reading: Partial<AiReading>) =>
  referee({ ...meeting, actionItems: items }, { speakers: [], commitments: [], items: [], ...reading });

const fix = commit({ id: "c1", ownerSpeaker: "Raj Patel", statement: { segmentId: "s2", quote: "I'll fix the Safari export bug" } });

test("owner commits themselves: supported, owner confirmed", () => {
  const r = run([item("a", "Fix Safari export", "Raj Patel")], {
    commitments: [fix],
    items: [match({ actionItemId: "a", commitmentId: "c1", taskSupport: "supported" })],
  });
  assert.equal(r.verdicts[0].task, "SUPPORTED");
  assert.equal(r.verdicts[0].owner, "CONFIRMED");
  assert.equal(r.verdicts[0].evidence[0].segmentId, "s2");
});

test("someone else committed: owner is 'someone else'", () => {
  const r = run([item("a", "Fix Safari export", "Ana Diaz")], {
    commitments: [fix],
    items: [match({ actionItemId: "a", commitmentId: "c1", taskSupport: "supported" })],
  });
  assert.equal(r.verdicts[0].owner, "SOMEONE_ELSE");
});

test("made-up quote is thrown out and the item becomes unsupported", () => {
  const r = run([item("a", "Ship it Friday", "Raj Patel")], {
    commitments: [commit({ id: "c1", ownerSpeaker: "Raj Patel", statement: { segmentId: "s2", quote: "I promise to ship it Friday" } })],
    items: [match({ actionItemId: "a", commitmentId: "c1", taskSupport: "supported", evidence: [{ segmentId: "s2", quote: "ship it Friday" }] })],
  });
  assert.equal(r.verdicts[0].task, "UNSUPPORTED");
  assert.equal(r.verdicts[0].evidence.length, 0);
  assert.match(r.notes.join(" "), /quote not found/);
});

test("'supported' with no verified commitment is downgraded to weak", () => {
  const r = run([item("a", "Redo pricing page", "Ana Diaz")], {
    items: [match({ actionItemId: "a", taskSupport: "supported", evidence: [{ segmentId: "s5", quote: "redo the pricing page" }] })],
  });
  assert.equal(r.verdicts[0].task, "WEAK");
});

test("assigned, owner hesitates: owner declined", () => {
  const r = run([item("a", "Update changelog", "Raj Patel")], {
    commitments: [
      commit({
        id: "c2",
        kind: "assigned",
        ownerSpeaker: "Raj Patel",
        statement: { segmentId: "s3", quote: "can you also update the changelog?" },
        response: { segmentId: "s4", quote: "not sure I have time" },
        ownerResponse: "declined_or_hedged",
      }),
    ],
    items: [match({ actionItemId: "a", commitmentId: "c2", taskSupport: "supported" })],
  });
  assert.equal(r.verdicts[0].task, "SUPPORTED");
  assert.equal(r.verdicts[0].owner, "DECLINED");
});

test("assigned, the 'reply' came from someone else: never acknowledged", () => {
  const r = run([item("a", "Update changelog", "Raj Patel")], {
    commitments: [
      commit({
        id: "c2",
        kind: "assigned",
        ownerSpeaker: "Raj Patel",
        statement: { segmentId: "s3", quote: "update the changelog" },
        response: { segmentId: "s5", quote: "Over to you" },
        ownerResponse: "agreed",
      }),
    ],
    items: [match({ actionItemId: "a", commitmentId: "c2", taskSupport: "supported" })],
  });
  assert.equal(r.verdicts[0].owner, "NOT_ACKNOWLEDGED");
});

test("placeholder owner stays unidentified without a verified name", () => {
  const survey = commit({ id: "c3", ownerSpeaker: "Participant 3", statement: { segmentId: "s6", quote: "I'll send the survey results" } });
  const r = run([item("a", "Send survey results", "Participant 3")], {
    commitments: [survey],
    items: [match({ actionItemId: "a", commitmentId: "c3", taskSupport: "supported" })],
  });
  assert.equal(r.verdicts[0].owner, "UNIDENTIFIED");
});

test("AI names a placeholder speaker from a hand-over line, and the owner is confirmed", () => {
  const survey = commit({ id: "c3", ownerSpeaker: "Participant 3", statement: { segmentId: "s6", quote: "I'll send the survey results" } });
  const r = run([item("a", "Send survey results", "Mei")], {
    speakers: [{ speaker: "Participant 3", name: "Mei", evidence: { segmentId: "s5", quote: "Over to you, Mei." }, reasoning: "" }],
    commitments: [survey],
    items: [match({ actionItemId: "a", commitmentId: "c3", taskSupport: "supported" })],
  });
  assert.deepEqual(r.speakers.find((s) => s.speaker === "Participant 3")?.name, "Mei");
  assert.equal(r.verdicts[0].owner, "CONFIRMED");
});

test("speaker guesses are rejected when the quote lacks the name or renames a real person", () => {
  const r = run([], {
    speakers: [
      { speaker: "Participant 3", name: "Mei", evidence: { segmentId: "s6", quote: "Thanks." }, reasoning: "" },
      { speaker: "Ana Diaz", name: "Anna", evidence: { segmentId: "s1", quote: "The export button" }, reasoning: "" },
    ],
  });
  assert.equal(r.speakers.filter((s) => s.source === "ai").length, 0);
});

test("named owner who isn't in the meeting", () => {
  const reading = { speakers: [], commitments: [fix], items: [match({ actionItemId: "a", commitmentId: "c1", taskSupport: "supported" })] };
  const items = [item("a", "Fix Safari export", "Jordan Lee")];
  // Everyone is named: Jordan clearly wasn't there.
  const named = referee({ ...meeting, transcript: meeting.transcript.filter((s) => s.speaker !== "Participant 3"), actionItems: items }, reading);
  assert.equal(named.verdicts[0].owner, "NOT_IN_MEETING");
  // An unnamed speaker is present: Jordan might be them, so we can't say.
  assert.equal(run(items, reading).verdicts[0].owner, "UNIDENTIFIED");
});

test("contradicted needs a real quote", () => {
  const ok = run([item("a", "Give a discount", "Ana Diaz")], {
    items: [match({ actionItemId: "a", taskSupport: "contradicted", evidence: [{ segmentId: "s7", quote: "No discount this quarter" }] })],
  });
  assert.equal(ok.verdicts[0].task, "CONTRADICTED");
  const bad = run([item("a", "Give a discount", "Ana Diaz")], {
    items: [match({ actionItemId: "a", taskSupport: "contradicted", evidence: [{ segmentId: "s7", quote: "We refuse discounts" }] })],
  });
  assert.equal(bad.verdicts[0].task, "UNSUPPORTED");
});

test("a commitment with no action item is reported as possibly missed", () => {
  const r = run([item("a", "Fix Safari export", "Raj Patel")], {
    commitments: [fix, commit({ id: "c3", ownerSpeaker: "Participant 3", statement: { segmentId: "s6", quote: "I'll send the survey results by Friday" } })],
    items: [match({ actionItemId: "a", commitmentId: "c1", taskSupport: "supported" })],
  });
  assert.equal(r.missed.length, 1);
  assert.equal(r.missed[0].evidence[0].segmentId, "s6");
});

test("verifyMeeting wires the reader and referee together", async () => {
  const fake: Reader = {
    model: "fake",
    read: async () => ({ speakers: [], commitments: [fix], items: [match({ actionItemId: "a", commitmentId: "c1", taskSupport: "supported" })] }),
  };
  const report = await verifyMeeting({ ...meeting, actionItems: [item("a", "Fix Safari export", "Raj Patel")] }, fake);
  assert.equal(report.model, "fake");
  assert.equal(report.verdicts[0].owner, "CONFIRMED");
});
