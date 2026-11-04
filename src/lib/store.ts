import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VerificationReport } from "@/lib/types";

/**
 * Saves verification runs. Default: JSON files in .data/runs (zero setup).
 * Set STORAGE=prisma after `npm run db:setup` to use Prisma (SQLite locally,
 * Postgres by changing the provider in prisma/schema.prisma).
 */
interface Store {
  save(r: VerificationReport): Promise<void>;
  latest(meetingId: string): Promise<VerificationReport | null>;
}

const DIR = path.join(process.cwd(), ".data", "runs");
const file = (id: string) => path.join(DIR, `${id.replace(/[^\w-]/g, "_")}.json`);

const fileStore: Store = {
  async save(r) {
    await mkdir(DIR, { recursive: true });
    await writeFile(file(r.meetingId), JSON.stringify(r, null, 2));
  },
  async latest(id) {
    try {
      const r = JSON.parse(await readFile(file(id), "utf8"));
      return Array.isArray(r.verdicts) && r.verdicts.every((v: any) => v.task) ? r : null; // skip old-format runs
    } catch {
      return null;
    }
  },
};

let prisma: any;
async function db() {
  // Loaded lazily so the app runs without `prisma generate`.
  prisma ??= new (((await import("@prisma/client")) as any).PrismaClient)();
  return prisma;
}

const prismaStore: Store = {
  async save(r) {
    await (await db()).verificationRun.create({ data: { meetingId: r.meetingId, model: r.model, reportJson: JSON.stringify(r) } });
  },
  async latest(meetingId) {
    const run = await (await db()).verificationRun.findFirst({ where: { meetingId }, orderBy: { createdAt: "desc" } });
    return run ? JSON.parse(run.reportJson) : null;
  },
};

export const store: Store = process.env.STORAGE === "prisma" ? prismaStore : fileStore;
