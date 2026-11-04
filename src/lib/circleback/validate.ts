import { z } from "zod";

const Person = z.object({ name: z.string().min(1), email: z.string().optional() });

export const MeetingSchema = z.object({
  id: z.string().regex(/^[\w-]+$/, "id may only contain letters, numbers, - and _"),
  name: z.string(),
  createdAt: z.string(),
  durationSeconds: z.number().nonnegative(),
  url: z.string().url().optional(),
  attendees: z.array(Person),
  transcript: z
    .array(z.object({ id: z.string(), speaker: z.string(), start: z.number(), end: z.number(), text: z.string() }))
    .min(1)
    .refine((t) => new Set(t.map((s) => s.id)).size === t.length, "transcript segment ids must be unique"),
  actionItems: z.array(
    z.object({ id: z.string(), title: z.string().min(1), description: z.string().optional(), assignee: Person.nullable().optional() }),
  ),
});
