import type { ActionItem, Meeting, OwnerStatus } from "@/lib/types";
import { isGenericSpeaker, namesMatch, normalize } from "./text";

/** Decide who the assignee is relative to the meeting, before any AI is involved. */
export function ownerStatus(item: ActionItem, meeting: Meeting): OwnerStatus {
  const a = item.assignee;
  if (!a || !a.name?.trim()) return "unassigned";
  if (isGenericSpeaker(a.name)) return "unidentified";

  const byEmail =
    a.email && meeting.attendees.some((p) => p.email && normalize(p.email) === normalize(a.email!));
  const byName = meeting.attendees.some((p) => namesMatch(p.name, a.name));
  const spoke = meeting.transcript.some((s) => namesMatch(s.speaker, a.name));
  return byEmail || byName || spoke ? "present" : "not_present";
}
