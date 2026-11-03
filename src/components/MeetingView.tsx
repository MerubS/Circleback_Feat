"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LABELS, LABEL_TEXT, type Label, type Meeting, type VerificationReport } from "@/lib/types";
import { LabelBadge, fmtTime } from "./LabelBadge";

const OWNER_TEXT: Record<string, string> = {
  present: "on the call",
  not_present: "not on the call",
  unidentified: "unidentified speaker",
  unassigned: "no owner",
};

export function MeetingView({
  meeting,
  report,
  links,
  hasOpenAI,
}: {
  meeting: Meeting;
  report: VerificationReport | null;
  links: Record<string, string>;
  hasOpenAI: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [filter, setFilter] = useState<Label | "ALL">("ALL");

  const verdicts = useMemo(() => new Map(report?.verdicts.map((v) => [v.actionItemId, v])), [report]);
  const cited = useMemo(() => new Set(report?.verdicts.flatMap((v) => v.evidence.map((e) => e.segmentId))), [report]);

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) setActive(id);
  }, []);

  async function run(judge?: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/meetings/${meeting.id}/verify${judge ? `?judge=${judge}` : ""}`, { method: "POST" });
    setBusy(false);
    if (!res.ok) return setError((await res.json()).error ?? "Verification failed");
    router.refresh();
  }

  function jump(segmentId: string) {
    const href = links[segmentId];
    if (href && !href.startsWith("/")) return void window.open(href, "_blank");
    setActive(segmentId);
    document.getElementById(segmentId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    history.replaceState(null, "", `#${segmentId}`);
  }

  const counts = Object.fromEntries(LABELS.map((l) => [l, 0])) as Record<Label, number>;
  report?.verdicts.forEach((v) => counts[v.label]++);
  const items = meeting.actionItems.filter((a) => filter === "ALL" || verdicts.get(a.id)?.label === filter);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{meeting.name}</h1>
          <p className="text-sm text-zinc-500">
            {meeting.attendees.map((a) => a.name).join(", ")} · {fmtTime(meeting.durationSeconds)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => run("heuristic")}
            disabled={busy}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            Quick check (offline)
          </button>
          <button
            onClick={() => run("openai")}
            disabled={busy || !hasOpenAI}
            title={hasOpenAI ? "" : "Add OPENAI_API_KEY to .env"}
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {busy ? "Verifying…" : "Verify with AI"}
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-300">{error}</p>}

      {report && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            onClick={() => setFilter("ALL")}
            className={`rounded-full px-3 py-1 ${filter === "ALL" ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "bg-zinc-200/60 dark:bg-zinc-800"}`}
          >
            All {report.verdicts.length}
          </button>
          {LABELS.map((l) => (
            <button
              key={l}
              onClick={() => setFilter(l)}
              className={`rounded-full px-3 py-1 ${filter === l ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "bg-zinc-200/60 dark:bg-zinc-800"}`}
            >
              {LABEL_TEXT[l]} {counts[l]}
            </button>
          ))}
          <span className="ml-auto text-xs text-zinc-500">
            Judge: {report.judge} · {new Date(report.createdAt).toLocaleString()}
          </span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_minmax(0,26rem)]">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Action items</h2>
          {!report && (
            <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
              Not verified yet. Run a check to label each item.
            </p>
          )}
          {items.map((a) => {
            const v = verdicts.get(a.id);
            return (
              <article
                key={a.id}
                className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-medium">{a.title}</h3>
                    <p className="text-xs text-zinc-500">
                      Owner: {a.assignee?.name ?? "none"}
                      {v && ` · ${OWNER_TEXT[v.ownerStatus]}${v.ownerStatus === "present" ? (v.ownerAgreed ? ", agreed" : ", did not agree") : ""}`}
                    </p>
                  </div>
                  {v && <LabelBadge label={v.label} />}
                </div>
                {v && (
                  <>
                    <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{v.rationale}</p>
                    {v.evidence.length > 0 && (
                      <ul className="mt-3 space-y-2">
                        {v.evidence.map((e, i) => (
                          <li key={i}>
                            <button
                              onClick={() => jump(e.segmentId)}
                              className="group flex w-full gap-3 rounded-lg bg-zinc-50 p-2.5 text-left text-sm hover:bg-zinc-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800"
                            >
                              <span className="shrink-0 font-mono text-xs text-blue-700 group-hover:underline dark:text-blue-400">
                                {fmtTime(e.start)}
                              </span>
                              <span>
                                <span className="font-medium">{e.speaker}:</span> “{e.quote}”
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {v.guardrailNotes.length > 0 && (
                      <details className="mt-2 text-xs text-zinc-500">
                        <summary className="cursor-pointer">Guardrail notes ({v.guardrailNotes.length})</summary>
                        <ul className="ml-4 mt-1 list-disc">
                          {v.guardrailNotes.map((n, i) => (
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

        <section className="lg:sticky lg:top-4 lg:self-start">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Transcript</h2>
          <ol className="max-h-[75vh] space-y-1 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
            {meeting.transcript.map((s) => (
              <li
                key={s.id}
                id={s.id}
                className={`scroll-mt-24 rounded-lg p-2 text-sm transition-colors ${
                  active === s.id
                    ? "bg-yellow-100 ring-1 ring-yellow-400 dark:bg-yellow-900/40"
                    : cited.has(s.id)
                      ? "bg-zinc-50 dark:bg-zinc-800/50"
                      : ""
                }`}
              >
                <div className="flex gap-2 text-xs text-zinc-500">
                  <span className="font-mono">{fmtTime(s.start)}</span>
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">{s.speaker}</span>
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
