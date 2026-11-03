export type Person = { name: string; email?: string };

export type Segment = {
  id: string;
  speaker: string;
  start: number; // seconds from meeting start
  end: number;
  text: string;
};

export type ActionItem = {
  id: string;
  title: string;
  description?: string;
  assignee?: Person | null;
};

export type Meeting = {
  id: string;
  name: string;
  createdAt: string;
  durationSeconds: number;
  attendees: Person[];
  transcript: Segment[];
  actionItems: ActionItem[];
  url?: string;
};

export const LABELS = ["SUPPORTED", "WEAK", "UNSUPPORTED", "OWNER_NOT_CONFIRMED"] as const;
export type Label = (typeof LABELS)[number];

export const LABEL_TEXT: Record<Label, string> = {
  SUPPORTED: "Supported",
  WEAK: "Weak",
  UNSUPPORTED: "Unsupported",
  OWNER_NOT_CONFIRMED: "Owner not confirmed",
};

/** What we know about the assignee before reading the transcript. */
export type OwnerStatus =
  | "present" // named attendee or speaker
  | "not_present" // named, but not on the invite and never spoke
  | "unidentified" // generic label such as "Participant 4"
  | "unassigned";

/** Facts a judge extracts. Judges never pick the final label; decide.ts does. */
export type TopicFinding =
  | "explicit_commitment" // someone clearly agreed to do this
  | "discussed_no_commitment" // talked about, nobody took it
  | "contradicted" // transcript says the opposite
  | "not_discussed";

export type RawEvidence = { segmentId: string; quote: string };

export type Judgment = {
  topic: TopicFinding;
  commitmentSegmentId: string | null; // where someone commits
  ownerAgreementSegmentId: string | null; // where the assignee says yes
  evidence: RawEvidence[];
  rationale: string;
};

export type Evidence = RawEvidence & { speaker: string; start: number };

export type ItemVerdict = {
  actionItemId: string;
  label: Label;
  ownerStatus: OwnerStatus;
  ownerAgreed: boolean;
  evidence: Evidence[];
  rationale: string;
  guardrailNotes: string[];
};

export type VerificationReport = {
  meetingId: string;
  judge: string;
  createdAt: string;
  verdicts: ItemVerdict[];
};
