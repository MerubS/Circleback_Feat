import Link from "next/link";
import { notFound } from "next/navigation";
import { getMeeting, momentHref } from "@/lib/circleback/source";
import { store } from "@/lib/store";
import { MeetingView } from "@/components/MeetingView";

export const dynamic = "force-dynamic";

export default async function MeetingPage({ params }: { params: { id: string } }) {
  const meeting = await getMeeting(params.id);
  if (!meeting) notFound();
  const report = await store.latest(meeting.id);
  const links = Object.fromEntries(meeting.transcript.map((s) => [s.id, momentHref(meeting, s.id, s.start)]));

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        ← All meetings
      </Link>
      <MeetingView meeting={meeting} report={report} links={links} hasOpenAI={!!process.env.OPENAI_API_KEY} />
    </div>
  );
}
