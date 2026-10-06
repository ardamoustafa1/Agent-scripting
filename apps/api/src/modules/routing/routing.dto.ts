import { z } from 'zod';

import { ChannelTypeSchema, IsoDateTime, UuidSchema } from '../../common/dto.js';

const Attr = z.union([
  z.string().max(1000),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string().max(1000), z.number(), z.boolean()])).max(100),
]);

export const ResolveRequestSchema = z
  .strictObject({
    /** Exactly one way to identify the campaign. */
    campaignId: UuidSchema.optional(),
    campaignCode: z
      .string()
      .regex(/^[A-Z0-9][A-Z0-9_-]*$/)
      .max(64)
      .optional(),
    external: z
      .strictObject({
        platform: z.string().max(32),
        kind: z.string().max(32),
        externalId: z.string().min(1).max(256),
      })
      .optional(),
    channel: ChannelTypeSchema,
    locale: z
      .string()
      .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/)
      .optional(),
    queue: z.string().max(128).optional(),
    skills: z.array(z.string().max(128)).max(50).optional(),
    segment: z.string().max(128).optional(),
    /** Attached data (flat map; nested objects are not allowed). */
    attributes: z.record(z.string().regex(/^[A-Za-z0-9_]{1,64}$/), Attr).optional(),
    agent: z
      .strictObject({
        id: z.string().max(128),
        attributes: z.record(z.string().regex(/^[A-Za-z0-9_]{1,64}$/), Attr).optional(),
      })
      .optional(),
    interactionId: z.string().max(128).optional(),
    stickyKey: z.string().max(256).optional(),
    /** Decision time (replay/debug). Defaults to now. */
    at: IsoDateTime.optional(),
  })
  .refine(
    (r) => [r.campaignId, r.campaignCode, r.external].filter((v) => v !== undefined).length === 1,
    {
      message: 'give exactly one of campaignId, campaignCode, external',
      path: ['campaignId'],
    },
  )
  .meta({ id: 'ScriptResolutionRequest' });
export type ResolveRequest = z.output<typeof ResolveRequestSchema>;

export const DecisionSchema = z
  .object({
    outcome: z.enum(['resolved', 'no_match']),
    reason: z.string().optional(),
    campaignId: z.string(),
    assignmentId: z.string().optional(),
    scriptId: z.string().optional(),
    version: z
      .object({
        id: z.string(),
        number: z.number().int(),
        semver: z.string().nullable(),
        checksum: z.string(),
      })
      .optional(),
    variant: z.object({ key: z.string(), bucket: z.number().int() }).optional(),
    workingHours: z.object({ configured: z.boolean(), open: z.boolean() }),
    trace: z.object({
      evaluated: z.array(
        z.object({
          assignmentId: z.string(),
          priority: z.number(),
          specificity: z.number(),
          eligible: z.boolean(),
          reasons: z.array(z.string()),
          factsRead: z.array(z.string()),
        }),
      ),
      ranking: z.array(z.string()),
      tie: z
        .object({ assignmentIds: z.array(z.string()), brokenBy: z.enum(['recency', 'id']) })
        .nullable(),
      at: z.string(),
    }),
    cache: z.enum(['hit', 'miss', 'bypass']),
  })
  .meta({ id: 'ScriptResolution' });

export const ConflictSchema = z
  .object({
    assignmentIds: z.array(z.string()),
    priority: z.number().int(),
    severity: z.enum(['certain', 'possible']),
    resolvedBy: z.enum(['specificity', 'recency', 'id']),
    overlap: z.record(z.string(), z.unknown()),
  })
  .meta({ id: 'AssignmentConflict' });
