import { CHECK_TEXT, type ActionItem, type ItemCheck, type ItemVerdict, type Person } from "@/lib/types";

/** A flag on an item: the owner fix, or one of the checks. */
export type FlagKind = "owner" | ItemCheck["kind"];
export type FlagAction = "accept" | "reassign" | "dismiss";

export type Decision = {
  itemId: string;
  flag: FlagKind;
  action: FlagAction;
  at: string;
  written: boolean; // sent to Circleback
  message: string; // what happened, in plain words
};

export const flagsOf = (v: ItemVerdict): FlagKind[] => [...(v.suggestion ? (["owner"] as const) : []), ...(v.checks ?? []).map((c) => c.kind)];
export const decisionKey = (itemId: string, flag: FlagKind) => `${itemId}:${flag}`;

/** Flags nobody has accepted, reassigned or dismissed yet. */
export const openFlags = (v: ItemVerdict, decisions: Record<string, Decision>) => flagsOf(v).filter((f) => !decisions[decisionKey(v.actionItemId, f)]);

/** What a click would change in Circleback. Pure, so it's testable and nothing is sent here. */
export type Plan = {
  assignTo?: Person; // resolved to a Circleback profile id when applied
  status?: "DONE";
  description?: string;
  summary: string;
};

export function planFix(item: ActionItem, v: ItemVerdict, flag: FlagKind, action: Exclude<FlagAction, "dismiss">, pick?: Person, today = new Date()): Plan {
  if (action === "reassign") {
    if (!pick) throw new Error("Pick who to assign it to.");
    return { assignTo: pick, summary: `Assign to ${pick.name}` };
  }
  const note = (text: string) => {
    const line = `[Verified ${today.toISOString().slice(0, 10)}] ${text}`;
    return item.description ? `${item.description}\n\n${line}` : line;
  };
  if (flag === "owner") {
    const s = v.suggestion;
    if (!s) throw new Error("No owner fix on this item.");
    const people = s.owners.map((o) => o.attendee ?? { name: o.name });
    const quote = `"${s.evidence[0]?.quote ?? ""}"`;
    if (s.action === "add_owners") {
      // Circleback holds one assignee: keep it and record the co-owners in the description.
      return { description: note(`Shared with ${people.map((p) => p.name).join(", ")}: ${quote}`), summary: `Note co-owner ${people.map((p) => p.name).join(", ")}` };
    }
    const [first, ...rest] = people;
    return {
      assignTo: first,
      ...(rest.length && { description: note(`Shared with ${rest.map((p) => p.name).join(", ")}: ${quote}`) }),
      summary: `Assign to ${first.name}${rest.length ? ` (+ note ${rest.map((p) => p.name).join(", ")})` : ""}`,
    };
  }
  const check = v.checks?.find((c) => c.kind === flag);
  if (!check) throw new Error("That flag isn't on this item.");
  if (flag === "already_done") return { status: "DONE", summary: "Mark done" };
  // No due-date or canceled field in Circleback's update API: record it in the description.
  return { description: note(`${CHECK_TEXT[flag]}: ${check.detail} "${check.evidence[0]?.quote ?? ""}"`), summary: `Add note: ${CHECK_TEXT[flag]}` };
}
