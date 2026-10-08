import {
  TrustCenterQuerySchema,
  TrustCenterSchema,
  type TrustStatusSchema,
  type TrustCenter,
} from '@verbis/shared-types';

import type { z } from 'zod';

export { TrustCenterQuerySchema, TrustCenterSchema };
export type { TrustCenter };

/** Audit actions summarised by the trust center (G1). Counts only; no actor, target or payload. */
export const LAUNCH_ACTIONS = [
  'launch.intent.created',
  'launch.code.redeemed',
  'launch.attempt.denied',
  'launch.anomaly.detected',
  'launch.urlParams.rejected',
] as const;
export const SENSITIVE_ACCESS_ACTIONS = [
  'audit.export.created',
  'secret.metadata.viewed',
  'admin.secret.usageRead',
  'identity.user.viewed',
  'admin.privacy.exported',
] as const;

/** A checkpoint older than this means the signer or the worker has stopped. */
export const CHECKPOINT_STALE_HOURS = 24;

export interface ChainInput {
  readonly valid: boolean;
  readonly checked: number;
  readonly headSeq: string | null;
  readonly breaks: number;
  readonly truncated: boolean;
  readonly signaturesVerified: boolean;
  readonly checkpointsChecked: number;
}
export interface CheckpointInput {
  readonly seq: string;
  readonly signedAt: Date;
}
export interface TrustInputs {
  readonly now: Date;
  readonly windowDays: number;
  readonly chain: ChainInput;
  readonly checkpoint: CheckpointInput | null;
  readonly actionCounts: ReadonlyMap<string, number>;
  readonly privacy: {
    readonly open: number;
    readonly processed: number;
    readonly oldestOpenAt: Date | null;
  };
}

/**
 * Pure aggregation: the status is conservative. Any break is `broken`; an unverifiable signature
 * state, a truncated verification, or a missing/stale checkpoint is `attention` (never `healthy`).
 */
export function buildTrustCenter(input: TrustInputs): TrustCenter {
  const count = (action: string): number => input.actionCounts.get(action) ?? 0;
  const ageHours =
    input.checkpoint === null
      ? null
      : Math.max(0, (input.now.getTime() - input.checkpoint.signedAt.getTime()) / 3_600_000);
  const status: z.output<typeof TrustStatusSchema> = !input.chain.valid
    ? 'broken'
    : !input.chain.signaturesVerified ||
        input.chain.truncated ||
        ageHours === null ||
        ageHours > CHECKPOINT_STALE_HOURS
      ? 'attention'
      : 'healthy';
  return {
    generatedAt: input.now.toISOString(),
    windowDays: input.windowDays,
    chain: {
      status,
      valid: input.chain.valid,
      checked: input.chain.checked,
      headSeq: input.chain.headSeq,
      breaks: input.chain.breaks,
      truncated: input.chain.truncated,
      signaturesVerified: input.chain.signaturesVerified,
      checkpointsChecked: input.chain.checkpointsChecked,
      latestCheckpoint:
        input.checkpoint === null
          ? null
          : { seq: input.checkpoint.seq, signedAt: input.checkpoint.signedAt.toISOString() },
      checkpointAgeHours: ageHours,
    },
    launch: {
      issued: count('launch.intent.created'),
      redeemed: count('launch.code.redeemed'),
      denied: count('launch.attempt.denied'),
      anomalies: count('launch.anomaly.detected'),
      urlParamsRejected: count('launch.urlParams.rejected'),
    },
    sensitiveAccess: {
      auditExports: count('audit.export.created'),
      secretMetadataViews: count('secret.metadata.viewed'),
      secretUsageReads: count('admin.secret.usageRead'),
      userProfileViews: count('identity.user.viewed'),
      privacyExports: count('admin.privacy.exported'),
    },
    privacy: {
      open: input.privacy.open,
      processed: input.privacy.processed,
      oldestOpenAt: input.privacy.oldestOpenAt?.toISOString() ?? null,
    },
  };
}
