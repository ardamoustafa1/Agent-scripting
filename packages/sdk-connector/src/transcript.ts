import { z } from 'zod';

/** Who spoke a transcript line. Bot and system lines are not transcript segments. */
export const TRANSCRIPT_SPEAKERS = ['customer', 'agent'] as const;
export type TranscriptSpeaker = (typeof TRANSCRIPT_SPEAKERS)[number];

/**
 * One line of live speech-to-text (ADR-0052, 2026-10-22). Text only: Verbis never receives audio;
 * recognition is done by the platform or the customer's speech service. Requires the connector
 * feature `liveTranscript`. The text is personal data: never log it.
 */
export const TranscriptSegmentSchema = z.strictObject({
  /** Stable per line; an interim line and its final version share it. Retries reuse it. */
  segmentId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/),
  platformInteractionId: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9._:@-]+$/),
  speaker: z.enum(TRANSCRIPT_SPEAKERS),
  text: z.string().trim().min(1).max(2_000),
  /** Interim lines are shown live but never evaluated or stored. */
  final: z.boolean(),
  occurredAt: z.iso.datetime({ offset: true }),
  /** BCP 47 language of the line when the recognizer reports it (`tr`, `en-GB`). */
  language: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .optional(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
export type TranscriptSegmentInput = z.input<typeof TranscriptSegmentSchema>;
