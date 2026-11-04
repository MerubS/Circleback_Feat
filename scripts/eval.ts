/**
 * Scores the AI verifier against the hand labels in data/ground-truth.json.
 *   npm run eval                       # uses OPENAI_API_KEY and OPENAI_MODEL from .env
 *   npm run eval -- --model gpt-4.1    # try another model
 *   npm run eval -- --fresh            # ignore cached AI answers
 * AI answers are cached in .data/ai-cache, so reruns cost nothing unless the prompt or model changes.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { listMeetings } from "@/lib/circleback/source";
import { OWNER_TEXT, TASK_TEXT, type OwnerStatus, type TaskStatus } from "@/lib/types";
import { createOpenAIReader, verifyMeeting } from "@/lib/verify";

type Gold = { task: TaskStatus; owner: OwnerStatus; evidence: string[] };

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

async function main() {
  const reader = createOpenAIReader({ model: arg("--model"), cache: !process.argv.includes("--fresh") });
  const raw = JSON.parse(await readFile(path.join(process.cwd(), "data", "ground-truth.json"), "utf8"));
  const gold: Record<string, Gold> = Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("_"))) as any;

  type Row = { meeting: string; id: string; title: string; want: Gold; task: TaskStatus; owner: OwnerStatus; cited: string[] };
  const rows: Row[] = [];
  const missed: string[] = [];
  let meetings = 0;
  const t0 = Date.now();

  for (const m of await listMeetings()) {
    if (!m.actionItems.some((a) => gold[a.id])) continue;
    meetings++;
    process.stdout.write(`Reading ${m.name}... `);
    const r = await verifyMeeting(m, reader);
    console.log("done");
    for (const v of r.verdicts) {
      const want = gold[v.actionItemId];
      if (!want) continue;
      const title = m.actionItems.find((a) => a.id === v.actionItemId)?.title ?? "";
      rows.push({ meeting: m.name, id: v.actionItemId, title, want, task: v.task, owner: v.owner, cited: v.evidence.map((e) => e.segmentId) });
    }
    for (const x of r.missed) missed.push(`- ${m.name}: "${x.task}" (${x.ownerName ?? x.ownerSpeaker}), line ${x.evidence[0].segmentId}`);
  }

  const n = rows.length;
  const pct = (a: number, b: number) => `${a}/${b} (${b ? Math.round((100 * a) / b) : 0}%)`;
  const taskOk = rows.filter((r) => r.task === r.want.task).length;
  const ownerOk = rows.filter((r) => r.owner === r.want.owner).length;
  const bothOk = rows.filter((r) => r.task === r.want.task && r.owner === r.want.owner).length;
  // Evidence: if the item has gold lines, at least one cited line must be among them.
  const withGold = rows.filter((r) => r.want.evidence.length);
  const evOk = withGold.filter((r) => r.cited.some((c) => r.want.evidence.includes(c))).length;
  const real = rows.filter((r) => !/^m\d-/.test(r.id));
  const realBoth = real.filter((r) => r.task === r.want.task && r.owner === r.want.owner).length;

  const out = [
    `# Eval: ${reader.model}`,
    ``,
    `${n} action items across ${meetings} meetings, ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    ``,
    `| Check | Score |`,
    `|---|---|`,
    `| Task answer right | ${pct(taskOk, n)} |`,
    `| Owner answer right | ${pct(ownerOk, n)} |`,
    `| Both right | ${pct(bothOk, n)} |`,
    `| Cited the right transcript line | ${pct(evOk, withGold.length)} |`,
    `| Both right, real Circleback meetings only | ${pct(realBoth, real.length)} |`,
    ``,
    `## Misses`,
    ``,
    ...rows
      .filter((r) => r.task !== r.want.task || r.owner !== r.want.owner || (r.want.evidence.length && !r.cited.some((c) => r.want.evidence.includes(c))))
      .map((r) => {
        const parts = [];
        if (r.task !== r.want.task) parts.push(`task ${TASK_TEXT[r.task]} (expected ${TASK_TEXT[r.want.task]})`);
        if (r.owner !== r.want.owner) parts.push(`owner ${OWNER_TEXT[r.owner]} (expected ${OWNER_TEXT[r.want.owner]})`);
        if (r.want.evidence.length && !r.cited.some((c) => r.want.evidence.includes(c)))
          parts.push(`cited [${r.cited.join(", ") || "nothing"}] (expected one of ${r.want.evidence.join(", ")})`);
        return `- ${r.id} "${r.title}": ${parts.join("; ")}`;
      }),
    ``,
    `## Possibly missed by the notetaker (not scored)`,
    ``,
    ...(missed.length ? missed : ["- None"]),
  ];
  console.log("\n" + out.join("\n"));
  await writeFile(path.join(process.cwd(), "eval-report.md"), out.join("\n") + "\n");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
