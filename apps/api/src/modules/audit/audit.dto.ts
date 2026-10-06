import { z } from 'zod';

import { IsoDateTime } from '../../common/dto.js';
import { InvalidCursorError } from '../../common/pagination/pagination.js';

import { ACTOR_TYPES, OUTCOMES, type StoredAuditRow } from './core/audit-event.js';

import type { AuditFilters } from './audit.repository.js';

export const AuditEventSchema = z
  .object({
    id: z.string(),
    seq: z.number().int(),
    action: z.string(),
    actor: z.object({
      type: z.string(),
      id: z.string(),
      displayName: z.string().optional(),
      ip: z.string().optional(),
      userAgent: z.string().optional(),
      sessionId: z.string().optional(),
    }),
    resource: z.object({ type: z.string(), id: z.string(), name: z.string().nullable() }),
    /** @deprecated alias of `resource` (prompt 3). */
    target: z.object({ type: z.string(), id: z.string(), name: z.string().nullable() }),
    outcome: z.enum(OUTCOMES),
    reason: z.string().nullable(),
    diff: z.unknown().nullable(),
    correlationId: z.string(),
    interactionId: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    occurredAt: IsoDateTime,
    recordedAt: IsoDateTime,
    prevHash: z.string(),
    hash: z.string(),
    hashVersion: z.number().int(),
  })
  .meta({ id: 'AuditEvent' });
export type AuditEventDto = z.infer<typeof AuditEventSchema>;

const SeqString = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .transform((v) => BigInt(v));

export const AuditSearchQuerySchema = z
  .strictObject({
    limit: z.coerce.number().int().min(1).max(500).default(50),
    cursor: z.string().max(64).optional(),
    sort: z.enum(['seq', '-seq']).default('-seq'),
    from: IsoDateTime.optional(),
    to: IsoDateTime.optional(),
    actorType: z.enum([...ACTOR_TYPES, 'service']).optional(),
    actorId: z.string().min(1).max(128).optional(),
    action: z
      .string()
      .regex(/^[a-z][a-zA-Z.]*\*?$/)
      .max(100)
      .optional(),
    resourceType: z.string().min(1).max(64).optional(),
    resourceId: z.string().min(1).max(128).optional(),
    outcome: z.enum(OUTCOMES).optional(),
    correlationId: z.string().min(1).max(128).optional(),
    interactionId: z.string().min(1).max(128).optional(),
    q: z.string().min(1).max(200).optional(),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from < q.to, {
    message: 'from must be before to',
    path: ['from'],
  });
export type AuditSearchQuery = z.output<typeof AuditSearchQuerySchema>;

export const AuditExportQuerySchema = AuditSearchQuerySchema.and(
  z.object({ format: z.enum(['csv', 'json']).default('csv') }),
);

/** Opaque cursor binding sort + last seq. */
export function encodeAuditCursor(sort: string, seq: bigint): string {
  return Buffer.from(`${sort}:${seq.toString()}`, 'utf8').toString('base64url');
}

export function decodeAuditCursor(sort: string, cursor: string): bigint {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const match = /^(-?seq):([1-9][0-9]{0,18})$/.exec(raw);
  if (match?.[1] !== sort || match[2] === undefined) throw new InvalidCursorError();
  return BigInt(match[2]);
}

export function filtersOf(query: AuditSearchQuery): AuditFilters {
  const paging = new Set(['limit', 'cursor', 'sort']);
  return Object.fromEntries(
    Object.entries(query).filter(([k, v]) => !paging.has(k) && v !== undefined),
  );
}

export const AuditPageSchema = z
  .object({
    data: z.array(AuditEventSchema),
    page: z.object({
      limit: z.number().int(),
      nextCursor: z.string().nullable(),
      sort: z.string(),
    }),
  })
  .meta({ id: 'AuditEventPage' });

export const VerifyRequestSchema = z
  .strictObject({ fromSeq: SeqString.optional(), toSeq: SeqString.optional() })
  .refine((r) => r.fromSeq === undefined || r.toSeq === undefined || r.fromSeq <= r.toSeq, {
    message: 'fromSeq must not exceed toSeq',
    path: ['fromSeq'],
  })
  .meta({ id: 'AuditVerifyRequest' });

export const ChainBreakSchema = z.object({
  kind: z.enum([
    'hash_mismatch',
    'link_mismatch',
    'sequence_gap',
    'tenant_mismatch',
    'anchor_missing',
    'checkpoint_mismatch',
    'checkpoint_signature_invalid',
  ]),
  seq: z.string(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  eventId: z.string().optional(),
});

export const VerifyReportSchema = z
  .object({
    valid: z.boolean(),
    checked: z.number().int(),
    fromSeq: z.string().nullable(),
    toSeq: z.string().nullable(),
    headSeq: z.string().nullable(),
    anchor: z.object({ seq: z.string(), source: z.enum(['genesis', 'event', 'checkpoint']) }),
    lastHash: z.string(),
    checkpointsChecked: z.number().int(),
    signaturesVerified: z.boolean(),
    breaks: z.array(ChainBreakSchema),
    truncated: z.boolean(),
  })
  .meta({ id: 'AuditVerifyReport' });

export const CheckpointSchema = z
  .object({
    id: z.string(),
    seq: z.string(),
    hash: z.string(),
    sessionHeadsDigest: z.string(),
    sessionHeadsCount: z.number().int(),
    prevCheckpointId: z.string().nullable(),
    keyId: z.string(),
    signature: z.string(),
    signedAt: IsoDateTime,
  })
  .meta({ id: 'AuditCheckpoint' });

export const JwksSchema = z
  .object({
    keys: z.array(z.object({ kty: z.string(), crv: z.string(), kid: z.string(), x: z.string() })),
  })
  .meta({ id: 'AuditCheckpointKeys' });

export function toAuditEventDto(row: StoredAuditRow): AuditEventDto {
  const actor = (row.actor ?? {}) as Record<string, unknown>;
  const str = (key: string): Record<string, string> =>
    typeof actor[key] === 'string' ? { [key]: actor[key] } : {};
  const resource = { type: row.targetType, id: row.targetId, name: row.targetName };
  return {
    id: row.id,
    seq: Number(row.seq),
    action: row.action,
    actor: {
      type: row.actorType,
      id: row.actorId,
      ...str('displayName'),
      ...str('ip'),
      ...str('userAgent'),
      ...str('sessionId'),
    },
    resource,
    target: resource,
    outcome: row.outcome as AuditEventDto['outcome'],
    reason: row.reason,
    diff: row.diff ?? null,
    correlationId: row.correlationId,
    interactionId: row.interactionId,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    prevHash: row.prevHash,
    hash: row.hash,
    hashVersion: row.hashVersion,
  };
}
