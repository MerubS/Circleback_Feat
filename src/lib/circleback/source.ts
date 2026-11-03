import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Meeting } from "@/lib/types";
import { getMeetingFromApi, listMeetingsFromApi } from "./api";

const SAMPLES = path.join(process.cwd(), "data", "samples");

export function source(): "sample" | "api" {
  return process.env.MEETING_SOURCE === "api" ? "api" : "sample";
}

export async function listMeetings(): Promise<Meeting[]> {
  if (source() === "api") return listMeetingsFromApi();
  const files = (await readdir(SAMPLES)).filter((f) => f.endsWith(".json")).sort();
  const meetings = await Promise.all(files.map((f) => readFile(path.join(SAMPLES, f), "utf8").then(JSON.parse)));
  return meetings as Meeting[];
}

export async function getMeeting(id: string): Promise<Meeting | null> {
  if (source() === "api") return getMeetingFromApi(id);
  if (!/^[\w-]+$/.test(id)) return null;
  try {
    return JSON.parse(await readFile(path.join(SAMPLES, `${id}.json`), "utf8")) as Meeting;
  } catch {
    return null;
  }
}

/** Link to a moment in the meeting. Circleback's own "Share moment" URL format may differ. */
export function momentHref(meeting: Meeting, segmentId: string, start: number): string {
  if (meeting.url) return `${meeting.url}?t=${Math.floor(start)}`;
  return `/meetings/${meeting.id}#${segmentId}`;
}
