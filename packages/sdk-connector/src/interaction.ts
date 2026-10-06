import { z } from 'zod';

import { CHANNEL_TYPES } from './adapter.js';
import { ChannelContextSchema } from './channel-context.js';

/** Lifecycle events every connector emits (normalized from platform events by its mapper). */
export const INTERACTION_EVENT_TYPES = [
  'interactionOffered',
  'connected',
  'held',
  'resumed',
  'transferred',
  'ended',
  'wrapupRequired',
] as const;
export type InteractionEventType = (typeof INTERACTION_EVENT_TYPES)[number];

/** Normalized interaction status (matches the API's `interactions.status` check). */
export type InteractionStatus =
  'alerting' | 'connected' | 'held' | 'transferred' | 'wrapup' | 'ended';

export const STATUS_OF_EVENT: Readonly<Record<InteractionEventType, InteractionStatus>> = {
  interactionOffered: 'alerting',
  connected: 'connected',
  held: 'held',
  resumed: 'connected',
  transferred: 'transferred',
  ended: 'ended',
  wrapupRequired: 'wrapup',
};

/** Allowed transitions; anything else from a platform is treated as out-of-order and dropped. */
const NEXT: Readonly<Record<InteractionStatus, readonly InteractionStatus[]>> = {
  alerting: ['alerting', 'connected', 'transferred', 'ended'],
  connected: ['connected', 'held', 'transferred', 'wrapup', 'ended'],
  held: ['held', 'connected', 'transferred', 'wrapup', 'ended'],
  transferred: ['transferred', 'alerting', 'connected', 'ended'],
  wrapup: ['wrapup', 'ended'],
  ended: ['ended'],
};

export function canTransition(from: InteractionStatus | undefined, to: InteractionStatus): boolean {
  // The first event seen may be any state (the hub can start mid-interaction).
  return from === undefined ? true : NEXT[from].includes(to);
}

const Attr = z.union([z.string().max(1_000), z.number(), z.boolean(), z.null()]);

/** Platform user reference; mapped to a Verbis user server-side (cti identity → email → externalId). */
export const PlatformUserSchema = z.strictObject({
  id: z.string().min(1).max(256),
  email: z.email().max(320).optional(),
});

/** Trusted connector routing dimensions; stored encrypted by the API, never accepted by launch clients. */
export const RoutingContextSchema = z.strictObject({
  locale: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(-[a-z]{2})?$/i)
    .transform((value) => {
      const [language, region] = value.split('-');
      return `${language?.toLowerCase() ?? ''}${region === undefined ? '' : '-' + region.toUpperCase()}`;
    })
    .optional(),
  skills: z.array(z.string().trim().min(1).max(128)).max(50).optional(),
  segment: z.string().trim().min(1).max(128).optional(),
  stickyKey: z.string().trim().min(1).max(256).optional(),
});

export const InteractionEventSchema = z.strictObject({
  /** Idempotency key: stable per platform event (retries reuse it). */
  eventId: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9._:-]+$/),
  type: z.enum(INTERACTION_EVENT_TYPES),
  occurredAt: z.iso.datetime({ offset: true }),
  /** Platform's conversation/interaction id. */
  platformInteractionId: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9._:@-]+$/),
  channel: z.enum(CHANNEL_TYPES),
  direction: z.enum(['inbound', 'outbound']),
  agent: PlatformUserSchema.optional(),
  /** Transfer target, for `transferred`. */
  transferTo: PlatformUserSchema.optional(),
  queue: z.string().max(256).optional(),
  /** Platform campaign/queue mapping key resolved by the API (campaign_external_mappings). */
  campaignRef: z
    .strictObject({ kind: z.string().max(32), externalId: z.string().min(1).max(256) })
    .optional(),
  customerId: z.string().max(256).optional(),
  /** Attached data (flat; nested objects are not allowed). */
  attributes: z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/), Attr).default({}),
  context: ChannelContextSchema.optional(),
  routing: RoutingContextSchema.optional(),
  /** Allow-listed context carried across a transfer (requires `transferContext`). */
  transferContext: z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/), Attr).optional(),
  wrapUp: z
    .strictObject({
      required: z.boolean(),
      timeoutSeconds: z.number().int().min(0).max(3_600).optional(),
    })
    .optional(),
});
export type InteractionEvent = z.infer<typeof InteractionEventSchema>;
export type InteractionEventInput = z.input<typeof InteractionEventSchema>;

/** Validates and normalizes an event; channel/context mismatch is rejected. */
export function parseInteractionEvent(input: unknown): InteractionEvent {
  const event = InteractionEventSchema.parse(input);
  if (event.context !== undefined && event.context.channel !== event.channel)
    throw new z.ZodError([
      {
        code: 'custom',
        path: ['context', 'channel'],
        message: 'context channel must match event channel',
        input: event.context.channel,
      },
    ]);
  // Platform mappers already allow-list attributes; promote only these documented canonical keys.
  const attrs = event.attributes;
  const promoted = RoutingContextSchema.parse({
    ...(attrs['locale'] === undefined ? {} : { locale: attrs['locale'] }),
    ...(attrs['skills'] === undefined
      ? {}
      : {
          skills:
            typeof attrs['skills'] === 'string'
              ? attrs['skills']
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean)
              : attrs['skills'],
        }),
    ...(attrs['segment'] === undefined ? {} : { segment: attrs['segment'] }),
    ...(attrs['routingKey'] === undefined ? {} : { stickyKey: attrs['routingKey'] }),
    ...event.routing,
  });
  return Object.keys(promoted).length === 0 ? event : { ...event, routing: promoted };
}
