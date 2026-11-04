import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Meeting } from "@/lib/types";
import { getMeetingFromApi, listMeetingsFromApi } from "./api";

const DIRS = [path.join(process.cwd(), "data", "imported"), path.join(process.cwd(), "data", "samples")];
export const IMPORT_DIR = DIRS[0];

export function source(): "sample" | "api" {
  return process.env.MEETING_SOURCE === "api" ? "api" : "sample";
}

export async function listMeetings(): Promise<Meeting[]> {
  if (source() === "api") return listMeetingsFromApi();
  const all: Meeting[] = [];
  for (const dir of DIRS) {
    const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort();
    for (const f of files) all.push(JSON.parse(await readFile(path.join(dir, f), "utf8")));
  }
  return all;
}

export async function getMeeting(id: string): Promise<Meeting | null> {
  if (source() === "api") return getMeetingFromApi(id.startsWith("cb-") ? id.slice(3) : id);
  if (!/^[\w-]+$/.test(id)) return null;
  for (const dir of DIRS) {
    try {
      return JSON.parse(await readFile(path.join(dir, `${id}.json`), "utf8")) as Meeting;
    } catch {}
  }
  return null;
}

/** Link to a moment in the meeting. Circleback's own "Share moment" URL format may differ. */
export function momentHref(meeting: Meeting, segmentId: string, start: number): string {
  if (meeting.url) return `${meeting.url}?t=${Math.floor(start)}`;
  return `/meetings/${meeting.id}#${segmentId}`;
}
