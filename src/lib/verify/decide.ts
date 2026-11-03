import type { ActionItem, Evidence, ItemVerdict, Judgment, Label, Meeting, OwnerStatus } from "@/lib/types";
import { namesMatch, normalize } from "./text";

/**
 * Guardrails + label decision. The judge (LLM or heuristic) only reports facts
 * and quotes. This function checks those quotes against the real transcript and
 * picks the label with plain rules, so a judge that invents evidence can't
 * produce a "Supported" result.
 */
export function decide(
  item: ActionItem,
  meeting: Meeting,
  owner: OwnerStatus,
  j: Judgment,
): ItemVerdict {
  const notes: string[] = [];
  const byId = new Map(meeting.transcript.map((s) => [s.id, s]));

  // 1. Every quote must appear word for word in the segment it cites.
  const evidence: Evidence[] = [];
  for (const e of j.evidence) {
    const seg = byId.get(e.segmentId);
    if (!seg) {
      notes.push(`Dropped evidence citing unknown segment ${e.segmentId}.`);
      continue;
    }
    const quote = e.quote.trim();
    if (!quote || !normalize(seg.text).includes(normalize(quote))) {
      notes.push(`Dropped a quote not found in segment ${e.segmentId}.`);
      continue;
    }
    evidence.push({ ...e, quote, speaker: seg.speaker, start: seg.start });
  }

  // 2. A cited commitment segment must exist.
  let commitSeg = j.commitmentSegmentId ? byId.get(j.commitmentSegmentId) : undefined;
  if (j.commitmentSegmentId && !commitSeg) {
    notes.push("Commitment cited a segment that does not exist; ignored.");
  }
  let topic = j.topic;
  if (topic === "explicit_commitment" && !commitSeg) {
    topic = "discussed_no_commitment";
    notes.push("Judge claimed a commitment without citing where; downgraded.");
  }
  if (commitSeg && !evidence.some((e) => e.segmentId === commitSeg!.id)) {
    evidence.unshift({ segmentId: commitSeg.id, quote: commitSeg.text, speaker: commitSeg.speaker, start: commitSeg.start });
  }

  // 3. The assignee agreed only if the agreeing line was spoken by the assignee.
  const assignee = item.assignee?.name ?? "";
  const agreeSeg = j.ownerAgreementSegmentId ? byId.get(j.ownerAgreementSegmentId) : undefined;
  const ownerAgreed =
    owner === "present" &&
    ((!!commitSeg && namesMatch(commitSeg.speaker, assignee)) ||
      (!!agreeSeg && namesMatch(agreeSeg.speaker, assignee)));
  if (agreeSeg && !namesMatch(agreeSeg.speaker, assignee)) {
    notes.push(`Agreement line was spoken by ${agreeSeg.speaker}, not ${assignee}.`);
  }
  if (agreeSeg && ownerAgreed && !evidence.some((e) => e.segmentId === agreeSeg.id)) {
    evidence.push({ segmentId: agreeSeg.id, quote: agreeSeg.text, speaker: agreeSeg.speaker, start: agreeSeg.start });
  }

  // 4. Nothing verified means nothing supports it.
  if (topic !== "not_discussed" && topic !== "contradicted" && evidence.length === 0) {
    notes.push("No verifiable quote; treated as not discussed.");
    topic = "not_discussed";
  }

  let label: Label;
  if (topic === "not_discussed" || topic === "contradicted") {
    label = "UNSUPPORTED";
  } else if (owner === "not_present" || owner === "unidentified") {
    label = "OWNER_NOT_CONFIRMED";
  } else if (owner === "unassigned") {
    label = topic === "explicit_commitment" ? "SUPPORTED" : "WEAK";
  } else if (ownerAgreed) {
    label = "SUPPORTED";
  } else if (topic === "explicit_commitment") {
    label = "OWNER_NOT_CONFIRMED"; // someone committed, just not the assignee
  } else {
    label = "WEAK";
  }

  evidence.sort((a, b) => a.start - b.start);
  return {
    actionItemId: item.id,
    label,
    ownerStatus: owner,
    ownerAgreed,
    evidence: label === "UNSUPPORTED" && topic === "not_discussed" ? [] : evidence,
    rationale: j.rationale,
    guardrailNotes: notes,
  };
}
