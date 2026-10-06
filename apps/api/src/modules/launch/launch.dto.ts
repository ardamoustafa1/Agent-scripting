import { z } from 'zod';

import { ChannelTypeSchema, IsoDateTime, UuidSchema } from '../../common/dto.js';

import { LAUNCH_CODE, MAX_LAUNCH_TTL_SECONDS } from './domain/launch.js';

/** connector-hub → api. The connector attests user and interaction it verified on the platform. */
export const CreateIntentSchema = z
  .strictObject({
    connectorId: UuidSchema,
    interactionId: UuidSchema,
    userId: UuidSchema,
    /** `push` (preferred): delivered over the agent's socket. `fragment`: returned for /launch#code. */
    delivery: z.enum(['push', 'fragment']).default('push'),
    ttlSeconds: z.number().int().min(5).max(MAX_LAUNCH_TTL_SECONDS).optional(),
  })
  .meta({ id: 'LaunchIntentCreate' });
export type CreateIntentInput = z.output<typeof CreateIntentSchema>;

export const LaunchIntentCreatedSchema = z
  .object({
    intentId: UuidSchema,
    expiresAt: IsoDateTime,
    delivery: z.enum(['push', 'fragment']),
    code: z.string().regex(LAUNCH_CODE).optional(),
  })
  .meta({ id: 'LaunchIntentCreated' });

export const RedeemSchema = z
  .strictObject({ code: z.string().min(1).max(128) })
  .meta({ id: 'LaunchRedeem' });

/** Embedded (iframe/widget): platform context is only a hint, re-verified server-side. */
export const EmbeddedLaunchSchema = z
  .strictObject({
    connectorId: UuidSchema,
    conversationId: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9._:-]+$/),
  })
  .meta({ id: 'LaunchEmbedded' });
export type EmbeddedLaunchInput = z.output<typeof EmbeddedLaunchSchema>;

export const JwsLaunchSchema = z
  .strictObject({
    token: z
      .string()
      .min(16)
      .max(4096)
      .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
  })
  .meta({ id: 'LaunchJws' });

export const PreviewSchema = z
  .strictObject({
    scriptVersionId: UuidSchema,
    mockInteraction: z
      .strictObject({
        channel: ChannelTypeSchema.default('voice'),
        attributes: z
          .record(
            z.string().regex(/^[A-Za-z0-9_]{1,64}$/),
            z.union([z.string().max(256), z.number(), z.boolean()]),
          )
          .default({}),
      })
      .default({ channel: 'voice', attributes: {} }),
    liveDataSources: z.boolean().default(false),
  })
  .meta({ id: 'LaunchPreview' });
export type PreviewInput = z.output<typeof PreviewSchema>;

export const LaunchResultSchema = z
  .object({ sessionId: UuidSchema, path: z.string().regex(/^\/s\/[0-9a-f-]{36}$/) })
  .meta({ id: 'LaunchResult' });

export const LaunchTicketSchema = z
  .object({ ticket: z.string(), expiresIn: z.number().int(), namespace: z.literal('/launch') })
  .meta({ id: 'LaunchSocketTicket' });

export const ParamSignalSchema = z
  .strictObject({ params: z.array(z.string().max(64)).max(20) })
  .meta({ id: 'LaunchParamSignal' });
