import type { ActionItem, Meeting, Person, Segment } from "@/lib/types";

/**
 * Circleback REST API (https://circleback.ai/docs/api). Base https://circleback.ai/api,
 * bearer key "cb_...". Paths and fields below are from the published reference.
 * Rate limits: Free 3/s and 20/min, paid 20/s and 300/min; 429 carries Retry-After.
 */
const BASE = () => process.env.CIRCLEBACK_API_BASE || "https://circleback.ai/api";

export const ENDPOINTS = {
  listMeetings: "/meetings",
  getMeeting: (id: string) => `/meeting/${encodeURIComponent(id)}`,
  getTranscript: (id: string) => `/meeting/${encodeURIComponent(id)}/transcript`,
  updateActionItem: (id: number) => `/action-item/${id}`,
};

type Json = Record<string, any>;

export class CirclebackError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call(path: string, init: RequestInit = {}): Promise<any> {
  const key = process.env.CIRCLEBACK_API_KEY;
  if (!key) throw new CirclebackError("CIRCLEBACK_API_KEY is not set.", 0);
  const res = await fetch(BASE() + path, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
  });
  if (res.status === 429) throw new CirclebackError(`Circleback rate limit; retry in ${res.headers.get("retry-after") ?? "a few"} seconds.`, 429);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new CirclebackError(`Circleback ${init.method ?? "GET"} ${path} -> ${res.status}: ${body.error ?? res.statusText}`, res.status);
  }
  return res.json();
}

const list = (x: any): Json[] => (Array.isArray(x) ? x : x?.data ?? x?.items ?? []);
const num = (v: any) => (typeof v === "number" ? v : 0);

/** Circleback's link to a meeting (the API's `url` is the Zoom/Meet link, not this). */
export const meetingLink = (circlebackId: string) => `https://circleback.ai/meetings/${circlebackId}`;

/** Our meeting id for a Circleback meeting, and back. */
export const localId = (circlebackId: string) => `cb-${circlebackId}`;
export const circlebackIdOf = (m: Meeting) => m.circlebackId ?? (m.id.startsWith("cb-") ? m.id.slice(3) : null);

export function mapPerson(p: Json): Person {
  const name = p.name ?? ([p.firstName, p.lastName].filter(Boolean).join(" ") || null);
  return { name: name ?? p.email ?? "Unknown", ...(p.email && { email: p.email }), ...(typeof p.profileId === "number" && { profileId: p.profileId }) };
}

/**
 * Seconds or milliseconds, decided once per meeting (not per line, which mixed units:
 * a line at 9,000 ms stayed "9,000 s" while a line at 12,000 ms became 12 s).
 * The docs say seconds; this guards against a change. No meeting runs past a day.
 */
export function timeScale(raw: Json[]): number {
  const max = Math.max(0, ...raw.map((s) => num(s.end ?? s.endTime ?? s.start ?? s.startTime ?? s.timestamp)));
  return max > 86_400 ? 1000 : 1;
}

/** Circleback segments are { speaker, text, timestamp (start, seconds) }; a line ends where the next starts. */
export function mapTranscript(raw: Json[]): Segment[] {
  const scale = timeScale(raw);
  return raw
    .filter((s) => typeof s.text === "string" && s.text.trim())
    .map((s, i, all) => {
      const start = num(s.timestamp ?? s.start) / scale;
      const next = all[i + 1];
      return {
        id: String(s.id ?? `t${i + 1}`),
        speaker: (typeof s.speaker === "string" ? s.speaker : s.speaker?.name) || "Unknown",
        start,
        end: next ? num(next.timestamp ?? next.start) / scale : start,
        text: s.text.trim(),
      };
    });
}

export function mapActionItem(a: Json): ActionItem {
  return {
    id: String(a.id),
    title: a.title ?? "",
    ...(a.description && { description: a.description }),
    assignee: a.assignee ? mapPerson(a.assignee) : null,
    dueDate: a.dueDate ?? null,
  };
}

/** One Circleback meeting (from the API or a webhook) in our format. */
export function mapMeeting(m: Json, transcript: Json[]): Meeting {
  const id = String(m.id);
  const segments = mapTranscript(transcript);
  return {
    id: localId(id),
    circlebackId: id,
    name: m.name ?? "Untitled meeting",
    createdAt: m.createdAt ?? new Date().toISOString(),
    durationSeconds: Math.round(typeof m.duration === "number" ? m.duration : (segments.at(-1)?.end ?? 0)),
    attendees: list(m.attendees).map(mapPerson),
    transcript: segments,
    actionItems: list(m.actionItems).map(mapActionItem),
    url: meetingLink(id),
  };
}

export async function listMeetingsFromApi(): Promise<Meeting[]> {
  return list(await call(ENDPOINTS.listMeetings))
    .slice(0, 25)
    .map((m) => ({ ...mapMeeting(m, []), actionItems: [] }));
}

export async function getMeetingFromApi(circlebackId: string): Promise<Meeting> {
  const [m, t] = await Promise.all([call(ENDPOINTS.getMeeting(circlebackId)), call(ENDPOINTS.getTranscript(circlebackId))]);
  return mapMeeting(m, list(t));
}

/** Attendees with their Circleback profile IDs (needed to set an assignee). */
export async function getAttendees(circlebackId: string): Promise<Person[]> {
  return list((await call(ENDPOINTS.getMeeting(circlebackId))).attendees).map(mapPerson);
}

export type ActionItemUpdate = { title?: string; description?: string; status?: "PENDING" | "DONE"; assigneeProfileId?: number | null };

export async function updateActionItem(actionItemId: number, body: ActionItemUpdate): Promise<Json> {
  return call(ENDPOINTS.updateActionItem(actionItemId), { method: "PUT", body: JSON.stringify(body) });
}
