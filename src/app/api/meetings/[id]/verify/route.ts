import { NextResponse } from "next/server";
import { getMeeting } from "@/lib/circleback/source";
import { store } from "@/lib/store";
import { defaultJudge, verifyMeeting } from "@/lib/verify";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const meeting = await getMeeting(params.id);
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  const judgeName = new URL(req.url).searchParams.get("judge") ?? undefined;
  try {
    const report = await verifyMeeting(meeting, defaultJudge(judgeName));
    await store.save(report);
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
