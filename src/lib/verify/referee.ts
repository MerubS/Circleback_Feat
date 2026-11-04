import type {
  AiCommitment,
  AiReading,
  Evidence,
  ItemVerdict,
  Meeting,
  MissedTask,
  OwnerResponse,
  OwnerStatus,
  OwnerSuggestion,
  Quote,
  SpeakerIdentity,
  TaskStatus,
} from "@/lib/types";
import { containsQuote, fuzzyScore, isGenericSpeaker, isSubstantial, namesMatch, normalize, sentenceWordIndex, wordIndex } from "./text";

/** Share of a quote's words that must appear in the line to count as a paraphrase. */
const FUZZY_MIN = 0.6;
/** A self-introduction names the speaker within this many words of the start of their line. */
const SELF_INTRO_MAX_WORD = 6;
/** A "self" promise counts as a clear yes unless the AI judged it a maybe or a no. */
const selfFirm = (r: OwnerResponse) => r !== "hedged" && r !== "declined";

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

  /**
   * A quote counts only if it appears word for word in the line it cites, and is long enough to
   * prove something (2+ words, or the whole line). With `fuzzy`, a close paraphrase is kept but
   * marked, so it can never prove more than Weak.
   */
  function check(q: Quote | null | undefined, where: string, out: string[], fuzzy = false): Evidence | null {
    if (!q) return null;
    const s = seg.get(q.segmentId);
    if (!s) {
      out.push(`${where}: cited line ${q.segmentId} doesn't exist; ignored.`);
      return null;
    }
    // The model sometimes copies the "Speaker:" prefix from the prompt; drop it only if it names this line's speaker.
    let text = q.quote.trim();
    if (text.startsWith(`${s.speaker}:`)) text = text.slice(s.speaker.length + 1).trim();
    else {
      const other = [...labels].find((l) => text.startsWith(`${l}:`));
      if (other) {
        out.push(`${where}: quote is credited to ${other}, but line ${q.segmentId} is spoken by ${s.speaker}; ignored.`);
        return null;
      }
    }
    const nq = normalize(text);
    const nl = normalize(s.text);
    if (!isSubstantial(nq) && !(nq && nq === nl)) {
      out.push(`${where}: quote in line ${q.segmentId} is too short or only punctuation; ignored.`);
      return null;
    }
    const ev: Evidence = { segmentId: s.id, quote: text, speaker: s.speaker, start: s.start };
    if (containsQuote(nl, nq)) return ev;
    if (fuzzy && fuzzyScore(nq, nl) >= FUZZY_MIN) {
      out.push(`${where}: quote in line ${q.segmentId} is paraphrased, not word for word; counts as weak at most.`);
      return { ...ev, fuzzy: true };
    }
    out.push(`${where}: quote not found in line ${q.segmentId}; ignored.`);
    return null;
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
    if (wordIndex(ev.quote, g.name) < 0) {
      notes.push(`${where}: the quote doesn't contain the name; ignored.`);
      continue;
    }
    if (ev.speaker === g.speaker) {
      // They said the name themselves. Saying a name is usually talking TO someone ("That Steph is
      // your part"), so it counts only if the AI calls it a self-introduction AND the name comes
      // early in its sentence ("My name is Elima"). shortcut: position-based, misses "...and that's me, Laura".
      if (g.how !== "self_intro") {
        notes.push(`${where}: ${g.speaker} says the name but isn't introducing themselves; ignored.`);
        continue;
      }
      if (sentenceWordIndex(seg.get(ev.segmentId)!.text, g.name) > SELF_INTRO_MAX_WORD) {
        notes.push(`${where}: ${g.speaker} says the name mid-sentence, likely to someone else; ignored.`);
        continue;
      }
    } else {
      // Someone else named them: they must speak within the next two lines (a hand-over).
      const i = pos.get(ev.segmentId)!;
      if (!meeting.transcript.slice(i + 1, i + 3).some((s) => s.speaker === g.speaker)) {
        notes.push(`${where}: ${g.speaker} doesn't speak right after being named; ignored.`);
        continue;
      }
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
  type Owner = { raw: string; labels: string[]; name: string };
  type Checked = AiCommitment & { by: string; stmt: Evidence; resp: Evidence | null; who: Owner[] };
  const commitments = new Map<string, Checked>();
  const paraphrased = new Map<string, Evidence>(); // commitments whose statement was close but not exact
  for (const c of ai.commitments) {
    const where = `Commitment "${c.task}"`;
    const stmt = check(c.statement, where, notes, true);
    if (!stmt) continue;
    if (stmt.fuzzy) {
      paraphrased.set(c.id, stmt);
      continue;
    }
    // A "self" promise must list its own speaker. If it doesn't, the speaker handed the task out
    // (e.g. a manager giving roles), so treat it as an assignment rather than adding them as owner.
    const kind = c.kind === "self" && !c.owners.map((o) => o.trim()).includes(stmt.speaker) ? "assigned" : c.kind;
    const who: Owner[] = [];
    for (const raw of c.owners.map((o) => o.trim())) {
      if (!raw || who.some((w) => w.raw === raw)) continue;
      if (labels.has(raw)) who.push({ raw, labels: [raw], name: nameOf(raw) ?? raw });
      else if (wordIndex(stmt.quote, raw) >= 0) {
        const ls = labelsFor(raw);
        who.push({ raw, labels: ls, name: ls.length ? nameOf(ls[0])! : raw });
      } else notes.push(`${where}: owner "${raw}" doesn't speak and isn't named in the quote; ignored.`);
    }
    if (!who.length) {
      notes.push(`${where}: no owner could be verified; ignored.`);
      continue;
    }
    const resp = kind === "self" ? null : check(c.response, `${where} (reply)`, notes);
    commitments.set(c.id, { ...c, kind, by: stmt.speaker, stmt, resp, who });
  }

  // ---- 3. One verdict per action item ----
  const used = new Set<string>();
  const verdicts: ItemVerdict[] = meeting.actionItems.map((item) => {
    const n: string[] = [];
    const m = ai.items.find((x) => x.actionItemId === item.id);
    if (!m) {
      // Skipped by the AI is not the same as "not in the meeting": nobody looked.
      return { actionItemId: item.id, task: "NOT_CHECKED", owner: "NOT_APPLICABLE", evidence: [], rationale: "The AI skipped this item, so it wasn't checked. Run Verify again.", notes: ["Missing from the AI's answer."] };
    }

    const evidence: Evidence[] = [];
    const add = (e: Evidence | null) => e && !evidence.some((x) => x.segmentId === e.segmentId && x.quote === e.quote) && evidence.push(e);
    m.evidence.forEach((q) => add(check(q, "Evidence", n, true)));

    let c = m.commitmentId ? commitments.get(m.commitmentId) : undefined;
    if (m.commitmentId && !c) {
      const p = paraphrased.get(m.commitmentId);
      if (p) {
        add(p);
        n.push("Linked commitment was paraphrased, not quoted word for word; it can't prove the task.");
      } else n.push("Linked commitment didn't pass the quote check; ignored.");
    }
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
    if ((task === "SUPPORTED" || task === "CONTRADICTED") && evidence.length && evidence.every((e) => e.fuzzy)) {
      task = "WEAK";
      n.push("Only paraphrased quotes, none word for word; weak at most.");
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

    // Who the meeting says should own it, compared with Circleback's assignee.
    let suggestion: OwnerSuggestion | undefined;
    let assigneeAmongOwners = false;
    if (c && task === "SUPPORTED" && identity !== "unidentified") {
      const cc = c;
      const isAssignee = (w: Owner) =>
        !!a && (w.labels.some((l) => ownerLabels.includes(l)) || (!w.labels.length && namesMatch(w.name, a)));
      const saidYes = (w: Owner) =>
        w.labels.some(
          (l) => (cc.kind === "self" && l === cc.by && selfFirm(cc.ownerResponse)) || (cc.resp?.speaker === l && cc.ownerResponse === "committed"),
        );
      const others = cc.who.filter((w) => !isAssignee(w));
      assigneeAmongOwners = others.length < cc.who.length;
      if (others.length)
        suggestion = {
          action: assigneeAmongOwners ? "add_owners" : "reassign",
          owners: others.map((w) => ({ name: w.name, speaker: w.labels[0], confirmed: saidYes(w) })),
          evidence: [cc.stmt, ...(cc.resp ? [cc.resp] : [])],
        };
    }

    if (!a) owner = "NO_OWNER";
    else if (identity === "unidentified") owner = "UNIDENTIFIED";
    else if (identity === "absent") owner = "NOT_IN_MEETING";
    else if (!c || task !== "SUPPORTED") owner = "NOT_APPLICABLE";
    else if (!assigneeAmongOwners) owner = "SOMEONE_ELSE";
    else if (c.kind === "self" && ownerLabels.includes(c.by)) {
      // Their own promise: confirmed unless it was a maybe ("I might look into it").
      owner = c.ownerResponse === "hedged" ? "WEAK" : c.ownerResponse === "declined" ? "DECLINED" : "CONFIRMED";
    } else if (c.resp && ownerLabels.includes(c.resp.speaker)) {
      // Only a clear yes confirms; "I'll try" or a bare "mm-hmm" is weak.
      const r = c.ownerResponse;
      owner = r === "committed" ? "CONFIRMED" : r === "hedged" ? "WEAK" : r === "declined" ? "DECLINED" : "NOT_ACKNOWLEDGED";
    } else {
      if (c.resp) n.push(`The reply was spoken by ${nameOf(c.resp.speaker) ?? c.resp.speaker}, not the owner.`);
      owner = "NOT_ACKNOWLEDGED";
    }

    evidence.sort((x, y) => x.start - y.start);
    return { actionItemId: item.id, task, owner, evidence, rationale: m.rationale, notes: n, ...(suggestion && { suggestion }) };
  });

  // ---- 4. Commitments with no action item ----
  const covered = new Set(verdicts.flatMap((v) => v.evidence.map((e) => e.segmentId)));
  const missed: MissedTask[] = [...commitments.values()]
    .filter((c) => !used.has(c.id) && !covered.has(c.stmt.segmentId))
    // A task the owner turned down isn't a missed task.
    .filter((c) => c.ownerResponse !== "declined")
    .filter((c) => c.kind === "self" || c.kind === "assigned" || c.ownerResponse === "committed")
    .map((c) => ({
      task: c.task,
      owners: c.who.map((w) => w.name),
      evidence: [c.stmt, ...(c.resp ? [c.resp] : [])],
    }));

  return { speakers, verdicts, missed, notes };
}
