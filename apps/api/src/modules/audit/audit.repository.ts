import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';

import { toBigInt, toInt } from './core/scalars.js';

import type { StoredAuditRow } from './core/audit-event.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

/** Filters of the query API (all optional, AND-combined). */
export interface AuditFilters {
  readonly from?: string;
  readonly to?: string;
  readonly actorType?: string;
  readonly actorId?: string;
  /** Exact action, or a prefix with a trailing `*` (`script.*`). */
  readonly action?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly outcome?: 'success' | 'failure' | 'denied';
  readonly correlationId?: string;
  readonly interactionId?: string;
  /** Full-text search (websearch syntax) over action, resource, reason, actor and correlation id. */
  readonly q?: string;
  readonly fromSeq?: bigint;
  readonly toSeq?: bigint;
}

const COLUMNS = Prisma.sql`
  id, tenant_id AS "tenantId", seq, hash_version AS "hashVersion", action,
  actor_type AS "actorType", actor_id AS "actorId", actor, target_type AS "targetType",
  target_id AS "targetId", target_name AS "targetName", outcome::text AS outcome, reason, diff,
  correlation_id AS "correlationId", interaction_id AS "interactionId", metadata,
  occurred_at AS "occurredAt", recorded_at AS "recordedAt", prev_hash AS "prevHash", hash`;

/** Escapes LIKE metacharacters for prefix matching. */
function likePrefix(value: string): string {
  return `${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function whereClause(tenantId: string, f: AuditFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`tenant_id = ${tenantId}::uuid`];
  if (f.from !== undefined) parts.push(Prisma.sql`occurred_at >= ${f.from}::timestamptz`);
  if (f.to !== undefined) parts.push(Prisma.sql`occurred_at < ${f.to}::timestamptz`);
  if (f.actorType !== undefined) parts.push(Prisma.sql`actor_type = ${f.actorType}`);
  if (f.actorId !== undefined) parts.push(Prisma.sql`actor_id = ${f.actorId}`);
  if (f.action !== undefined) {
    parts.push(
      f.action.endsWith('*')
        ? Prisma.sql`action LIKE ${likePrefix(f.action.slice(0, -1))} ESCAPE '\\'`
        : Prisma.sql`action = ${f.action}`,
    );
  }
  if (f.resourceType !== undefined) parts.push(Prisma.sql`target_type = ${f.resourceType}`);
  if (f.resourceId !== undefined) parts.push(Prisma.sql`target_id = ${f.resourceId}`);
  if (f.outcome !== undefined) parts.push(Prisma.sql`outcome = ${f.outcome}::audit_outcome`);
  if (f.correlationId !== undefined) parts.push(Prisma.sql`correlation_id = ${f.correlationId}`);
  if (f.interactionId !== undefined) parts.push(Prisma.sql`interaction_id = ${f.interactionId}`);
  if (f.q !== undefined) parts.push(Prisma.sql`search @@ websearch_to_tsquery('simple', ${f.q})`);
  if (f.fromSeq !== undefined) parts.push(Prisma.sql`seq >= ${f.fromSeq}`);
  if (f.toSeq !== undefined) parts.push(Prisma.sql`seq <= ${f.toSeq}`);
  return Prisma.join(parts, ' AND ');
}

/** Reads only: the table is append-only (no UPDATE/DELETE grant, blocking triggers). */
@Injectable()
export class AuditRepository {
  /** Keyset page by seq (`after` exclusive). */
  async search(
    tx: TransactionClient,
    tenantId: string,
    filters: AuditFilters,
    page: { limit: number; direction: 'asc' | 'desc'; after?: bigint },
  ): Promise<StoredAuditRow[]> {
    const keyset =
      page.after === undefined
        ? Prisma.empty
        : page.direction === 'desc'
          ? Prisma.sql`AND seq < ${page.after}`
          : Prisma.sql`AND seq > ${page.after}`;
    const order = page.direction === 'desc' ? Prisma.sql`seq DESC` : Prisma.sql`seq ASC`;
    const rows = await tx.$queryRaw<StoredAuditRow[]>`
      SELECT ${COLUMNS} FROM audit_events
       WHERE ${whereClause(tenantId, filters)} ${keyset}
       ORDER BY ${order} LIMIT ${page.limit}`;
    return rows.map(normalizeRow);
  }

  /** Ascending range for verification/export, `seq > afterSeq`, at most `limit` rows. */
  async range(
    tx: TransactionClient,
    tenantId: string,
    afterSeq: bigint,
    toSeq: bigint | undefined,
    limit: number,
  ): Promise<StoredAuditRow[]> {
    const upper = toSeq === undefined ? Prisma.empty : Prisma.sql`AND seq <= ${toSeq}`;
    const rows = await tx.$queryRaw<StoredAuditRow[]>`
      SELECT ${COLUMNS} FROM audit_events
       WHERE tenant_id = ${tenantId}::uuid AND seq > ${afterSeq} ${upper}
       ORDER BY seq ASC LIMIT ${limit}`;
    return rows.map(normalizeRow);
  }

  async findBySeq(
    tx: TransactionClient,
    tenantId: string,
    seq: bigint,
  ): Promise<StoredAuditRow | undefined> {
    const rows = await tx.$queryRaw<StoredAuditRow[]>`
      SELECT ${COLUMNS} FROM audit_events WHERE tenant_id = ${tenantId}::uuid AND seq = ${seq}`;
    const row = rows[0];
    return row === undefined ? undefined : normalizeRow(row);
  }

  async minSeq(tx: TransactionClient, tenantId: string): Promise<bigint | undefined> {
    const rows = await tx.$queryRaw<{ min: bigint | null }[]>`
      SELECT min(seq) AS min FROM audit_events WHERE tenant_id = ${tenantId}::uuid`;
    const min = rows[0]?.min;
    return min === null || min === undefined ? undefined : toBigInt(min);
  }

  async head(
    tx: TransactionClient,
    tenantId: string,
  ): Promise<{ seq: bigint; hash: string } | undefined> {
    const rows = await tx.$queryRaw<{ seq: bigint; hash: string }[]>`
      SELECT seq, hash FROM audit_chain_heads WHERE tenant_id = ${tenantId}::uuid`;
    const row = rows[0];
    return row === undefined ? undefined : { seq: toBigInt(row.seq), hash: row.hash };
  }
}

/** pg returns BIGINT as bigint/strings depending on the adapter; normalize once. */
export function normalizeRow(row: StoredAuditRow): StoredAuditRow {
  return {
    ...row,
    seq: toBigInt(row.seq),
    hashVersion: toInt(row.hashVersion),
    occurredAt: new Date(row.occurredAt),
    recordedAt: new Date(row.recordedAt),
  };
}
