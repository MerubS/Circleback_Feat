import type { Meeting, VerificationReport } from "@/lib/types";
import { createOpenAIReader, type Reader } from "./ai";
import { referee } from "./referee";

export type { Reader } from "./ai";
export { createOpenAIReader } from "./ai";

/** One AI read of the whole meeting, then the referee checks it. */
export async function verifyMeeting(meeting: Meeting, reader: Reader = createOpenAIReader()): Promise<VerificationReport> {
  const reading = await reader.read(meeting);
  const result = referee(meeting, reading);
  return { meetingId: meeting.id, model: reader.model, createdAt: new Date().toISOString(), ...result };
}
