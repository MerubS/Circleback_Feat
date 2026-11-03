/**
 * Scores a judge against hand-labelled ground truth.
 *   npm run eval                    # heuristic judge (no key needed)
 *   npm run eval -- --judge openai  # needs OPENAI_API_KEY
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { listMeetings } from "@/lib/circleback/source";
import { LABELS, LABEL_TEXT, type Label } from "@/lib/types";
import { defaultJudge, verifyMeeting } from "@/lib/verify";

async function main() {
  const arg = process.argv.indexOf("--judge");
  const judge = defaultJudge(arg > -1 ? process.argv[arg + 1] : "heuristic");
  const truth: Record<string, Label> = JSON.parse(
    await readFile(path.join(process.cwd(), "data", "ground-truth.json"), "utf8"),
  );

  const rows: { id: string; title: string; want: Label; got: Label; notes: string[] }[] = [];
  const t0 = Date.now();
  for (const m of await listMeetings()) {
    const r = await verifyMeeting(m, judge);
    for (const v of r.verdicts) {
      const want = truth[v.actionItemId];
      if (!want) continue;
      const title = m.actionItems.find((a) => a.id === v.actionItemId)?.title ?? "";
      rows.push({ id: v.actionItemId, title, want, got: v.label, notes: v.guardrailNotes });
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const correct = rows.filter((r) => r.want === r.got).length;
  const per = LABELS.map((l) => {
    const tp = rows.filter((r) => r.got === l && r.want === l).length;
    const fp = rows.filter((r) => r.got === l && r.want !== l).length;
    const fn = rows.filter((r) => r.got !== l && r.want === l).length;
    const p = tp + fp ? tp / (tp + fp) : 0;
    const rc = tp + fn ? tp / (tp + fn) : 0;
    return { l, n: tp + fn, p, rc, f1: p + rc ? (2 * p * rc) / (p + rc) : 0 };
  });
  // The number that matters most: invented items that were caught.
  const invented = rows.filter((r) => r.want === "UNSUPPORTED");
  const caught = invented.filter((r) => r.got === "UNSUPPORTED").length;
  const falseAlarms = rows.filter((r) => r.want === "SUPPORTED" && r.got === "UNSUPPORTED").length;
  const dropped = rows.reduce((s, r) => s + r.notes.filter((n) => n.startsWith("Dropped")).length, 0);

  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const lines = [
    `# Eval: ${judge.name}`,
    ``,
    `- Items: ${rows.length} across ${new Set(rows.map((r) => r.id.split("-")[0])).size} meetings, ${secs}s`,
    `- Accuracy: **${correct}/${rows.length} (${pct(correct / rows.length)})**`,
    `- Invented items caught: **${caught}/${invented.length}**`,
    `- Real items wrongly flagged Unsupported: **${falseAlarms}**`,
    `- Fabricated quotes blocked by guardrail: ${dropped}`,
    ``,
    `| Label | Items | Precision | Recall | F1 |`,
    `|---|---|---|---|---|`,
    ...per.map((x) => `| ${LABEL_TEXT[x.l]} | ${x.n} | ${pct(x.p)} | ${pct(x.rc)} | ${pct(x.f1)} |`),
    ``,
    `## Confusion matrix (rows = truth, columns = predicted)`,
    ``,
    `| | ${LABELS.map((l) => LABEL_TEXT[l]).join(" | ")} |`,
    `|---|${LABELS.map(() => "---").join("|")}|`,
    ...LABELS.map(
      (w) => `| ${LABEL_TEXT[w]} | ${LABELS.map((g) => rows.filter((r) => r.want === w && r.got === g).length).join(" | ")} |`,
    ),
    ``,
    `## Misses`,
    ``,
    ...(rows.filter((r) => r.want !== r.got).map((r) => `- ${r.id} "${r.title}": expected ${LABEL_TEXT[r.want]}, got ${LABEL_TEXT[r.got]}`) || []),
  ];
  if (correct === rows.length) lines.push("- None");
  const out = lines.join("\n");
  console.log(out);
  await writeFile(path.join(process.cwd(), "eval-report.md"), out + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
