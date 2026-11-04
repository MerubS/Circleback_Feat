import Link from "next/link";
import { listMeetings, source } from "@/lib/circleback/source";
import { store } from "@/lib/store";
import { isClean } from "@/components/LabelBadge";

export const dynamic = "force-dynamic";

export default async function Home() {
  const meetings = await listMeetings();
  const reports = await Promise.all(meetings.map((m) => store.latest(m.id)));

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          The AI reads each meeting once, lists every promise and assignment, and checks each action item against them. Every
          item gets two answers: <b>is the task backed by the transcript</b>, and <b>did the named owner take it on</b>. Code then
          checks that every quote really appears in the transcript.
        </p>
        <p className="text-xs text-zinc-500">Source: {source() === "sample" ? "meeting files in data/" : "Circleback API"}</p>
      </section>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {meetings.map((m, i) => {
          const r = reports[i];
          const ok = r ? r.verdicts.filter((v) => isClean(v.task, v.owner, !!v.suggestion)).length : 0;
          const flagged = r ? r.verdicts.length - ok : 0;
          return (
            <li key={m.id}>
              <Link
                href={`/meetings/${m.id}`}
                className="block h-full rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
              >
                <div className="font-medium">{m.name}</div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {new Date(m.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} ·{" "}
                  {m.actionItems.length} action items
                </div>
                <div className="mt-3 text-sm">
                  {!r ? (
                    <span className="text-xs text-zinc-500">Not verified yet</span>
                  ) : (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      <span className="text-emerald-700 dark:text-emerald-400">{ok} look fine</span>
                      {flagged > 0 && <span className="text-rose-700 dark:text-rose-400">{flagged} need a look</span>}
                      {r.verdicts.some((v) => v.suggestion) && (
                        <span className="font-medium text-rose-700 dark:text-rose-400">{r.verdicts.filter((v) => v.suggestion).length} owner fix(es)</span>
                      )}
                      {r.missed.length > 0 && <span className="text-amber-700 dark:text-amber-400">{r.missed.length} possibly missed</span>}
                    </div>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
