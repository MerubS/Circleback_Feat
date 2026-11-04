import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Decision, decisionKey } from "./fixes";

// ---------- Saved decisions ----------
// shortcut: JSON files in .data/decisions (like the default report store); move to Prisma for a multi-instance deploy.

const DIR = path.join(process.cwd(), ".data", "decisions");
const file = (meetingId: string) => path.join(DIR, `${meetingId.replace(/[^\w-]/g, "_")}.json`);

export async function loadDecisions(meetingId: string): Promise<Record<string, Decision>> {
  try {
    return JSON.parse(await readFile(file(meetingId), "utf8"));
  } catch {
    return {};
  }
}

export async function saveDecision(meetingId: string, d: Decision): Promise<void> {
  const all = await loadDecisions(meetingId);
  all[decisionKey(d.itemId, d.flag)] = d;
  await mkdir(DIR, { recursive: true });
  await writeFile(file(meetingId), JSON.stringify(all, null, 2));
}
