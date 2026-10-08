import { z } from 'zod';

/** Trust center (DIFFERENTIATORS G1): aggregates only, never actors, targets or payloads. */
export const TrustStatusSchema = z.enum(['healthy', 'attention', 'broken']);
export const TrustCenterSchema = z
  .object({
    generatedAt: z.iso.datetime(),
    windowDays: z.number().int(),
    chain: z.object({
      status: TrustStatusSchema,
      valid: z.boolean(),
      checked: z.number().int(),
      headSeq: z.string().nullable(),
      breaks: z.number().int(),
      truncated: z.boolean(),
      signaturesVerified: z.boolean(),
      checkpointsChecked: z.number().int(),
      latestCheckpoint: z.object({ seq: z.string(), signedAt: z.iso.datetime() }).nullable(),
      checkpointAgeHours: z.number().nullable(),
    }),
    launch: z.object({
      issued: z.number().int(),
      redeemed: z.number().int(),
      denied: z.number().int(),
      anomalies: z.number().int(),
      urlParamsRejected: z.number().int(),
    }),
    sensitiveAccess: z.object({
      auditExports: z.number().int(),
      secretMetadataViews: z.number().int(),
      secretUsageReads: z.number().int(),
      userProfileViews: z.number().int(),
      privacyExports: z.number().int(),
    }),
    privacy: z.object({
      open: z.number().int(),
      processed: z.number().int(),
      oldestOpenAt: z.iso.datetime().nullable(),
    }),
  })
  .meta({ id: 'TrustCenter' });
export type TrustCenter = z.output<typeof TrustCenterSchema>;

export const TrustCenterQuerySchema = z.strictObject({
  days: z.coerce.number().int().min(1).max(90).default(30),
});
