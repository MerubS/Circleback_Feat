import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Meeting } from "@/lib/types";
import { mapMeeting } from "./api";

/**
 * Circleback webhooks (https://circleback.ai/docs/webhook-integration): POST with the meeting as JSON,
 * signed with HMAC-SHA256 (hex) of the RAW body using the "whsec_..." secret, in the `x-signature` header.
 * Retried up to 9 times on failure or no reply within 5 minutes, so the same meeting can arrive twice.
 */
export function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(signature.trim(), "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

const Person = z.object({ name: z.string().nullable().optional(), email: z.string().nullable().optional() });

/** What we need from the payload; other fields (notes, insights, tags) are ignored. */
export const WebhookSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  duration: z.number().nullable().optional(),
  attendees: z.array(Person).default([]),
  actionItems: z
    .array(
      z.object({
        id: z.union([z.number(), z.string()]),
        title: z.string(),
        description: z.string().nullable().optional(),
        assignee: Person.nullable().optional(),
        status: z.string().optional(),
      }),
    )
    .default([]),
  transcript: z.array(z.object({ speaker: z.string().nullable().optional(), text: z.string(), timestamp: z.number() })).default([]),
});
export type WebhookPayload = z.infer<typeof WebhookSchema>;

/** The meeting in our format. Done items are dropped: nothing left to check. */
export function meetingFromWebhook(p: WebhookPayload): Meeting {
  const m = mapMeeting(
    {
      ...p,
      attendees: p.attendees.filter((a) => a.name || a.email),
      actionItems: p.actionItems.filter((a) => a.status !== "DONE"),
    },
    p.transcript,
  );
  return m;
}
