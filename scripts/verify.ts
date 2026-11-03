/**
 * Verify one meeting from the command line.
 *   npm run verify -- m2
 *   npm run verify -- m2 --judge openai
 */
import { getMeeting } from "@/lib/circleback/source";
import { store } from "@/lib/store";
import { LABEL_TEXT } from "@/lib/types";
import { defaultJudge, verifyMeeting } from "@/lib/verify";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("Usage: npm run verify -- <meetingId> [--judge openai|heuristic]");
  const j = process.argv.indexOf("--judge");
  const meeting = await getMeeting(id);
  if (!meeting) throw new Error(`Meeting ${id} not found`);
  const report = await verifyMeeting(meeting, defaultJudge(j > -1 ? process.argv[j + 1] : undefined));
  await store.save(report);
  for (const v of report.verdicts) {
    const item = meeting.actionItems.find((a) => a.id === v.actionItemId)!;
    console.log(`\n[${LABEL_TEXT[v.label]}] ${item.title}  (owner: ${item.assignee?.name ?? "none"})`);
    console.log(`  ${v.rationale}`);
    for (const e of v.evidence) console.log(`  ${Math.floor(e.start / 60)}:${String(Math.floor(e.start % 60)).padStart(2, "0")} ${e.speaker}: "${e.quote}"`);
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
