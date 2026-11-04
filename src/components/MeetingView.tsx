"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CHECK_TEXT, type Evidence, type Meeting, type SuggestedOwner, type VerificationReport } from "@/lib/types";
import { type Decision, decisionKey, openFlags } from "@/lib/fixes";
import { FlagActions } from "./FlagActions";
import { OwnerBadge, TaskBadge, fmtTime, isClean } from "./LabelBadge";

type Filter = "ALL" | "FLAGGED" | "OK";

export function MeetingView({
  meeting,
  report,
  links,
  hasKey,
  decisions,
}: {
  meeting: Meeting;
  report: VerificationReport | null;
  links: Record<string, string>;
  hasKey: boolean;
  decisions: Record<string, Decision>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");

  const verdicts = useMemo(() => new Map(report?.verdicts.map((v) => [v.actionItemId, v])), [report]);
  const cited = useMemo(
    () => new Set([...(report?.verdicts ?? []).flatMap((v) => v.evidence), ...(report?.missed ?? []).flatMap((m) => m.evidence)].map((e) => e.segmentId)),
    [report],
  );
  const names = useMemo(() => Object.fromEntries((report?.speakers ?? []).filter((s) => s.source === "ai").map((s) => [s.speaker, s.name])), [report]);
  const who = (label: string) => (names[label] ? `${names[label]} (${label})` : label);
  const ownerName = (o: SuggestedOwner) => (o.speaker && o.speaker !== o.name ? `${o.name} (${o.speaker})` : o.name);

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) setActive(id);
  }, []);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/meetings/${meeting.id}/verify`, { method: "POST" });
    setBusy(false);
    if (!res.ok) return setError((await res.json()).error ?? "Verification failed");
    router.refresh();
  }

  function jump(segmentId: string) {
    setActive(segmentId);
    const el = document.getElementById(segmentId);
    const list = el?.parentElement;
    if (el && list) {
      if (list.scrollHeight > list.clientHeight) list.scrollTo({ top: el.offsetTop - list.clientHeight / 3, behavior: "smooth" });
      else el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    history.replaceState(null, "", `#${segmentId}`);
  }

  const Quote = ({ e }: { e: Evidence }) => (
    <button
      onClick={() => jump(e.segmentId)}
      className="group flex w-full gap-3 rounded-lg bg-zinc-50 p-2.5 text-left text-sm hover:bg-zinc-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800"
    >
      <span className="shrink-0 font-mono text-xs text-blue-700 group-hover:underline dark:text-blue-400">{fmtTime(e.start)}</span>
      <span>
        <span className="font-medium">{who(e.speaker)}:</span> “{e.quote}”
        {e.fuzzy && (
          <span title="Close to the transcript line but not word for word" className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            paraphrased
          </span>
        )}
      </span>
    </button>
  );

  const flaggedCount = report ? report.verdicts.filter((v) => !isClean(v.task, v.owner, openFlags(v, decisions).length > 0)).length : 0;
  const items = meeting.actionItems.filter((a) => {
    const v = verdicts.get(a.id);
    if (filter === "ALL" || !v) return true;
    return filter === "OK" ? isClean(v.task, v.owner, openFlags(v, decisions).length > 0) : !isClean(v.task, v.owner, openFlags(v, decisions).length > 0);
  });
  const aiNamed = (report?.speakers ?? []).filter((s) => s.source === "ai");
  const pill = (f: Filter, label: string) => (
    <button
      onClick={() => setFilter(f)}
      className={`rounded-full px-3 py-1 ${filter === f ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "bg-zinc-200/60 dark:bg-zinc-800"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{meeting.name}</h1>
          <p className="text-sm text-zinc-500">
            {meeting.attendees.map((a) => who(a.name)).join(", ")} · {fmtTime(meeting.durationSeconds)}
          </p>
        </div>
        <div className="text-right">
          <button
            onClick={run}
            disabled={busy}
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {busy ? "Reading the meeting…" : report ? "Verify again" : "Verify with AI"}
          </button>
          {!hasKey && <p className="mt-1 text-xs text-zinc-500">Needs OPENAI_API_KEY in .env</p>}
        </div>
      </div>

      {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-300">{error}</p>}

      {report && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {pill("ALL", `All ${report.verdicts.length}`)}
          {pill("FLAGGED", `Need a look ${flaggedCount}`)}
          {pill("OK", `Look fine ${report.verdicts.length - flaggedCount}`)}
          <span className="ml-auto text-xs text-zinc-500">
            {report.model} · {new Date(report.createdAt).toLocaleString()}
          </span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_minmax(0,26rem)]">
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Action items</h2>
            {!report && (
              <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
                Not verified yet. The AI will read the whole meeting once and check every item.
              </p>
            )}
            {items.map((a) => {
              const v = verdicts.get(a.id);
              return (
                <article key={a.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <h3 className="font-medium">{a.title}</h3>
                  <p className="text-xs text-zinc-500">Owner in notes: {a.assignee?.name ? who(a.assignee.name) : "none"}</p>
                  {v && (
                    <>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <TaskBadge task={v.task} />
                        <OwnerBadge owner={v.owner} />
                      </div>
                      {v.suggestion && (
                        <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm dark:border-rose-800 dark:bg-rose-950/40">
                          <p className="font-semibold text-rose-900 dark:text-rose-200">
                            Owner fix: {v.suggestion.action === "reassign" ? "reassign" : "add co-owner"}
                          </p>
                          <p className="mt-1 text-rose-900 dark:text-rose-200">
                            {a.assignee?.name ? who(a.assignee.name) : "No owner"} →{" "}
                            <b>
                              {[...(v.suggestion.action === "add_owners" && a.assignee?.name ? [who(a.assignee.name)] : []), ...v.suggestion.owners.map(ownerName)].join(" + ")}
                            </b>
                          </p>
                          <ul className="mt-1 space-y-0.5 text-xs text-rose-800 dark:text-rose-300">
                            {v.suggestion.owners.map((o) => (
                              <li key={o.name}>
                                {ownerName(o)}: {o.confirmed ? "said yes themselves" : "named by someone else, hasn't confirmed"}
                                {o.attendee && (
                                  <span className="text-rose-700/80 dark:text-rose-300/80">
                                    {" "}
                                    · set assignee to {o.attendee.email ? `${o.attendee.name} <${o.attendee.email}>` : `attendee "${o.attendee.name}"`}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                          <ul className="mt-2 space-y-2">
                            {v.suggestion.evidence.map((e, i) => (
                              <li key={i}>
                                <Quote e={e} />
                              </li>
                            ))}
                          </ul>
                          <FlagActions
                            meetingId={meeting.id}
                            itemId={a.id}
                            flag="owner"
                            acceptLabel={v.suggestion.action === "reassign" ? `Assign to ${v.suggestion.owners[0].name}` : "Note co-owner"}
                            attendees={meeting.attendees}
                            decision={decisions[decisionKey(a.id, "owner")]}
                          />
                        </div>
                      )}
                      {v.checks?.map((c) => (
                        <div key={c.kind} className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
                          <p className="font-semibold text-amber-900 dark:text-amber-200">{CHECK_TEXT[c.kind]}</p>
                          <p className="mt-1 text-amber-900 dark:text-amber-200">{c.detail}</p>
                          <ul className="mt-2 space-y-2">
                            {c.evidence.map((e, i) => (
                              <li key={i}>
                                <Quote e={e} />
                              </li>
                            ))}
                          </ul>
                          <FlagActions
                            meetingId={meeting.id}
                            itemId={a.id}
                            flag={c.kind}
                            acceptLabel={c.kind === "already_done" ? "Mark done" : "Add note to item"}
                            attendees={meeting.attendees}
                            decision={decisions[decisionKey(a.id, c.kind)]}
                          />
                        </div>
                      ))}
                      <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{v.rationale}</p>
                      {v.evidence.length > 0 && (
                        <ul className="mt-3 space-y-2">
                          {v.evidence.filter((e) => !v.suggestion?.evidence.some((s) => s.segmentId === e.segmentId && s.quote === e.quote)).map((e, i) => (
                            <li key={i}>
                              <Quote e={e} />
                            </li>
                          ))}
                        </ul>
                      )}
                      {v.notes.length > 0 && (
                        <details className="mt-2 text-xs text-zinc-500">
                          <summary className="cursor-pointer">Referee notes ({v.notes.length})</summary>
                          <ul className="ml-4 mt-1 list-disc">
                            {v.notes.map((n, i) => (
                              <li key={i}>{n}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </>
                  )}
                </article>
              );
            })}
          </section>

          {report && report.missed.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Possibly missed by the notetaker</h2>
              {report.missed.map((m, i) => (
                <article key={i} className="rounded-xl border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-800 dark:bg-amber-950/30">
                  <h3 className="font-medium">{m.task}</h3>
                  <p className="mb-2 text-xs text-zinc-500">Would be owned by {m.owners.join(" + ")}</p>
                  <ul className="space-y-2">
                    {m.evidence.map((e, j) => (
                      <li key={j}>
                        <Quote e={e} />
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </section>
          )}

          {aiNamed.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Speakers the AI identified</h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {aiNamed.map((s) => (
                  <li key={s.speaker} className="rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="mb-2">
                      <b>{s.speaker}</b> is <b>{s.name}</b>
                    </div>
                    {s.evidence && <Quote e={s.evidence} />}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {report && report.notes.length > 0 && (
            <details className="text-xs text-zinc-500">
              <summary className="cursor-pointer">Referee rejected {report.notes.length} AI claim(s)</summary>
              <ul className="ml-4 mt-1 list-disc">
                {report.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <section className="lg:sticky lg:top-4 lg:self-start">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Transcript</h2>
          <ol className="relative max-h-[75vh] space-y-1 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
            {meeting.transcript.map((s) => (
              <li
                key={s.id}
                id={s.id}
                className={`scroll-mt-24 rounded-lg p-2 text-sm transition-colors ${
                  active === s.id ? "bg-yellow-100 ring-1 ring-yellow-400 dark:bg-yellow-900/40" : cited.has(s.id) ? "bg-zinc-50 dark:bg-zinc-800/50" : ""
                }`}
              >
                <div className="flex gap-2 text-xs text-zinc-500">
                  {links[s.id] && !links[s.id].startsWith("/") ? (
                    <a href={links[s.id]} target="_blank" rel="noreferrer" title="Open this moment in Circleback" className="font-mono text-blue-700 hover:underline dark:text-blue-400">
                      {fmtTime(s.start)} ↗
                    </a>
                  ) : (
                    <span className="font-mono">{fmtTime(s.start)}</span>
                  )}
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">{who(s.speaker)}</span>
                </div>
                <p className="mt-0.5">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
