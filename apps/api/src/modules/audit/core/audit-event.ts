import { canonicalJson, sha256Hex } from '../../../common/crypto/canonical-json.js';

/**
 * Audit event model (ADR-0014). Everything here is pure: the same code hashes on write, verifies
 * the chain, signs checkpoints and is reused by tests and offline verifiers.
 */
export const GENESIS_HASH = '0'.repeat(64);

export const ACTOR_TYPES = ['user', 'system', 'apiClient', 'connector'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];
export const OUTCOMES = ['success', 'failure', 'denied'] as const;
export type AuditOutcome = (typeof OUTCOMES)[number];

/** `namespace.verb` (`script.published`) or `domain.entity.verb` (CLAUDE.md §5). */
export const AUDIT_ACTION = /^[a-z][a-zA-Z]*(\.[a-z][a-zA-Z]*){1,2}$/;

export interface AuditActor {
  readonly type: ActorType;
  readonly id: string;
  /** @pii */
  readonly displayName?: string;
  /** @pii */
  readonly ip?: string;
  readonly userAgent?: string;
  readonly sessionId?: string;
}

export interface AuditResource {
  readonly type: string;
  readonly id: string;
  readonly name?: string | null;
}

/** The persisted fields of a v2 event, exactly as hashed. */
export interface ChainedAuditEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly seq: bigint;
  readonly action: string;
  readonly actor: AuditActor;
  readonly resource: AuditResource;
  readonly outcome: AuditOutcome;
  readonly reason: string | null;
  readonly diff: unknown;
  readonly correlationId: string;
  readonly interactionId: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  /** ISO-8601 with milliseconds (timestamptz(3)). */
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly prevHash: string;
}

/** Truncates to milliseconds and renders ISO-8601 — the DB column precision. */
export function isoMillis(date: Date): string {
  return new Date(Math.floor(date.getTime())).toISOString();
}

/** The `actor` JSONB column: everything except type/id (those have their own columns). */
export function actorDetails(actor: AuditActor): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(actor).filter(([key]) => key !== 'type' && key !== 'id'),
  );
}

/** Canonical hash input v2: every persisted field except `hash` (and the derived `search`). */
export function hashInputV2(event: ChainedAuditEvent): Record<string, unknown> {
  return {
    v: 2,
    id: event.id,
    tenantId: event.tenantId,
    seq: event.seq.toString(),
    action: event.action,
    // Every stored detail key is hashed, so an injected key is detected too.
    actor: { type: event.actor.type, id: event.actor.id, details: actorDetails(event.actor) },
    resource: {
      type: event.resource.type,
      id: event.resource.id,
      name: event.resource.name ?? null,
    },
    outcome: event.outcome,
    reason: event.reason,
    diff: event.diff ?? null,
    correlationId: event.correlationId,
    interactionId: event.interactionId,
    metadata: event.metadata,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    prevHash: event.prevHash,
  };
}

/** hash = SHA-256(prevHash + canonicalJSON(event)). */
export function chainHash(prevHash: string, input: Record<string, unknown>): string {
  return sha256Hex(prevHash + canonicalJson(input));
}

export function hashEventV2(event: ChainedAuditEvent): string {
  return chainHash(event.prevHash, hashInputV2(event));
}

/** Prompt-3 rows (hash_version 1), kept verifiable after migration. */
export interface V1Row {
  readonly tenantId: string;
  readonly seq: bigint;
  readonly action: string;
  readonly actorType: string;
  readonly actorId: string;
  readonly actor: unknown;
  readonly targetType: string;
  readonly targetId: string;
  readonly targetName: string | null;
  readonly outcome: string;
  readonly diff: unknown;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly prevHash: string;
}

export function hashEventV1(row: V1Row): string {
  return chainHash(row.prevHash, {
    tenantId: row.tenantId,
    seq: row.seq.toString(),
    action: row.action,
    actorType: row.actorType,
    actorId: row.actorId,
    actor: row.actor,
    targetType: row.targetType,
    targetId: row.targetId,
    targetName: row.targetName,
    outcome: row.outcome,
    diff: row.diff ?? null,
    correlationId: row.correlationId,
    occurredAt: row.occurredAt,
    prevHash: row.prevHash,
  });
}

/** Row shape as stored (Prisma/raw), shared by verifier, export and API mapping. */
export interface StoredAuditRow {
  readonly id: string;
  readonly tenantId: string;
  readonly seq: bigint;
  readonly hashVersion: number;
  readonly action: string;
  readonly actorType: string;
  readonly actorId: string;
  readonly actor: unknown;
  readonly targetType: string;
  readonly targetId: string;
  readonly targetName: string | null;
  readonly outcome: string;
  readonly reason: string | null;
  readonly diff: unknown;
  readonly correlationId: string;
  readonly interactionId: string | null;
  readonly metadata: unknown;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly prevHash: string;
  readonly hash: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Rebuilds the hashed event from a stored row (inverse of the writer's mapping). */
export function rowToEvent(row: StoredAuditRow): ChainedAuditEvent {
  const details = asRecord(row.actor);
  return {
    id: row.id,
    tenantId: row.tenantId,
    seq: row.seq,
    action: row.action,
    // Stored details are taken verbatim (not re-typed) so tampering changes the hash input.
    actor: { ...details, type: row.actorType as ActorType, id: row.actorId },
    resource: { type: row.targetType, id: row.targetId, name: row.targetName },
    outcome: row.outcome as AuditOutcome,
    reason: row.reason,
    diff: row.diff ?? null,
    correlationId: row.correlationId,
    interactionId: row.interactionId,
    metadata: asRecord(row.metadata),
    occurredAt: isoMillis(row.occurredAt),
    recordedAt: isoMillis(row.recordedAt),
    prevHash: row.prevHash,
  };
}

/** Recomputes a stored row's hash with the algorithm of its version. */
export function recomputeHash(row: StoredAuditRow): string {
  if (row.hashVersion === 1) {
    return hashEventV1({
      tenantId: row.tenantId,
      seq: row.seq,
      action: row.action,
      actorType: row.actorType,
      actorId: row.actorId,
      actor: row.actor,
      targetType: row.targetType,
      targetId: row.targetId,
      targetName: row.targetName,
      outcome: row.outcome,
      diff: row.diff,
      correlationId: row.correlationId,
      occurredAt: row.occurredAt.toISOString(),
      prevHash: row.prevHash,
    });
  }
  return hashEventV2(rowToEvent(row));
}
