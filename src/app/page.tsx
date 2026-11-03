import Link from "next/link";
import { listMeetings, source } from "@/lib/circleback/source";
import { store } from "@/lib/store";
import { LABELS, type Label } from "@/lib/types";
import { LabelBadge } from "@/components/LabelBadge";

export const dynamic = "force-dynamic";

export default async function Home() {
  const meetings = await listMeetings();
  const reports = await Promise.all(meetings.map((m) => store.latest(m.id)));

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Each action item gets one of four labels: <b>Supported</b> with the quote and timestamp, <b>Weak</b> when it was
          discussed but nobody committed, <b>Unsupported</b> when nothing in the transcript backs it, and{" "}
          <b>Owner not confirmed</b> when the named person never agreed or wasn&apos;t on the call.
        </p>
        <p className="text-xs text-zinc-500">
          Source: {source() === "sample" ? "sample meetings" : "Circleback API"}
        </p>
      </section>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {meetings.map((m, i) => {
          const r = reports[i];
          const counts = Object.fromEntries(LABELS.map((l) => [l, 0])) as Record<Label, number>;
          r?.verdicts.forEach((v) => counts[v.label]++);
          const flagged = r ? r.verdicts.filter((v) => v.label !== "SUPPORTED").length : 0;
          return (
            <li key={m.id}>
              <Link
                href={`/meetings/${m.id}`}
                className="block h-full rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
              >
                <div className="font-medium">{m.name}</div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {new Date(m.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  {" · "}
                  {m.attendees.length} attendees{m.actionItems.length ? ` · ${m.actionItems.length} action items` : ""}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {r ? (
                    LABELS.filter((l) => counts[l]).map((l) => (
                      <span key={l} className="flex items-center gap-1 text-xs">
                        <LabelBadge label={l} />
                        <span className="text-zinc-500">×{counts[l]}</span>
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-zinc-500">Not verified yet</span>
                  )}
                </div>
                {r && flagged > 0 && (
                  <div className="mt-2 text-xs text-rose-700 dark:text-rose-400">{flagged} item(s) need a look</div>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
