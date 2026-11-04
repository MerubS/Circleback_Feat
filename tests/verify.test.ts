/**
 * These tests use a fake AI ("FakeReader") that returns hand-written answers,
 * so they check the referee's rules without calling OpenAI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AiCommitment, AiItemMatch, AiReading, Meeting } from "@/lib/types";
import { verifyMeeting, type Reader } from "@/lib/verify";
import { referee } from "@/lib/verify/referee";
import { namesMatch } from "@/lib/verify/text";
import { timeScale } from "@/lib/circleback/api";

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
    { id: "s8", speaker: "Ana Diaz", start: 32, end: 35, text: "Raj and I will split the onboarding docs." },
    { id: "s9", speaker: "Ana Diaz", start: 36, end: 38, text: "Sam's got the release notes." },
    { id: "s10", speaker: "Kenji Sato", start: 39, end: 42, text: "来週までに見積もりを送ります。" },
    { id: "s11", speaker: "José Núñez", start: 43, end: 46, text: "Sí, yo me encargo de la migración." },
    { id: "s12", speaker: "Participant 3", start: 47, end: 55, text: "Okay team, the agenda is long today, so to keep moving, Steph, your part is the user friendliness." },
    { id: "s13", speaker: "Daniel Kim", start: 56, end: 59, text: "I'll write the migration guide this week." },
  ],
  actionItems: [],
};

const item = (id: string, title: string, owner?: string) => ({ id, title, assignee: owner ? { name: owner } : null });
const commit = (c: Partial<AiCommitment> & Pick<AiCommitment, "id" | "owners" | "statement">): AiCommitment => ({
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

const fix = commit({ id: "c1", owners: ["Raj Patel"], statement: { segmentId: "s2", quote: "I'll fix the Safari export bug" } });

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
  assert.deepEqual(r.verdicts[0].suggestion?.action, "reassign");
  assert.deepEqual(r.verdicts[0].suggestion?.owners, [{ name: "Raj Patel", speaker: "Raj Patel", confirmed: true }]);
  assert.equal(r.verdicts[0].suggestion?.evidence[0].segmentId, "s2");
});

test("shared task: assignee is one of two owners, the other is suggested as co-owner", () => {
  const split = commit({ id: "c4", owners: ["Ana Diaz", "Raj Patel"], statement: { segmentId: "s8", quote: "Raj and I will split the onboarding docs" } });
  const r = run([item("a", "Write onboarding docs", "Raj Patel")], {
    commitments: [split],
    items: [match({ actionItemId: "a", commitmentId: "c4", taskSupport: "supported" })],
  });
  assert.equal(r.verdicts[0].owner, "NOT_ACKNOWLEDGED"); // Raj was named but never said yes
  assert.equal(r.verdicts[0].suggestion?.action, "add_owners");
  assert.deepEqual(r.verdicts[0].suggestion?.owners, [{ name: "Ana Diaz", speaker: "Ana Diaz", confirmed: true }]);
});

test("someone agrees for another person: reassign to them, marked unconfirmed", () => {
  const proxy = commit({ id: "c5", kind: "volunteered_other", owners: ["Sam"], statement: { segmentId: "s9", quote: "Sam's got the release notes" }, ownerResponse: "no_response" });
  const r = run([item("a", "Write release notes", "Raj Patel")], {
    commitments: [proxy],
    items: [match({ actionItemId: "a", commitmentId: "c5", taskSupport: "supported" })],
  });
  assert.equal(r.verdicts[0].owner, "SOMEONE_ELSE");
  assert.deepEqual(r.verdicts[0].suggestion, {
    action: "reassign",
    owners: [{ name: "Sam", speaker: undefined, confirmed: false }],
    evidence: [{ segmentId: "s9", quote: "Sam's got the release notes", speaker: "Ana Diaz", start: 36 }],
  });
});

test("a 'self' promise that doesn't list its speaker is a hand-out: the speaker isn't suggested as owner", () => {
  const handout = commit({ id: "c7", owners: ["Raj Patel"], statement: { segmentId: "s3", quote: "Raj, can you also update the changelog?" } });
  const r = run([item("a", "Update changelog", "Raj Patel")], {
    commitments: [handout],
    items: [match({ actionItemId: "a", commitmentId: "c7", taskSupport: "supported" })],
  });
  assert.equal(r.verdicts[0].owner, "NOT_ACKNOWLEDGED");
  assert.equal(r.verdicts[0].suggestion, undefined);
});

test("an owner who doesn't speak and isn't named in the quote is rejected", () => {
  const made = commit({ id: "c6", kind: "volunteered_other", owners: ["Lena"], statement: { segmentId: "s9", quote: "Sam's got the release notes" } });
  const r = run([item("a", "Write release notes", "Raj Patel")], {
    commitments: [made],
    items: [match({ actionItemId: "a", commitmentId: "c6", taskSupport: "supported" })],
  });
  assert.equal(r.verdicts[0].suggestion, undefined);
  assert.match(r.notes.join(" "), /"Lena" doesn't speak and isn't named/);
});

test("made-up quote is thrown out and the item becomes unsupported", () => {
  const r = run([item("a", "Ship it Friday", "Raj Patel")], {
    commitments: [commit({ id: "c1", owners: ["Raj Patel"], statement: { segmentId: "s2", quote: "I promise to ship it Friday" } })],
    items: [match({ actionItemId: "a", commitmentId: "c1", taskSupport: "supported", evidence: [{ segmentId: "s2", quote: "ship it Friday" }] })],
  });
  assert.equal(r.verdicts[0].task, "UNSUPPORTED");
  assert.equal(r.verdicts[0].evidence.length, 0);
  assert.match(r.notes.join(" "), /quote not found/);
});

test("a quote with the line's own 'Speaker:' prefix still counts; another speaker's prefix doesn't", () => {
  const ok = run([item("a", "Fix Safari export", "Raj Patel")], {
    commitments: [commit({ id: "c1", owners: ["Raj Patel"], statement: { segmentId: "s2", quote: "Raj Patel: I'll fix the Safari export bug" } })],
    items: [match({ actionItemId: "a", commitmentId: "c1", taskSupport: "supported" })],
  });
  assert.equal(ok.verdicts[0].owner, "CONFIRMED");
  assert.equal(ok.verdicts[0].evidence[0].quote, "I'll fix the Safari export bug");
  const bad = run([item("a", "Fix Safari export", "Raj Patel")], {
    commitments: [commit({ id: "c1", owners: ["Raj Patel"], statement: { segmentId: "s2", quote: "Ana Diaz: I'll fix the Safari export bug" } })],
    items: [match({ actionItemId: "a", commitmentId: "c1", taskSupport: "supported" })],
  });
  assert.equal(bad.verdicts[0].task, "UNSUPPORTED");
});

test("'supported' with no verified commitment is downgraded to weak", () => {
  const r = run([item("a", "Redo pricing page", "Ana Diaz")], {
    items: [match({ actionItemId: "a", taskSupport: "supported", evidence: [{ segmentId: "s5", quote: "redo the pricing page" }] })],
  });
  assert.equal(r.verdicts[0].task, "WEAK");
});

const changelog = (ownerResponse: AiCommitment["ownerResponse"]) =>
  commit({
    id: "c2",
    kind: "assigned",
    owners: ["Raj Patel"],
    statement: { segmentId: "s3", quote: "can you also update the changelog?" },
    response: { segmentId: "s4", quote: "not sure I have time" },
    ownerResponse,
  });

test("owner reply: only a clear yes confirms; a maybe is weak; a no is declined", () => {
  const owner = (r: AiCommitment["ownerResponse"]) =>
    run([item("a", "Update changelog", "Raj Patel")], {
      commitments: [changelog(r)],
      items: [match({ actionItemId: "a", commitmentId: "c2", taskSupport: "supported" })],
    }).verdicts[0].owner;
  assert.equal(owner("committed"), "CONFIRMED");
  assert.equal(owner("hedged"), "WEAK");
  assert.equal(owner("declined"), "DECLINED");
  assert.equal(owner("no_response"), "NOT_ACKNOWLEDGED");
});

test("a hedged promise of their own ('I might') is weak, not confirmed", () => {
  const r = run([item("a", "Fix Safari export", "Raj Patel")], {
    commitments: [{ ...fix, ownerResponse: "hedged" }],
    items: [match({ actionItemId: "a", commitmentId: "c1", taskSupport: "supported" })],
  });
  assert.equal(r.verdicts[0].owner, "WEAK");
});

test("a task the owner declined is not reported as possibly missed", () => {
  const r = run([], { commitments: [changelog("declined")] });
  assert.equal(r.missed.length, 0);
});

test("assigned, the 'reply' came from someone else: never acknowledged", () => {
  const r = run([item("a", "Update changelog", "Raj Patel")], {
    commitments: [
      commit({
        id: "c2",
        kind: "assigned",
        owners: ["Raj Patel"],
        statement: { segmentId: "s3", quote: "update the changelog" },
        response: { segmentId: "s5", quote: "Over to you" },
        ownerResponse: "committed",
      }),
    ],
    items: [match({ actionItemId: "a", commitmentId: "c2", taskSupport: "supported" })],
  });
  assert.equal(r.verdicts[0].owner, "NOT_ACKNOWLEDGED");
});

test("placeholder owner stays unidentified without a verified name", () => {
  const survey = commit({ id: "c3", owners: ["Participant 3"], statement: { segmentId: "s6", quote: "I'll send the survey results" } });
  const r = run([item("a", "Send survey results", "Participant 3")], {
    commitments: [survey],
    items: [match({ actionItemId: "a", commitmentId: "c3", taskSupport: "supported" })],
  });
  assert.equal(r.verdicts[0].owner, "UNIDENTIFIED");
});

test("AI names a placeholder speaker from a hand-over line, and the owner is confirmed", () => {
  const survey = commit({ id: "c3", owners: ["Participant 3"], statement: { segmentId: "s6", quote: "I'll send the survey results" } });
  const r = run([item("a", "Send survey results", "Mei")], {
    speakers: [{ speaker: "Participant 3", name: "Mei", how: "named_by_other", evidence: { segmentId: "s5", quote: "Over to you, Mei." }, reasoning: "" }],
    commitments: [survey],
    items: [match({ actionItemId: "a", commitmentId: "c3", taskSupport: "supported" })],
  });
  assert.deepEqual(r.speakers.find((s) => s.speaker === "Participant 3")?.name, "Mei");
  assert.equal(r.verdicts[0].owner, "CONFIRMED");
});

test("speaker guesses are rejected when the quote lacks the name or renames a real person", () => {
  const r = run([], {
    speakers: [
      { speaker: "Participant 3", name: "Mei", how: "named_by_other", evidence: { segmentId: "s6", quote: "Thanks." }, reasoning: "" },
      { speaker: "Ana Diaz", name: "Anna", how: "self_intro", evidence: { segmentId: "s1", quote: "The export button" }, reasoning: "" },
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
    commitments: [fix, commit({ id: "c3", owners: ["Participant 3"], statement: { segmentId: "s6", quote: "I'll send the survey results by Friday" } })],
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

test("quotes in any language are checked (accents, Japanese)", () => {
  const r = run([item("a", "Send the quote", "Kenji Sato"), item("b", "Own the migration", "José Núñez")], {
    commitments: [
      commit({ id: "j", owners: ["Kenji Sato"], statement: { segmentId: "s10", quote: "見積もりを送ります" } }),
      commit({ id: "e", owners: ["José Núñez"], statement: { segmentId: "s11", quote: "yo me encargo de la migración" } }),
    ],
    items: [
      match({ actionItemId: "a", commitmentId: "j", taskSupport: "supported" }),
      match({ actionItemId: "b", commitmentId: "e", taskSupport: "supported" }),
    ],
  });
  assert.deepEqual(r.verdicts.map((v) => [v.task, v.owner]), [["SUPPORTED", "CONFIRMED"], ["SUPPORTED", "CONFIRMED"]]);
});

test("very short, punctuation-only, made-up non-Latin, and mid-word quotes are rejected", () => {
  const r = run([item("a", "Fix Safari export", "Raj Patel")], {
    items: [
      match({
        actionItemId: "a",
        taskSupport: "weak",
        evidence: [
          { segmentId: "s2", quote: "fix" }, // one word of a longer line
          { segmentId: "s2", quote: "..." }, // punctuation only
          { segmentId: "s10", quote: "会議を延期します" }, // not in the line (used to normalize to "" and match anything)
          { segmentId: "s1", quote: "port button" }, // inside "export button"
        ],
      }),
    ],
  });
  assert.equal(r.verdicts[0].task, "UNSUPPORTED");
  assert.equal(r.verdicts[0].evidence.length, 0);
});

test("a paraphrased quote makes the task weak, not unsupported", () => {
  const r = run([item("a", "Fix Safari export", "Raj Patel")], {
    commitments: [commit({ id: "p", owners: ["Raj Patel"], statement: { segmentId: "s2", quote: "I'll fix the Safari export problem tomorrow" } })],
    items: [match({ actionItemId: "a", commitmentId: "p", taskSupport: "supported" })],
  });
  assert.equal(r.verdicts[0].task, "WEAK");
  assert.equal(r.verdicts[0].evidence[0].fuzzy, true);
  const unrelated = run([item("a", "Fix Safari export", "Raj Patel")], {
    commitments: [commit({ id: "p", owners: ["Raj Patel"], statement: { segmentId: "s2", quote: "we will hire two designers" } })],
    items: [match({ actionItemId: "a", commitmentId: "p", taskSupport: "supported" })],
  });
  assert.equal(unrelated.verdicts[0].task, "UNSUPPORTED");
});

test("an item the AI skipped is 'not checked', not unsupported", () => {
  const r = run([item("a", "Fix Safari export", "Raj Patel")], {});
  assert.equal(r.verdicts[0].task, "NOT_CHECKED");
});

test("a speaker who says a name mid-sentence isn't given that name", () => {
  const r = run([], {
    speakers: [{ speaker: "Participant 3", name: "Steph", how: "self_intro", evidence: { segmentId: "s12", quote: "Steph, your part is the user friendliness" }, reasoning: "" }],
  });
  assert.equal(r.speakers.find((s) => s.speaker === "Participant 3"), undefined);
});

test("self-introductions count even deep in a long line; talking to someone doesn't", () => {
  const long = (text: string): Meeting => ({ ...meeting, transcript: [{ id: "x", speaker: "Participant 3", start: 0, end: 9, text }] });
  const guess = (how: "self_intro" | "named_by_other", quote: string): AiReading => ({
    speakers: [{ speaker: "Participant 3", name: "Elima", how, evidence: { segmentId: "x", quote }, reasoning: "" }],
    commitments: [],
    items: [],
  });
  const intro = "Right, so I'm supposed to draw my favorite animal. I have no drawing skills. My name is Elima.";
  assert.equal(referee(long(intro), guess("self_intro", "My name is Elima")).speakers[0]?.name, "Elima");
  const addressed = "Okay, thanks everyone. That Elima is your part, the user-friendliness.";
  assert.equal(referee(long(addressed), guess("named_by_other", "That Elima is your part")).speakers.length, 0);
});

test("short first names match full names: Dan owns Daniel Kim's promise", () => {
  const r = run([item("a", "Write migration guide", "Dan")], {
    commitments: [commit({ id: "d", owners: ["Daniel Kim"], statement: { segmentId: "s13", quote: "I'll write the migration guide this week" } })],
    items: [match({ actionItemId: "a", commitmentId: "d", taskSupport: "supported" })],
  });
  assert.equal(r.verdicts[0].owner, "CONFIRMED");
});

test("name matching: loose on first names, strict on different people and placeholders", () => {
  assert.ok(namesMatch("Dan", "Daniel Kim"));
  assert.ok(namesMatch("Dan K", "Daniel Kim"));
  assert.ok(!namesMatch("Dan Lee", "Daniel Kim"));
  assert.ok(!namesMatch("Al", "Alice"));
  assert.ok(!namesMatch("Participant 1", "Participant 12"));
});

test("Circleback API times: milliseconds are detected once per meeting", () => {
  assert.equal(timeScale([{ start: 9000, end: 12000 }, { start: 5_400_000, end: 5_401_000 }]), 1000);
  assert.equal(timeScale([{ start: 9, end: 12 }, { start: 5400, end: 5401 }]), 1);
});
