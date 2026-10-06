import { Inject, Injectable, Optional } from '@nestjs/common';

import { requestContext, type RequestContext } from '../../common/context/request-context.js';
import { ulid as defaultUlid } from '../../common/ids/ulid.js';
import { NatsService } from '../../infra/nats/nats.service.js';
import { OutboxWriter } from '../../infra/outbox/outbox.writer.js';

import {
  actorDetails,
  AUDIT_ACTION,
  GENESIS_HASH,
  hashEventV2,
  isoMillis,
  type ActorType,
  type AuditActor,
  type AuditOutcome,
  type ChainedAuditEvent,
} from './core/audit-event.js';
import { patchDiff, snapshotDiff, type MaskOptions } from './core/diff.js';
import { sanitizeJson, sanitizeText } from './core/sanitize.js';
import { toBigInt } from './core/scalars.js';

import type { Principal } from '../../common/security/principal.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

export { GENESIS_HASH } from './core/audit-event.js';

export interface AuditInput {
  /** `namespace.verb` or `<domain>.<entity>.<verb>` (CLAUDE.md §5). */
  readonly action: string;
  /** The resource acted on. */
  readonly target: { readonly type: string; readonly id: string; readonly name?: string | null };
  readonly outcome?: AuditOutcome;
  readonly reason?: string;
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
  /** `snapshot` (changed keys before/after) or RFC 6902 `patch`. Values are PII-masked either way. */
  readonly diffMode?: 'snapshot' | 'patch';
  readonly sensitiveKeys?: MaskOptions['extraSensitive'];
  readonly interactionId?: string;
  readonly metadata?: Record<string, unknown>;
  /** Explicit actor (system jobs, connectors, consumed events). Defaults to the request principal. */
  readonly actor?: AuditActor;
  /** Business time when known (e.g. a consumed event); defaults to now. */
  readonly occurredAt?: Date;
}

export interface RecordedAudit {
  readonly id: string;
  readonly seq: bigint;
  readonly hash: string;
}

export const AUDIT_CLOCK = Symbol('AUDIT_CLOCK');
export const AUDIT_ID_FACTORY = Symbol('AUDIT_ID_FACTORY');

/** Hard caps keep a single event bounded (DoS and row size). */
const MAX_TEXT = 1024;
const MAX_JSON_BYTES = 256 * 1024;

export function principalActorType(principal: Principal): ActorType {
  return principal.type === 'user' ? 'user' : 'apiClient';
}

export function actorFromContext(ctx: RequestContext | undefined): AuditActor | undefined {
  const principal = ctx?.principal;
  if (principal === undefined || ctx === undefined) return undefined;
  return {
    type: principalActorType(principal),
    id: principal.id,
    ...(ctx.ip === '' ? {} : { ip: ctx.ip }),
    ...(ctx.userAgent === '' ? {} : { userAgent: ctx.userAgent }),
    ...(principal.sessionId === undefined ? {} : { sessionId: principal.sessionId }),
  };
}

function bounded(text: string, field: string): string {
  const clean = sanitizeText(text);
  if (clean.length > MAX_TEXT)
    throw new Error(`Audit ${field} exceeds ${String(MAX_TEXT)} characters`);
  return clean;
}

function boundedJson(value: unknown, field: string): unknown {
  const clean = sanitizeJson(value) ?? null;
  if (Buffer.byteLength(JSON.stringify(clean)) > MAX_JSON_BYTES) {
    throw new Error(`Audit ${field} exceeds ${String(MAX_JSON_BYTES)} bytes`);
  }
  return clean;
}

function buildDiff(input: AuditInput): unknown {
  if (input.before === undefined && input.after === undefined) return null;
  const options = input.sensitiveKeys === undefined ? {} : { extraSensitive: input.sensitiveKeys };
  return input.diffMode === 'patch'
    ? patchDiff(input.before ?? null, input.after ?? null, options)
    : snapshotDiff(input.before ?? null, input.after ?? null, options);
}

interface ChainHead {
  seq: bigint;
  hash: string;
  recordedAt: Date;
}

/**
 * Appends hash-chained audit events in the caller's transaction (CLAUDE.md §6): the event exists
 * iff the change committed. Per tenant, appends are serialized by the chain-head row lock; a
 * batch takes the lock once and inserts all rows with one statement (worker, bulk paths).
 */
@Injectable()
export class AuditService {
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Optional() @Inject(AUDIT_CLOCK) now?: () => Date,
    @Optional() @Inject(AUDIT_ID_FACTORY) newId?: () => string,
    @Optional() @Inject(NatsService) private readonly securityJournal?: NatsService,
  ) {
    this.#now = now ?? (() => new Date());
    this.#newId = newId ?? defaultUlid;
  }

  async recordSecurityReport(signal: {
    id: string;
    occurredAt: string;
    correlationId: string;
    source: 'untrusted-browser-report';
    action: 'security.csp.reported';
    directive: string;
    disposition: 'enforce' | 'report';
    documentOrigin: string;
  }): Promise<void> {
    if (!this.securityJournal) throw new Error('Security journal is unavailable');
    await this.securityJournal.publish(
      'verbis.security.csp.reported.v1',
      new TextEncoder().encode(JSON.stringify(signal)),
      { msgId: signal.id, headers: {}, timeoutMs: 5000 },
    );
  }

  async record(tx: TransactionClient, input: AuditInput): Promise<RecordedAudit> {
    const [recorded] = await this.recordMany(tx, [input]);
    if (recorded === undefined) throw new Error('Audit event was not recorded');
    const ctx = requestContext.get();
    if (ctx?.principal !== undefined) {
      await this.outbox.record(tx, {
        type: 'verbis.audit.event.recorded.v1',
        aggregateType: 'AuditEvent',
        aggregateId: recorded.id,
        payload: {
          seq: recorded.seq.toString(),
          action: input.action,
          target: input.target,
          outcome: input.outcome ?? 'success',
          hash: recorded.hash,
        },
      });
    }
    return recorded;
  }

  /**
   * Appends events for ONE tenant in order. `tenantId` defaults to the request principal's tenant;
   * system callers pass it explicitly and give every input an `actor`.
   */
  async recordMany(
    tx: TransactionClient,
    inputs: readonly AuditInput[],
    options: { tenantId?: string } = {},
  ): Promise<RecordedAudit[]> {
    if (inputs.length === 0) return [];
    const ctx = requestContext.get();
    const tenantId = options.tenantId ?? ctx?.principal?.tenantId;
    if (tenantId === undefined) throw new Error('Audit events require a tenant');
    if (ctx?.principal !== undefined && ctx.principal.tenantId !== tenantId) {
      throw new Error('Audit events cannot be written for another tenant');
    }
    const contextActor = actorFromContext(ctx);
    const correlationId = ctx?.correlationId ?? this.#newId();

    // Validate and normalize everything before taking the lock (short critical section).
    const prepared = inputs.map((input) => {
      if (!AUDIT_ACTION.test(input.action))
        throw new Error(`Invalid audit action: ${input.action}`);
      const actor = input.actor ?? contextActor;
      if (actor === undefined) throw new Error('Audit events require an actor');
      return {
        id: this.#newId(),
        action: input.action,
        actor: sanitizeJson({
          type: actor.type,
          id: bounded(actor.id, 'actor.id'),
          ...(actor.displayName === undefined
            ? {}
            : { displayName: bounded(actor.displayName, 'actor.displayName') }),
          ...(actor.ip === undefined ? {} : { ip: bounded(actor.ip, 'actor.ip') }),
          ...(actor.userAgent === undefined
            ? {}
            : { userAgent: bounded(actor.userAgent, 'actor.userAgent') }),
          ...(actor.sessionId === undefined
            ? {}
            : { sessionId: bounded(actor.sessionId, 'actor.sessionId') }),
        }) as AuditActor,
        resource: {
          type: bounded(input.target.type, 'resource.type'),
          id: bounded(input.target.id, 'resource.id'),
          name:
            input.target.name === undefined || input.target.name === null
              ? null
              : bounded(input.target.name, 'resource.name'),
        },
        outcome: input.outcome ?? 'success',
        reason: input.reason === undefined ? null : bounded(input.reason, 'reason'),
        diff: boundedJson(buildDiff(input), 'diff'),
        correlationId: bounded(correlationId, 'correlationId'),
        interactionId:
          input.interactionId === undefined ? null : bounded(input.interactionId, 'interactionId'),
        metadata: boundedJson(input.metadata ?? {}, 'metadata') as Record<string, unknown>,
        occurredAt: isoMillis(input.occurredAt ?? this.#now()),
      };
    });

    const head = await this.#lockHead(tx, tenantId);
    // Chain time never goes backwards for a tenant (seq order == partition order).
    const recordedAt = isoMillis(
      new Date(Math.max(this.#now().getTime(), head.recordedAt.getTime())),
    );
    let prevHash = head.hash;
    let seq = head.seq;
    const events: (ChainedAuditEvent & { hash: string })[] = prepared.map((p) => {
      seq += 1n;
      const event: ChainedAuditEvent = { ...p, tenantId, seq, recordedAt, prevHash };
      const hash = hashEventV2(event);
      prevHash = hash;
      return { ...event, hash };
    });

    await this.#insert(tx, tenantId, events);
    await tx.$executeRaw`
      UPDATE audit_chain_heads SET seq = ${seq}, hash = ${prevHash}, recorded_at = ${recordedAt}::timestamptz
       WHERE tenant_id = ${tenantId}::uuid`;
    if (ctx !== undefined) ctx.auditRecorded = (ctx.auditRecorded ?? 0) + events.length;
    return events.map((e) => ({ id: e.id, seq: e.seq, hash: e.hash }));
  }

  async #lockHead(tx: TransactionClient, tenantId: string): Promise<ChainHead> {
    await tx.$executeRaw`
      INSERT INTO audit_chain_heads (tenant_id, seq, hash) VALUES (${tenantId}::uuid, 0, ${GENESIS_HASH})
      ON CONFLICT (tenant_id) DO NOTHING`;
    const rows = await tx.$queryRaw<{ seq: bigint; hash: string; recorded_at: Date }[]>`
      SELECT seq, hash, recorded_at FROM audit_chain_heads WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`;
    const row = rows[0];
    if (row === undefined) throw new Error('Audit chain head is not visible for this tenant');
    return { seq: toBigInt(row.seq), hash: row.hash, recordedAt: row.recorded_at };
  }

  /** One INSERT … SELECT FROM unnest(...) for the whole batch. */
  async #insert(
    tx: TransactionClient,
    tenantId: string,
    events: readonly (ChainedAuditEvent & { hash: string })[],
  ): Promise<void> {
    const col = <T>(pick: (e: ChainedAuditEvent & { hash: string }) => T): T[] => events.map(pick);
    await tx.$executeRaw`
      INSERT INTO audit_events (
        id, tenant_id, seq, hash_version, action, actor_type, actor_id, actor, target_type, target_id,
        target_name, outcome, reason, diff, correlation_id, interaction_id, metadata, occurred_at,
        recorded_at, prev_hash, hash)
      SELECT u.id, ${tenantId}::uuid, u.seq, 2, u.action, u.actor_type, u.actor_id, u.actor::jsonb,
             u.target_type, u.target_id, u.target_name, u.outcome::audit_outcome, u.reason,
             u.diff::jsonb, u.correlation_id, u.interaction_id, u.metadata::jsonb,
             u.occurred_at::timestamptz, u.recorded_at::timestamptz, u.prev_hash, u.hash
        FROM unnest(
          ${col((e) => e.id)}::text[], ${col((e) => e.seq.toString())}::bigint[], ${col((e) => e.action)}::text[],
          ${col((e) => e.actor.type)}::text[], ${col((e) => e.actor.id)}::text[],
          ${col((e) => JSON.stringify(actorDetails(e.actor)))}::text[], ${col((e) => e.resource.type)}::text[],
          ${col((e) => e.resource.id)}::text[], ${col((e) => e.resource.name ?? null)}::text[],
          ${col((e) => e.outcome)}::text[], ${col((e) => e.reason)}::text[],
          ${col((e) => (e.diff === null ? null : JSON.stringify(e.diff)))}::text[],
          ${col((e) => e.correlationId)}::text[], ${col((e) => e.interactionId)}::text[],
          ${col((e) => JSON.stringify(e.metadata))}::text[], ${col((e) => e.occurredAt)}::text[],
          ${col((e) => e.recordedAt)}::text[], ${col((e) => e.prevHash)}::text[], ${col((e) => e.hash)}::text[]
        ) AS u(id, seq, action, actor_type, actor_id, actor, target_type, target_id, target_name,
               outcome, reason, diff, correlation_id, interaction_id, metadata, occurred_at,
               recorded_at, prev_hash, hash)`;
  }
}
