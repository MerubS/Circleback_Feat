import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { IMPORT_DIR } from "@/lib/circleback/source";
import { MeetingSchema } from "@/lib/circleback/validate";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "That file isn't valid JSON." }, { status: 400 });
  }
  const parsed = MeetingSchema.safeParse(body);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return NextResponse.json({ error: `${i.path.join(".") || "file"}: ${i.message}` }, { status: 400 });
  }
  await mkdir(IMPORT_DIR, { recursive: true });
  await writeFile(path.join(IMPORT_DIR, `${parsed.data.id}.json`), JSON.stringify(parsed.data, null, 2));
  return NextResponse.json({ id: parsed.data.id });
}
