import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getMeetingFromApi } from "@/lib/circleback/api";
import { IMPORT_DIR } from "@/lib/circleback/source";
import { MeetingSchema } from "@/lib/circleback/validate";
import { WebhookSchema, meetingFromWebhook, verifySignature } from "@/lib/circleback/webhook";
import { store } from "@/lib/store";
import { verifyMeeting } from "@/lib/verify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // Circleback waits up to 5 minutes before retrying

/**
 * Circleback calls this after each meeting. It checks the signature, saves the meeting, and verifies it.
 * Non-2xx makes Circleback retry, so only real failures (e.g. the AI call) return 5xx.
 */
export async function POST(req: Request) {
  const secret = process.env.CIRCLEBACK_WEBHOOK_SECRET;
  if (!secret) {
    console.error("Circleback webhook received, but CIRCLEBACK_WEBHOOK_SECRET is not set.");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  const raw = await req.text(); // the signature covers the raw bytes, so read before parsing
  if (!verifySignature(raw, req.headers.get("x-signature"), secret)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  let payload;
  try {
    payload = WebhookSchema.parse(JSON.parse(raw));
  } catch (e) {
    return NextResponse.json({ error: `Unexpected payload: ${(e as Error).message.slice(0, 300)}` }, { status: 400 });
  }

  let meeting = meetingFromWebhook(payload);
  // "Notes ready" can fire before the transcript is in the payload; read it from the API if we can.
  if (!meeting.transcript.length && process.env.CIRCLEBACK_API_KEY) {
    const fromApi = await getMeetingFromApi(payload.id).catch(() => null);
    if (fromApi?.transcript.length) meeting = { ...meeting, transcript: fromApi.transcript };
  }
  if (!meeting.transcript.length) return NextResponse.json({ skipped: "No transcript yet", id: meeting.id });

  // Retries deliver the same meeting again: verify each meeting once.
  if (await store.latest(meeting.id)) return NextResponse.json({ duplicate: true, id: meeting.id });

  const valid = MeetingSchema.safeParse(meeting);
  if (!valid.success) return NextResponse.json({ error: `Meeting didn't map cleanly: ${valid.error.issues[0].message}` }, { status: 400 });
  await mkdir(IMPORT_DIR, { recursive: true });
  await writeFile(path.join(IMPORT_DIR, `${meeting.id}.json`), JSON.stringify(meeting, null, 2));

  try {
    const report = await verifyMeeting(meeting);
    await store.save(report);
    const flags = report.verdicts.filter((v) => v.suggestion || v.checks?.length || v.task !== "SUPPORTED").length;
    return NextResponse.json({ id: meeting.id, items: report.verdicts.length, needLook: flags });
  } catch (e) {
    console.error(`Verifying ${meeting.id} failed:`, e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 }); // Circleback will retry
  }
}
