import { z } from 'zod';

import {
  ChannelContextSchema,
  CHANNEL_TYPES,
  defineMapper,
  type InteractionEventType,
} from '@verbis/sdk-connector';

/**
 * Generic Webhook payload (documented contract for any system without a dedicated adapter).
 * snake_case wire format, one lifecycle event per request.
 */
const User = z.strictObject({
  id: z.string().min(1).max(256),
  email: z.email().max(320).optional(),
});
const Attr = z.union([z.string().max(1_000), z.number(), z.boolean(), z.null()]);

export const WEBHOOK_EVENT_TYPES = {
  'interaction.offered': 'interactionOffered',
  'interaction.connected': 'connected',
  'interaction.held': 'held',
  'interaction.resumed': 'resumed',
  'interaction.transferred': 'transferred',
  'interaction.ended': 'ended',
  'interaction.wrapup_required': 'wrapupRequired',
} as const satisfies Record<string, InteractionEventType>;

export const GenericWebhookPayloadSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9._:-]+$/),
  type: z.enum(
    Object.keys(WEBHOOK_EVENT_TYPES) as [
      keyof typeof WEBHOOK_EVENT_TYPES,
      ...(keyof typeof WEBHOOK_EVENT_TYPES)[],
    ],
  ),
  occurred_at: z.iso.datetime({ offset: true }),
  interaction: z.strictObject({
    id: z.string().min(1).max(256),
    channel: z.enum(CHANNEL_TYPES),
    direction: z.enum(['inbound', 'outbound']).default('inbound'),
    queue: z.string().max(256).optional(),
    campaign: z
      .strictObject({ kind: z.string().max(32), id: z.string().min(1).max(256) })
      .optional(),
    customer_id: z.string().max(256).optional(),
    agent: User.optional(),
    transfer_to: User.optional(),
    attributes: z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/), Attr).optional(),
    transfer_context: z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/), Attr).optional(),
    context: ChannelContextSchema.optional(),
  }),
});
export type GenericWebhookPayload = z.infer<typeof GenericWebhookPayloadSchema>;

export const genericWebhookMapper = defineMapper<GenericWebhookPayload>({
  name: 'generic-webhook',
  payloadSchema: GenericWebhookPayloadSchema,
  map: (p) => ({
    eventId: p.id,
    type: WEBHOOK_EVENT_TYPES[p.type],
    occurredAt: p.occurred_at,
    platformInteractionId: p.interaction.id,
    channel: p.interaction.channel,
    direction: p.interaction.direction,
    ...(p.interaction.agent === undefined ? {} : { agent: p.interaction.agent }),
    ...(p.interaction.transfer_to === undefined ? {} : { transferTo: p.interaction.transfer_to }),
    ...(p.interaction.queue === undefined ? {} : { queue: p.interaction.queue }),
    ...(p.interaction.campaign === undefined
      ? {}
      : {
          campaignRef: { kind: p.interaction.campaign.kind, externalId: p.interaction.campaign.id },
        }),
    ...(p.interaction.customer_id === undefined ? {} : { customerId: p.interaction.customer_id }),
    attributes: p.interaction.attributes ?? {},
    ...(p.interaction.transfer_context === undefined
      ? {}
      : { transferContext: p.interaction.transfer_context }),
    ...(p.interaction.context === undefined ? {} : { context: p.interaction.context }),
  }),
});

/**
 * Live speech-to-text line for an interaction this webhook already reported (ADR-0052). Same HMAC
 * signature as lifecycle events; text only, never audio.
 */
export const GenericWebhookTranscriptSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/),
  type: z.literal('transcript.segment'),
  occurred_at: z.iso.datetime({ offset: true }),
  interaction_id: z.string().min(1).max(256),
  speaker: z.enum(['customer', 'agent']),
  text: z.string().max(2_000),
  final: z.boolean().default(true),
  language: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .optional(),
});
