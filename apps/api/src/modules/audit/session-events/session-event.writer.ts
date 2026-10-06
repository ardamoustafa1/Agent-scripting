import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';

import { requestContext } from '../../../common/context/request-context.js';
import { actorRef } from '../../../common/security/principal.js';
import { AuditService, AUDIT_CLOCK } from '../audit.service.js';
import { GENESIS_HASH, isoMillis } from '../core/audit-event.js';
import { maskPii } from '../core/diff.js';
import { sanitizeJson, sanitizeText } from '../core/sanitize.js';
import { toInt } from '../core/scalars.js';

import { hashSessionEvent, type ChainedSessionEvent } from './session-chain.js';

import type { TransactionClient } from '../../../infra/database/prisma.service.js';

export interface SessionEventInput {
  readonly sessionId: string;
  /** e.g. `page.entered`, `field.changed`, `action.executed`. */
  readonly type: string;
  /** What the agent saw/entered; masked by classification before hashing. */
  readonly payload?: Record<string, unknown>;
  readonly pageId?: string;
  readonly occurredAt?: Date;
  /** Variable names classified `@pii`/`@pci` in the running script version. */
  readonly sensitiveKeys?: ReadonlySet<string>;
}

const EVENT_TYPE = /^[a-z][a-zA-Z]*(\.[a-z][a-zA-Z]*){1,2}$/;

/**
 * Runtime session event stream (ADR-0014): separate from the audit trail, same guarantees —
 * append-only, hash chain per session, partitioned, and anchored in the tenant's audit chain when
 * the session is sealed (and in every checkpoint while it is open).
 */
@Injectable()
export class SessionEventWriter {
  readonly #now: () => Date;

  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional() @Inject(AUDIT_CLOCK) now?: () => Date,
  ) {
    this.#now = now ?? (() => new Date());
  }

  async append(
    tx: TransactionClient,
    inputs: readonly SessionEventInput[],
  ): Promise<{ seq: number; hash: string }[]> {
    const ctx = requestContext.require();
    const principal = ctx.principal;
    if (principal === undefined) throw new Error('Session events require a principal');
    const out: { seq: number; hash: string }[] = [];
    // Group by session preserving order; one head lock per session.
    const bySession = new Map<string, SessionEventInput[]>();
    for (const input of inputs) {
      if (!EVENT_TYPE.test(input.type))
        throw new Error(`Invalid session event type: ${input.type}`);
      bySession.set(input.sessionId, [...(bySession.get(input.sessionId) ?? []), input]);
    }
    for (const [sessionId, batch] of bySession) {
      const head = await this.#lockHead(tx, principal.tenantId, sessionId);
      if (head.sealedAt !== null) throw new Error('Session is sealed; no further events');
      const recordedAt = isoMillis(
        new Date(Math.max(this.#now().getTime(), head.recordedAt.getTime())),
      );
      let { seq, hash } = head;
      const rows: (ChainedSessionEvent & { hash: string })[] = [];
      for (const input of batch) {
        seq += 1;
        const options =
          input.sensitiveKeys === undefined ? {} : { extraSensitive: input.sensitiveKeys };
        const event: ChainedSessionEvent = {
          id: randomUUID(),
          tenantId: principal.tenantId,
          sessionId,
          seq,
          type: input.type,
          payload: sanitizeJson(maskPii(input.payload ?? {}, options)),
          actorId: principal.id,
          pageId: input.pageId === undefined ? null : sanitizeText(input.pageId),
          occurredAt: isoMillis(input.occurredAt ?? this.#now()),
          recordedAt,
          createdBy: actorRef(principal),
          prevHash: hash,
        };
        hash = hashSessionEvent(event);
        rows.push({ ...event, hash });
        out.push({ seq, hash });
      }
      const col = <T>(pick: (e: (typeof rows)[number]) => T): T[] => rows.map(pick);
      await tx.$executeRaw`
        INSERT INTO session_events (id, tenant_id, session_id, seq, type, payload, actor_id, page_id,
                                    occurred_at, recorded_at, created_by, prev_hash, hash)
        SELECT u.id::uuid, ${principal.tenantId}::uuid, ${sessionId}::uuid, u.seq, u.type, u.payload::jsonb,
               u.actor_id, u.page_id, u.occurred_at::timestamptz, u.recorded_at::timestamptz,
               u.created_by, u.prev_hash, u.hash
          FROM unnest(${col((e) => e.id)}::text[], ${col((e) => e.seq)}::int[], ${col((e) => e.type)}::text[],
                      ${col((e) => JSON.stringify(e.payload))}::text[], ${col((e) => e.actorId)}::text[],
                      ${col((e) => e.pageId)}::text[], ${col((e) => e.occurredAt)}::text[],
                      ${col((e) => e.recordedAt)}::text[], ${col((e) => e.createdBy)}::text[],
                      ${col((e) => e.prevHash)}::text[], ${col((e) => e.hash)}::text[])
            AS u(id, seq, type, payload, actor_id, page_id, occurred_at, recorded_at, created_by, prev_hash, hash)`;
      await tx.$executeRaw`
        UPDATE session_chain_heads SET seq = ${seq}, hash = ${hash}, recorded_at = ${recordedAt}::timestamptz
         WHERE session_id = ${sessionId}::uuid`;
    }
    return out;
  }

  /** Closes the stream and anchors its final head in the tenant audit chain. */
  async seal(tx: TransactionClient, sessionId: string): Promise<{ seq: number; hash: string }> {
    const principal = requestContext.require().principal;
    if (principal === undefined) throw new Error('Session events require a principal');
    const head = await this.#lockHead(tx, principal.tenantId, sessionId);
    if (head.sealedAt !== null) return { seq: head.seq, hash: head.hash };
    await tx.$executeRaw`UPDATE session_chain_heads SET sealed_at = now() WHERE session_id = ${sessionId}::uuid`;
    await this.audit.record(tx, {
      action: 'runtime.session.sealed',
      target: { type: 'Session', id: sessionId },
      metadata: { seq: head.seq, hash: head.hash },
    });
    return { seq: head.seq, hash: head.hash };
  }

  async #lockHead(tx: TransactionClient, tenantId: string, sessionId: string) {
    await tx.$executeRaw`
      INSERT INTO session_chain_heads (session_id, tenant_id, seq, hash)
      VALUES (${sessionId}::uuid, ${tenantId}::uuid, 0, ${GENESIS_HASH})
      ON CONFLICT (session_id) DO NOTHING`;
    const rows = await tx.$queryRaw<
      { seq: number; hash: string; recorded_at: Date; sealed_at: Date | null }[]
    >`
      SELECT seq, hash, recorded_at, sealed_at FROM session_chain_heads
       WHERE session_id = ${sessionId}::uuid FOR UPDATE`;
    const row = rows[0];
    if (row === undefined) throw new Error('Session chain head is not visible for this tenant');
    return {
      seq: toInt(row.seq),
      hash: row.hash,
      recordedAt: row.recorded_at,
      sealedAt: row.sealed_at,
    };
  }
}
