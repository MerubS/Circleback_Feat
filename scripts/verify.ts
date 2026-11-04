/**
 * Verify one meeting from the command line.
 *   npm run verify -- cb-es2002a
 */
import { getMeeting } from "@/lib/circleback/source";
import { store } from "@/lib/store";
import { OWNER_TEXT, TASK_TEXT } from "@/lib/types";
import { verifyMeeting } from "@/lib/verify";

const t = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("Usage: npm run verify -- <meetingId>");
  const meeting = await getMeeting(id);
  if (!meeting) throw new Error(`Meeting ${id} not found`);
  const r = await verifyMeeting(meeting);
  await store.save(r);

  const named = r.speakers.filter((s) => s.source === "ai");
  if (named.length) {
    console.log("\nSpeakers named by the AI:");
    for (const s of named) console.log(`  ${s.speaker} = ${s.name}  (${t(s.evidence!.start)} "${s.evidence!.quote}")`);
  }
  for (const v of r.verdicts) {
    const item = meeting.actionItems.find((a) => a.id === v.actionItemId)!;
    console.log(`\n${item.title}  (owner: ${item.assignee?.name ?? "none"})`);
    console.log(`  Task: ${TASK_TEXT[v.task]} · ${OWNER_TEXT[v.owner]}`);
    console.log(`  ${v.rationale}`);
    for (const e of v.evidence) console.log(`  ${t(e.start)} ${e.speaker}: "${e.quote}"`);
    for (const n of v.notes) console.log(`  [referee] ${n}`);
  }
  if (r.missed.length) {
    console.log("\nPossibly missed by the notetaker:");
    for (const m of r.missed) console.log(`  - ${m.task} (${m.ownerName ?? m.ownerSpeaker}) at ${t(m.evidence[0].start)}: "${m.evidence[0].quote}"`);
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
