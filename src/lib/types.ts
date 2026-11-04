// ---------- Meeting data (what Circleback gives us) ----------

export type Person = { name: string; email?: string };

export type Segment = {
  id: string;
  speaker: string; // a real name, or "Participant N" when Circleback couldn't tell
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
  source?: string;
};

// ---------- What the AI reports (raw, unchecked) ----------

export type Quote = { segmentId: string; quote: string };

export type SpeakerGuess = { speaker: string; name: string; evidence: Quote; reasoning: string };

export type CommitmentKind =
  | "self" // "I'll send the quote"
  | "assigned" // "As the designer, you'll do the mockups"
  | "volunteered_other"; // "Lena can run the training"

export type OwnerResponse = "agreed" | "declined_or_hedged" | "no_response" | "not_applicable";

export type AiCommitment = {
  id: string;
  task: string;
  kind: CommitmentKind;
  /** Everyone who would do it: a transcript speaker label, or the name as said for someone who never speaks. */
  owners: string[];
  statement: Quote; // the line that makes the commitment or assignment
  response: Quote | null; // an owner's reply, if any
  ownerResponse: OwnerResponse;
};

export type TaskSupport = "supported" | "weak" | "unsupported" | "contradicted";

export type AiItemMatch = {
  actionItemId: string;
  commitmentId: string | null;
  taskSupport: TaskSupport;
  evidence: Quote[];
  rationale: string;
};

export type AiReading = {
  speakers: SpeakerGuess[];
  commitments: AiCommitment[];
  items: AiItemMatch[];
};

// ---------- What the referee decides (checked, final) ----------

export const TASK_STATUSES = ["SUPPORTED", "WEAK", "UNSUPPORTED", "CONTRADICTED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const OWNER_STATUSES = [
  "CONFIRMED",
  "NOT_ACKNOWLEDGED",
  "DECLINED",
  "SOMEONE_ELSE",
  "UNIDENTIFIED",
  "NOT_IN_MEETING",
  "NO_OWNER",
  "NOT_APPLICABLE",
] as const;
export type OwnerStatus = (typeof OWNER_STATUSES)[number];

export const TASK_TEXT: Record<TaskStatus, string> = {
  SUPPORTED: "Supported",
  WEAK: "Weak",
  UNSUPPORTED: "Unsupported",
  CONTRADICTED: "Contradicted",
};

export const OWNER_TEXT: Record<OwnerStatus, string> = {
  CONFIRMED: "Owner confirmed",
  NOT_ACKNOWLEDGED: "Owner never acknowledged",
  DECLINED: "Owner hesitated or declined",
  SOMEONE_ELSE: "Someone else took it",
  UNIDENTIFIED: "Owner unidentified",
  NOT_IN_MEETING: "Owner not in meeting",
  NO_OWNER: "No owner",
  NOT_APPLICABLE: "Owner n/a",
};

export type Evidence = Quote & { speaker: string; start: number };

export type SpeakerIdentity = {
  speaker: string;
  name: string;
  source: "circleback" | "ai";
  evidence?: Evidence;
};

export type SuggestedOwner = {
  name: string; // best display name
  speaker?: string; // transcript label, when they speak in the meeting
  confirmed: boolean; // they said yes themselves (not just named by someone else)
};

/** A correction you could write back to Circleback: change or add assignees. */
export type OwnerSuggestion = {
  action: "reassign" | "add_owners";
  owners: SuggestedOwner[];
  evidence: Evidence[];
};

export type ItemVerdict = {
  actionItemId: string;
  task: TaskStatus;
  owner: OwnerStatus;
  evidence: Evidence[];
  rationale: string;
  notes: string[]; // what the referee changed or rejected, and why
  suggestion?: OwnerSuggestion;
};

export type MissedTask = {
  task: string;
  owners: string[]; // display names
  evidence: Evidence[];
};

export type VerificationReport = {
  meetingId: string;
  model: string;
  createdAt: string;
  speakers: SpeakerIdentity[];
  verdicts: ItemVerdict[];
  missed: MissedTask[];
  notes: string[];
};
