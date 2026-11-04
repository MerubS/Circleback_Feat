"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ImportPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: await file.text() });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error);
    router.push(`/meetings/${data.id}`);
  }

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Import a Circleback meeting</h1>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
        <li>Open the meeting in Circleback while signed in.</li>
        <li>
          Open your browser&apos;s DevTools console, paste the contents of <code className="rounded bg-zinc-200/70 px-1 dark:bg-zinc-800">tools/circleback-export.js</code>, and press Enter.
        </li>
        <li>Upload the downloaded <code className="rounded bg-zinc-200/70 px-1 dark:bg-zinc-800">circleback-….json</code> file here.</li>
      </ol>
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 bg-white p-8 text-sm text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{busy ? "Importing…" : "Choose a JSON file"}</span>
        <span>Meetings are saved in data/imported/</span>
        <input type="file" accept="application/json,.json" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>
      {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-300">{error}</p>}
    </div>
  );
}
