import type {
  AiCommitment,
  AiReading,
  Evidence,
  ItemVerdict,
  Meeting,
  MissedTask,
  OwnerStatus,
  Quote,
  SpeakerIdentity,
  TaskStatus,
} from "@/lib/types";
import { isGenericSpeaker, namesMatch, normalize } from "./text";

/**
 * The referee. The AI only reports facts with quotes. This code checks every
 * quote against the real transcript, throws out anything it can't verify, and
 * decides the final answers with fixed rules. A made-up quote can't get through.
 */
export function referee(meeting: Meeting, ai: AiReading): {
  speakers: SpeakerIdentity[];
  verdicts: ItemVerdict[];
  missed: MissedTask[];
  notes: string[];
} {
  const notes: string[] = [];
  const seg = new Map(meeting.transcript.map((s) => [s.id, s]));
  const pos = new Map(meeting.transcript.map((s, i) => [s.id, i]));
  const labels = new Set(meeting.transcript.map((s) => s.speaker));

  /** A quote counts only if it appears word for word in the line it cites. */
  function check(q: Quote | null | undefined, where: string, out: string[]): Evidence | null {
    if (!q) return null;
    const s = seg.get(q.segmentId);
    if (!s) {
      out.push(`${where}: cited line ${q.segmentId} doesn't exist; ignored.`);
      return null;
    }
    const text = q.quote.trim();
    if (!text || !normalize(s.text).includes(normalize(text))) {
      out.push(`${where}: quote not found in line ${q.segmentId}; ignored.`);
      return null;
    }
    return { segmentId: s.id, quote: text, speaker: s.speaker, start: s.start };
  }

  // ---- 1. Who is who ----
  const speakers: SpeakerIdentity[] = [...labels]
    .filter((l) => !isGenericSpeaker(l))
    .map((l) => ({ speaker: l, name: l, source: "circleback" as const }));

  const guesses: SpeakerIdentity[] = [];
  for (const g of ai.speakers) {
    const where = `Speaker guess "${g.speaker} = ${g.name}"`;
    if (!labels.has(g.speaker) || !isGenericSpeaker(g.speaker)) {
      notes.push(`${where}: not a placeholder speaker in this transcript; ignored.`);
      continue;
    }
    const ev = check(g.evidence, where, notes);
    if (!ev) continue;
    const first = normalize(g.name).split(" ")[0];
    if (!first || !normalize(ev.quote).split(" ").includes(first)) {
      notes.push(`${where}: the quote doesn't contain the name; ignored.`);
      continue;
    }
    // Either they said it themselves, or they speak within two lines of being named.
    const i = pos.get(ev.segmentId)!;
    const nearby = meeting.transcript.slice(i + 1, i + 3).some((s) => s.speaker === g.speaker);
    if (ev.speaker !== g.speaker && !nearby) {
      notes.push(`${where}: ${g.speaker} doesn't speak right after being named; ignored.`);
      continue;
    }
    guesses.push({ speaker: g.speaker, name: g.name.trim(), source: "ai", evidence: ev });
  }
  // One name claimed by two speakers, or one speaker given two names: too unsure, drop both.
  const clash = (a: SpeakerIdentity, b: SpeakerIdentity) =>
    a !== b && (namesMatch(a.name, b.name) || a.speaker === b.speaker);
  for (const g of guesses) {
    if (guesses.some((o) => clash(g, o))) notes.push(`Speaker guess "${g.speaker} = ${g.name}" conflicts with another guess; ignored.`);
    else speakers.push(g);
  }

  const nameOf = (label: string) => speakers.find((s) => s.speaker === label)?.name ?? null;
  const unresolved = [...labels].filter((l) => isGenericSpeaker(l) && !nameOf(l));
  const labelsFor = (person: string) => speakers.filter((s) => namesMatch(s.name, person)).map((s) => s.speaker);

  // ---- 2. Commitments ----
  type Checked = AiCommitment & { by: string; stmt: Evidence; resp: Evidence | null };
  const commitments = new Map<string, Checked>();
  for (const c of ai.commitments) {
    const where = `Commitment "${c.task}"`;
    const stmt = check(c.statement, where, notes);
    if (!stmt) continue;
    if (!labels.has(c.ownerSpeaker)) {
      notes.push(`${where}: owner "${c.ownerSpeaker}" isn't a speaker in this transcript; ignored.`);
      continue;
    }
    const resp = c.kind === "self" ? null : check(c.response, `${where} (reply)`, notes);
    commitments.set(c.id, { ...c, by: stmt.speaker, stmt, resp });
  }

  // ---- 3. One verdict per action item ----
  const used = new Set<string>();
  const verdicts: ItemVerdict[] = meeting.actionItems.map((item) => {
    const n: string[] = [];
    const m = ai.items.find((x) => x.actionItemId === item.id);
    if (!m) {
      return { actionItemId: item.id, task: "UNSUPPORTED", owner: "NOT_APPLICABLE", evidence: [], rationale: "The AI gave no answer for this item.", notes: ["Missing from the AI's answer."] };
    }

    const evidence: Evidence[] = [];
    const add = (e: Evidence | null) => e && !evidence.some((x) => x.segmentId === e.segmentId && x.quote === e.quote) && evidence.push(e);
    m.evidence.forEach((q) => add(check(q, "Evidence", n)));

    let c = m.commitmentId ? commitments.get(m.commitmentId) : undefined;
    if (m.commitmentId && !c) n.push("Linked commitment didn't pass the quote check; ignored.");
    if (c) {
      used.add(c.id);
      add(c.stmt);
      add(c.resp);
    }

    // Task
    let task: TaskStatus = ({ supported: "SUPPORTED", weak: "WEAK", unsupported: "UNSUPPORTED", contradicted: "CONTRADICTED" } as const)[m.taskSupport];
    if (task === "SUPPORTED" && !c) {
      task = evidence.length ? "WEAK" : "UNSUPPORTED";
      n.push("Marked supported without a verified commitment; downgraded.");
    }
    if (task !== "UNSUPPORTED" && evidence.length === 0) {
      n.push("No verified quote left; treated as unsupported.");
      task = "UNSUPPORTED";
    }
    if (task === "UNSUPPORTED") {
      evidence.length = 0;
      c = undefined;
    }

    // Owner
    let owner: OwnerStatus;
    const a = item.assignee?.name?.trim();
    let ownerLabels: string[] = [];
    let identity: "known" | "unidentified" | "absent" = "known";
    if (!a) identity = "known";
    else if (isGenericSpeaker(a)) {
      if (labels.has(a) && nameOf(a)) ownerLabels = [a];
      else identity = "unidentified";
    } else {
      ownerLabels = labelsFor(a);
      const invited = meeting.attendees.some((p) => namesMatch(p.name, a));
      if (!ownerLabels.length) identity = unresolved.length ? "unidentified" : invited ? "known" : "absent";
    }

    if (!a) owner = "NO_OWNER";
    else if (identity === "unidentified") owner = "UNIDENTIFIED";
    else if (identity === "absent") owner = "NOT_IN_MEETING";
    else if (!c || task !== "SUPPORTED") owner = "NOT_APPLICABLE";
    else if (c.kind === "self") owner = ownerLabels.includes(c.by) ? "CONFIRMED" : "SOMEONE_ELSE";
    else if (!ownerLabels.includes(c.ownerSpeaker)) owner = "SOMEONE_ELSE";
    else if (c.resp && ownerLabels.includes(c.resp.speaker)) {
      owner = c.ownerResponse === "agreed" ? "CONFIRMED" : c.ownerResponse === "declined_or_hedged" ? "DECLINED" : "NOT_ACKNOWLEDGED";
    } else {
      if (c.resp) n.push(`The reply was spoken by ${nameOf(c.resp.speaker) ?? c.resp.speaker}, not the owner.`);
      owner = "NOT_ACKNOWLEDGED";
    }

    evidence.sort((x, y) => x.start - y.start);
    return { actionItemId: item.id, task, owner, evidence, rationale: m.rationale, notes: n };
  });

  // ---- 4. Commitments with no action item ----
  const covered = new Set(verdicts.flatMap((v) => v.evidence.map((e) => e.segmentId)));
  const missed: MissedTask[] = [...commitments.values()]
    .filter((c) => !used.has(c.id) && !covered.has(c.stmt.segmentId))
    .filter((c) => c.kind === "self" || c.ownerResponse === "agreed" || c.kind === "assigned")
    .map((c) => ({
      task: c.task,
      ownerSpeaker: c.ownerSpeaker,
      ownerName: nameOf(c.ownerSpeaker),
      evidence: [c.stmt, ...(c.resp ? [c.resp] : [])],
    }));

  return { speakers, verdicts, missed, notes };
}
