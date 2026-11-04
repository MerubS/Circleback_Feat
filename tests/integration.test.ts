/**
 * Webhook intake and one-click fixes. No network: the Circleback calls are never made here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { WebhookSchema, meetingFromWebhook, verifySignature } from "@/lib/circleback/webhook";
import { planFix, openFlags, decisionKey } from "@/lib/fixes";
import type { ActionItem, ItemVerdict } from "@/lib/types";

const payload = {
  id: 4821,
  name: "Payments standup",
  createdAt: "2026-11-03T10:00:00Z",
  duration: 95.4,
  url: "https://zoom.us/j/1",
  attendees: [{ name: "Aisha Khan", email: "aisha@northwind.dev" }, { name: null, email: null }],
  actionItems: [
    { id: 31, title: "Review Ben's PR", description: "", assignee: { name: "Carlos Mendes", email: "carlos@northwind.dev" }, status: "PENDING" },
    { id: 32, title: "Old thing", assignee: null, status: "DONE" },
  ],
  transcript: [
    { speaker: "Aisha Khan", text: "Ben, once your PR is up I'll review it.", timestamp: 57.2 },
    { speaker: null, text: "Great, thanks.", timestamp: 61 },
    { speaker: "Ben", text: "   ", timestamp: 63 },
  ],
  notes: "# Notes",
  insights: {},
};

test("webhook signature: HMAC-SHA256 hex of the raw body", () => {
  const raw = JSON.stringify(payload);
  const sig = createHmac("sha256", "whsec_test").update(raw).digest("hex");
  assert.ok(verifySignature(raw, sig, "whsec_test"));
  assert.ok(!verifySignature(raw + " ", sig, "whsec_test")); // body changed
  assert.ok(!verifySignature(raw, sig, "whsec_other")); // wrong secret
  assert.ok(!verifySignature(raw, null, "whsec_test"));
  assert.ok(!verifySignature(raw, "abc", "whsec_test"));
});

test("webhook payload maps to a meeting: ids, timings, Circleback link, done items dropped", () => {
  const m = meetingFromWebhook(WebhookSchema.parse(payload));
  assert.equal(m.id, "cb-4821");
  assert.equal(m.circlebackId, "4821");
  assert.equal(m.url, "https://circleback.ai/meetings/4821"); // not the Zoom link
  assert.equal(m.durationSeconds, 95);
  assert.deepEqual(m.attendees, [{ name: "Aisha Khan", email: "aisha@northwind.dev" }]);
  assert.deepEqual(m.actionItems.map((a) => [a.id, a.assignee?.email]), [["31", "carlos@northwind.dev"]]);
  assert.deepEqual(m.transcript.map((s) => [s.id, s.speaker, s.start, s.end]), [["t1", "Aisha Khan", 57.2, 61], ["t2", "Unknown", 61, 61]]);
});

const item: ActionItem = { id: "31", title: "Review Ben's PR", description: "From standup", assignee: { name: "Carlos Mendes" } };
const ev = { segmentId: "t1", quote: "once your PR is up I'll review it", speaker: "Aisha Khan", start: 57 };
const verdict = (extra: Partial<ItemVerdict>): ItemVerdict => ({ actionItemId: "31", task: "SUPPORTED", owner: "SOMEONE_ELSE", evidence: [ev], rationale: "", notes: [], ...extra });
const today = new Date("2026-11-04T12:00:00Z");

test("accept an owner fix: assign to the suggested attendee", () => {
  const v = verdict({ suggestion: { action: "reassign", owners: [{ name: "Aisha Khan", confirmed: true, attendee: { name: "Aisha Khan", email: "aisha@northwind.dev" } }], evidence: [ev] } });
  assert.deepEqual(planFix(item, v, "owner", "accept", undefined, today), { assignTo: { name: "Aisha Khan", email: "aisha@northwind.dev" }, summary: "Assign to Aisha Khan" });
});

test("accept a co-owner: keep the assignee, note the co-owner (Circleback holds one assignee)", () => {
  const v = verdict({ suggestion: { action: "add_owners", owners: [{ name: "Ana Diaz", confirmed: true }], evidence: [ev] } });
  const p = planFix(item, v, "owner", "accept", undefined, today);
  assert.equal(p.assignTo, undefined);
  assert.equal(p.description, `From standup\n\n[Verified 2026-11-04] Shared with Ana Diaz: "once your PR is up I'll review it"`);
});

test("accept checks: done marks DONE; others add a dated note; reassign needs a person", () => {
  const v = verdict({
    checks: [
      { kind: "already_done", detail: "Someone said it's already done.", evidence: [ev] },
      { kind: "conditional", detail: 'Depends on: "once your PR is up".', evidence: [ev] },
    ],
  });
  assert.deepEqual(planFix(item, v, "already_done", "accept", undefined, today), { status: "DONE", summary: "Mark done" });
  assert.match(planFix(item, v, "conditional", "accept", undefined, today).description!, /\[Verified 2026-11-04\] Conditional promise: Depends on/);
  assert.equal(planFix(item, v, "conditional", "reassign", { name: "Aisha Khan" }).assignTo?.name, "Aisha Khan");
  assert.throws(() => planFix(item, v, "conditional", "reassign"));
  assert.throws(() => planFix(item, v, "due_date", "accept")); // not on this item
});

test("handled flags stop counting as open", () => {
  const v = verdict({ suggestion: { action: "reassign", owners: [{ name: "Aisha Khan", confirmed: true }], evidence: [ev] }, checks: [{ kind: "conditional", detail: "", evidence: [ev] }] });
  const d = { itemId: "31", flag: "owner" as const, action: "dismiss" as const, at: "", written: false, message: "" };
  assert.deepEqual(openFlags(v, {}), ["owner", "conditional"]);
  assert.deepEqual(openFlags(v, { [decisionKey("31", "owner")]: d }), ["conditional"]);
});
