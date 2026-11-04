"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Decision, FlagKind } from "@/lib/fixes";
import type { Person } from "@/lib/types";

/** Accept the fix, reassign the item, or dismiss the flag: one click each. */
export function FlagActions({
  meetingId,
  itemId,
  flag,
  acceptLabel,
  attendees,
  decision,
}: {
  meetingId: string;
  itemId: string;
  flag: FlagKind;
  acceptLabel: string;
  attendees: Person[];
  decision?: Decision;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  if (decision)
    return (
      <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
        <span className={`mr-1 font-medium ${decision.action === "dismiss" ? "" : "text-emerald-700 dark:text-emerald-400"}`}>
          {decision.action === "dismiss" ? "Dismissed" : decision.action === "reassign" ? "Reassigned" : "Accepted"}
        </span>
        · {decision.message}
      </p>
    );

  async function send(action: "accept" | "reassign" | "dismiss", assignee?: Person) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/meetings/${meetingId}/flags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, flag, action, assignee }),
    });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "That didn't work");
    router.refresh();
  }

  const btn = "rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40";
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button disabled={busy} onClick={() => send("accept")} className={`${btn} bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900`}>
          {acceptLabel}
        </button>
        {picking ? (
          <select
            autoFocus
            disabled={busy}
            aria-label="Reassign to"
            defaultValue=""
            onChange={(e) => {
              const p = attendees[Number(e.target.value)];
              if (p) send("reassign", { name: p.name, ...(p.email && { email: p.email }) });
            }}
            onBlur={() => setPicking(false)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="" disabled>
              Reassign to…
            </option>
            {attendees.map((p, i) => (
              <option key={i} value={i}>
                {p.name}
                {p.email ? ` <${p.email}>` : ""}
              </option>
            ))}
          </select>
        ) : (
          <button disabled={busy || !attendees.length} onClick={() => setPicking(true)} className={`${btn} ring-1 ring-inset ring-zinc-300 hover:bg-zinc-100 dark:ring-zinc-700 dark:hover:bg-zinc-800`}>
            Reassign…
          </button>
        )}
        <button disabled={busy} onClick={() => send("dismiss")} className={`${btn} text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800`}>
          Dismiss
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-rose-700 dark:text-rose-400">{error}</p>}
    </div>
  );
}
