import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VerificationReport } from "@/lib/types";

/**
 * Saves verification runs. Default: JSON files in .data/ (zero setup).
 * Set STORAGE=prisma after `npm run db:setup` to use Prisma (SQLite locally,
 * Postgres by changing the provider in prisma/schema.prisma).
 */
interface Store {
  save(r: VerificationReport): Promise<void>;
  latest(meetingId: string): Promise<VerificationReport | null>;
}

const DIR = path.join(process.cwd(), ".data", "runs");

const fileStore: Store = {
  async save(r) {
    await mkdir(DIR, { recursive: true });
    await writeFile(path.join(DIR, `${r.meetingId.replace(/[^\w-]/g, "_")}.json`), JSON.stringify(r, null, 2));
  },
  async latest(id) {
    try {
      return JSON.parse(await readFile(path.join(DIR, `${id.replace(/[^\w-]/g, "_")}.json`), "utf8"));
    } catch {
      return null;
    }
  },
};

let prisma: any;
async function client() {
  if (!prisma) {
    // Loaded lazily so the app runs without `prisma generate`.
    const mod: any = await import("@prisma/client");
    prisma = new mod.PrismaClient();
  }
  return prisma;
}

const prismaStore: Store = {
  async save(r) {
    const db = await client();
    await db.verificationRun.create({
      data: {
        meetingId: r.meetingId,
        judge: r.judge,
        results: {
          create: r.verdicts.map((v) => ({
            actionItemId: v.actionItemId,
            label: v.label,
            ownerStatus: v.ownerStatus,
            rationale: v.rationale,
            evidenceJson: JSON.stringify({ evidence: v.evidence, ownerAgreed: v.ownerAgreed, notes: v.guardrailNotes }),
          })),
        },
      },
    });
  },
  async latest(meetingId) {
    const db = await client();
    const run = await db.verificationRun.findFirst({
      where: { meetingId },
      orderBy: { createdAt: "desc" },
      include: { results: true },
    });
    if (!run) return null;
    return {
      meetingId,
      judge: run.judge,
      createdAt: run.createdAt.toISOString(),
      verdicts: run.results.map((x: any) => {
        const extra = JSON.parse(x.evidenceJson);
        return {
          actionItemId: x.actionItemId,
          label: x.label,
          ownerStatus: x.ownerStatus,
          rationale: x.rationale,
          evidence: extra.evidence,
          ownerAgreed: extra.ownerAgreed,
          guardrailNotes: extra.notes,
        };
      }),
    };
  },
};

export const store: Store = process.env.STORAGE === "prisma" ? prismaStore : fileStore;
