import { NextResponse } from "next/server";
import { z } from "zod";
import { circlebackIdOf, getAttendees, updateActionItem, type ActionItemUpdate } from "@/lib/circleback/api";
import { getMeeting } from "@/lib/circleback/source";
import { saveDecision } from "@/lib/decisions";
import { type Decision, type FlagKind, flagsOf, planFix } from "@/lib/fixes";
import { store } from "@/lib/store";
import { namesMatch } from "@/lib/verify/text";

export const dynamic = "force-dynamic";

const Body = z.object({
  itemId: z.string(),
  flag: z.enum(["owner", "due_date", "conditional", "cancelled_later", "already_done"]),
  action: z.enum(["accept", "reassign", "dismiss"]),
  assignee: z.object({ name: z.string().min(1), email: z.string().optional() }).optional(),
});

/** One click on a flag: accept the fix, reassign the item, or dismiss the flag. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  // This writes to Circleback with the server's API key: refuse requests from other sites.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { itemId, action, assignee } = parsed.data;
  const flag = parsed.data.flag as FlagKind;

  const meeting = await getMeeting(params.id);
  const report = meeting && (await store.latest(meeting.id));
  const item = meeting?.actionItems.find((a) => a.id === itemId);
  const v = report?.verdicts.find((x) => x.actionItemId === itemId);
  if (!meeting || !item || !v || !flagsOf(v).includes(flag)) return NextResponse.json({ error: "No such flag" }, { status: 404 });

  const done = async (d: Omit<Decision, "itemId" | "flag" | "action" | "at">) => {
    const decision: Decision = { itemId, flag, action, at: new Date().toISOString(), ...d };
    await saveDecision(meeting.id, decision);
    return NextResponse.json(decision);
  };

  if (action === "dismiss") return done({ written: false, message: "Dismissed" });

  let plan;
  try {
    plan = planFix(item, v, flag, action, assignee);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // Only real Circleback items with an API key can be written; otherwise keep the decision here.
  const cbMeeting = circlebackIdOf(meeting);
  const cbItem = Number(item.id);
  const why = !process.env.CIRCLEBACK_API_KEY
    ? "no CIRCLEBACK_API_KEY"
    : !cbMeeting || !Number.isInteger(cbItem) || cbItem <= 0
      ? "not a Circleback item"
      : null;
  if (why) return done({ written: false, message: `${plan.summary}. Saved here only (${why}).` });

  try {
    const body: ActionItemUpdate = {};
    if (plan.status) body.status = plan.status;
    if (plan.description) body.description = plan.description;
    if (plan.assignTo) {
      // Circleback assigns by profile id; the meeting's attendee list has them. Match on email first.
      const to = plan.assignTo;
      const attendees = await getAttendees(cbMeeting!);
      const byEmail = to.email && attendees.filter((p) => p.email?.toLowerCase() === to.email!.toLowerCase());
      const byName = attendees.filter((p) => namesMatch(p.name, to.name));
      const hit = byEmail && byEmail.length ? byEmail : byName;
      if (hit.length !== 1 || !hit[0].profileId) {
        const reason = hit.length > 1 ? `more than one attendee matches "${to.name}"` : `"${to.name}" isn't a Circleback attendee of this meeting`;
        return NextResponse.json({ error: `Can't assign: ${reason}. Use Reassign to pick someone.` }, { status: 409 });
      }
      body.assigneeProfileId = hit[0].profileId;
    }
    await updateActionItem(cbItem, body);
    return done({ written: true, message: `${plan.summary}. Updated in Circleback.` });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
