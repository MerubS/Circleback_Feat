import type { ActionItem, Meeting, Person, Segment } from "@/lib/types";

/**
 * Circleback API adapter.
 *
 * IMPORTANT: Circleback's public docs (https://circleback.ai/docs/api) list
 * "List meetings", "Get meeting transcript", "List action items" and
 * "Search meetings", but the field-level reference was not available when this
 * was written. The paths and field names below are best guesses kept in ONE
 * place: check them against the docs with your API key and adjust ENDPOINTS
 * and the map* functions. Everything else in the app only sees our Meeting type.
 */
export const ENDPOINTS = {
  listMeetings: "/meetings",
  getMeeting: (id: string) => `/meetings/${id}`,
  getTranscript: (id: string) => `/meetings/${id}/transcript`,
  listActionItems: (id: string) => `/action-items?meetingId=${encodeURIComponent(id)}`,
};

type Json = Record<string, any>;

async function get(path: string): Promise<any> {
  const base = process.env.CIRCLEBACK_API_BASE ?? "https://app.circleback.ai/api/v1";
  const key = process.env.CIRCLEBACK_API_KEY;
  if (!key) throw new Error("CIRCLEBACK_API_KEY is not set.");
  const res = await fetch(base + path, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`Circleback ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const list = (x: any): Json[] => (Array.isArray(x) ? x : x?.data ?? x?.items ?? x?.results ?? []);

function mapPerson(p: Json): Person {
  return { name: p.name ?? p.displayName ?? p.email ?? "Unknown", email: p.email ?? undefined };
}

const num = (v: any) => (typeof v === "number" ? v : 0);

function mapSegment(s: Json, i: number, scale: number): Segment {
  return {
    id: String(s.id ?? `seg-${i}`),
    speaker: s.speaker?.name ?? s.speaker ?? s.speakerName ?? "Unknown",
    start: num(s.start ?? s.startTime ?? s.timestamp) / scale,
    end: num(s.end ?? s.endTime ?? s.start ?? 0) / scale,
    text: s.text ?? s.content ?? "",
  };
}

/**
 * Seconds or milliseconds, decided once per meeting (not per line, which mixed units:
 * a line at 9,000 ms stayed "9,000 s" while a line at 12,000 ms became 12 s).
 * No meeting runs longer than a day, so anything past 86,400 means milliseconds.
 */
export function timeScale(raw: Json[]): number {
  const max = Math.max(0, ...raw.map((s) => num(s.end ?? s.endTime ?? s.start ?? s.startTime ?? s.timestamp)));
  return max > 86_400 ? 1000 : 1;
}

function mapActionItem(a: Json): ActionItem {
  const who = a.assignee ?? a.owner ?? null;
  return {
    id: String(a.id),
    title: a.title ?? a.name ?? a.text ?? "",
    description: a.description ?? undefined,
    assignee: who ? (typeof who === "string" ? { name: who } : mapPerson(who)) : null,
    dueDate: a.dueDate ?? a.due_date ?? a.due ?? null,
  };
}

export async function listMeetingsFromApi(): Promise<Meeting[]> {
  const raw = list(await get(ENDPOINTS.listMeetings)).slice(0, 25);
  return raw.map((m) => ({
    id: String(m.id),
    name: m.name ?? m.title ?? "Untitled meeting",
    createdAt: m.createdAt ?? m.date ?? new Date().toISOString(),
    durationSeconds: typeof m.duration === "number" ? Math.round(m.duration / (m.duration > 86_400 ? 1000 : 1)) : 0,
    attendees: list(m.attendees ?? m.participants ?? []).map(mapPerson),
    transcript: [],
    actionItems: [],
    url: m.url,
  }));
}

export async function getMeetingFromApi(id: string): Promise<Meeting> {
  const [m, t, a] = await Promise.all([
    get(ENDPOINTS.getMeeting(id)),
    get(ENDPOINTS.getTranscript(id)),
    get(ENDPOINTS.listActionItems(id)),
  ]);
  const rawSegments = list(t?.segments ?? t);
  const scale = timeScale(rawSegments);
  const transcript = rawSegments.map((s, i) => mapSegment(s, i, scale));
  return {
    id: String(m.id ?? id),
    name: m.name ?? m.title ?? "Untitled meeting",
    createdAt: m.createdAt ?? m.date ?? new Date().toISOString(),
    // shortcut: assumes the duration uses the same unit as the transcript; confirm against Circleback's API docs.
    durationSeconds: Math.round(typeof m.duration === "number" ? m.duration / scale : (transcript.at(-1)?.end ?? 0)),
    attendees: list(m.attendees ?? m.participants ?? []).map(mapPerson),
    transcript,
    actionItems: list(a).map(mapActionItem),
    url: m.url,
  };
}
