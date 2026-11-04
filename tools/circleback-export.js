/**
 * Export one of YOUR Circleback meetings as a JSON file this app can read.
 *
 * 1. Open the meeting in Circleback (https://circleback.ai/meetings/<id>) while signed in.
 * 2. Open DevTools → Console, paste this whole file, press Enter.
 * 3. A file named circleback-<id>.json downloads. Upload it on the app's Import page.
 *
 * It reads the same endpoints the Circleback web app uses to show you the meeting.
 * These are not a documented public API and may change. Read-only; nothing is modified.
 */
(async () => {
  const id = location.pathname.split("/").filter(Boolean).pop();
  const get = (p) => fetch(p, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error(`${p} -> ${r.status}`);
    return r.json();
  });
  const m = await get(`/api/meeting/${id}`);
  const segs = [];
  for (let page = 0; page < 200; page++) {
    const t = await get(`/api/meeting/${id}/transcript?page=${page}`);
    if (!t.segments?.length) break;
    segs.push(...t.segments);
    if (t.segments.length < 50) break;
  }
  const name = (p) => (p ? [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email || null : null);
  const seen = new Map();
  const uniqueId = (raw) => {
    const n = (seen.get(raw) ?? 0) + 1;
    seen.set(raw, n);
    return n === 1 ? String(raw) : `${raw}-${n}`;
  };
  const out = {
    id: `cb-${id}`,
    name: m.name,
    createdAt: m.createdAt,
    durationSeconds: Math.round(m.duration ?? 0),
    url: `${location.origin}/meetings/${id}`,
    attendees: (m.attendees ?? []).map((a) => ({ name: name(a.profile) || a.participantName, email: a.profile?.email || undefined })),
    transcript: segs
      .filter((s) => s.words?.length)
      .map((s) => ({
        id: uniqueId(s.id),
        speaker: s.speaker,
        start: s.words[0].startTimestamp,
        end: s.words.at(-1).endTimestamp,
        text: s.words.map((w) => w.text).join(" ").replace(/\s+([,.?!])/g, "$1"),
      })),
    actionItems: (m.actionItems ?? []).map((a) => ({
      id: String(a.id),
      title: a.title,
      description: a.description || undefined,
      assignee: a.assignee ? { name: name(a.assignee.profile) || "Unknown", email: a.assignee.profile?.email || undefined } : null,
    })),
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `circleback-${id}.json` });
  link.click();
  console.log(`Exported ${out.transcript.length} transcript lines and ${out.actionItems.length} action items.`);
})();
