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
  dueDate?: string | null; // Circleback's due date field, if set
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

export type SpeakerGuess = {
  speaker: string;
  name: string;
  how: "self_intro" | "named_by_other"; // "I'm Laura" vs "take it away, Poppy"
  evidence: Quote;
  reasoning: string;
};

export type CommitmentKind =
  | "self" // "I'll send the quote"
  | "assigned" // "As the designer, you'll do the mockups"
  | "volunteered_other"; // "Lena can run the training"

/**
 * The owner's own words. committed = a clear yes ("I'll do it", "yes, on it"); hedged = maybe
 * ("I'll try", "let me check", "probably"); declined = no. For kind "self" it judges the statement itself.
 */
export const OWNER_RESPONSES = ["committed", "hedged", "declined", "no_response", "not_applicable"] as const;
export type OwnerResponse = (typeof OWNER_RESPONSES)[number];

export type AiCommitment = {
  id: string;
  task: string;
  kind: CommitmentKind;
  /** Everyone who would do it: a transcript speaker label, or the name as said for someone who never speaks. */
  owners: string[];
  statement: Quote; // the line that makes the commitment or assignment
  response: Quote | null; // an owner's reply, if any
  ownerResponse: OwnerResponse;
  due: { when: string; quote: Quote } | null; // deadline said in the meeting ("by Friday")
  condition: { what: string; quote: Quote } | null; // "if legal signs off"
  reversal: Quote | null; // a LATER line that cancels or takes it back ("actually, skip that")
  alreadyDone: Quote | null; // a line saying it's already done ("I sent it this morning")
};

export type TaskSupport = "supported" | "weak" | "unsupported" | "contradicted";

export type AiItemMatch = {
  actionItemId: string;
  commitmentId: string | null;
  taskSupport: TaskSupport;
  evidence: Quote[];
  rationale: string;
  /** Deadline in the action item (title, description or due date), as written; null if none. */
  itemDue: string | null;
  /** Does it agree with the deadline said in the meeting? */
  dueMatch: "same" | "different" | "not_comparable";
};

export type AiReading = {
  speakers: SpeakerGuess[];
  commitments: AiCommitment[];
  items: AiItemMatch[];
};

// ---------- What the referee decides (checked, final) ----------

export const TASK_STATUSES = ["SUPPORTED", "WEAK", "UNSUPPORTED", "CONTRADICTED", "NOT_CHECKED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const OWNER_STATUSES = [
  "CONFIRMED",
  "WEAK",
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
  NOT_CHECKED: "Not checked",
};

export const OWNER_TEXT: Record<OwnerStatus, string> = {
  CONFIRMED: "Owner confirmed",
  WEAK: "Owner's yes was weak",
  NOT_ACKNOWLEDGED: "Owner never acknowledged",
  DECLINED: "Owner declined",
  SOMEONE_ELSE: "Someone else took it",
  UNIDENTIFIED: "Owner unidentified",
  NOT_IN_MEETING: "Owner not in meeting",
  NO_OWNER: "No owner",
  NOT_APPLICABLE: "Owner n/a",
};

/** A checked quote. `fuzzy` = close to the line but not word for word (paraphrased): never proof on its own. */
export type Evidence = Quote & { speaker: string; start: number; fuzzy?: true };

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
  attendee?: Person; // the meeting attendee this maps to: what you'd set as Circleback's assignee
};

/** A correction you could write back to Circleback: change or add assignees. */
export type OwnerSuggestion = {
  action: "reassign" | "add_owners";
  owners: SuggestedOwner[];
  evidence: Evidence[];
};

/** Problems with an item that is otherwise real. Each one is backed by a verified quote. */
export type ItemCheck = {
  kind: "due_date" | "conditional" | "cancelled_later" | "already_done";
  detail: string;
  evidence: Evidence[];
};

export const CHECK_TEXT: Record<ItemCheck["kind"], string> = {
  due_date: "Due date differs",
  conditional: "Conditional promise",
  cancelled_later: "Taken back later in the call",
  already_done: "Already done",
};

export type ItemVerdict = {
  actionItemId: string;
  task: TaskStatus;
  owner: OwnerStatus;
  evidence: Evidence[];
  rationale: string;
  notes: string[]; // what the referee changed or rejected, and why
  suggestion?: OwnerSuggestion;
  checks?: ItemCheck[];
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
