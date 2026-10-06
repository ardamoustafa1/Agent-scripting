import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { requestContext, systemContext } from '../common/context/request-context.js';
import { ulid } from '../common/ids/ulid.js';
import { type ApiEnv, API_ENV } from '../env.js';
import { PrismaService } from '../infra/database/prisma.service.js';
import { TenantDb } from '../infra/database/tenant-db.js';
import { S3WormClient } from '../modules/audit/archive/s3-worm.client.js';
import { normalizeRow } from '../modules/audit/audit.repository.js';
import { AUDIT_CLOCK, AuditService } from '../modules/audit/audit.service.js';
import { toWireEvent } from '../modules/audit/core/formats.js';
import { toBigInt, toInt } from '../modules/audit/core/scalars.js';

import { CheckpointJob } from './checkpoint.job.js';
import { activeTenants, type ActiveTenant } from './tenants.js';

import type { StoredAuditRow } from '../modules/audit/core/audit-event.js';

export const WORM_CLIENT = Symbol('WORM_CLIENT');
const SYSTEM_ACTOR = { type: 'system', id: 'audit-worker:archive' } as const;
const PARTITION = /^(audit_events|session_events)_y(\d{4})m(\d{2})$/;

export interface PartitionInfo {
  readonly name: string;
  readonly parent: 'audit_events' | 'session_events';
  readonly stream: 'audit' | 'session';
  readonly start: Date;
  readonly end: Date;
}

export function parsePartition(name: string): PartitionInfo | undefined {
  const match = PARTITION.exec(name);
  if (match === null) return undefined;
  const [, parent, year, month] = match;
  if (parent === undefined || year === undefined || month === undefined) return undefined;
  const start = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  const end = new Date(Date.UTC(Number(year), Number(month), 1));
  return {
    name,
    parent: parent as PartitionInfo['parent'],
    stream: parent === 'audit_events' ? 'audit' : 'session',
    start,
    end,
  };
}

/** A partition is droppable for a tenant once it ended more than its retention ago. */
export function retentionElapsed(
  partition: PartitionInfo,
  tenant: ActiveTenant,
  now: Date,
): boolean {
  const days = partition.stream === 'audit' ? tenant.retentionDays : tenant.sessionRetentionDays;
  return partition.end.getTime() + days * 86_400_000 <= now.getTime();
}

const DAY = 86_400_000;

/**
 * Partition lifecycle (worker only):
 *  - ensure monthly partitions ahead;
 *  - archive every closed month per tenant to S3 Object Lock (COMPLIANCE, retain-until =
 *    partition end + tenant retention), read it back, compare SHA-256 and lock mode, record
 *    `uploaded` then `verified` rows (append-only registry);
 *  - drop a partition only when, for every tenant in it, retention elapsed, no legal hold, a
 *    verified archive exists and a signed boundary checkpoint covers its last seq. The database
 *    function re-checks the global retention floor and the archives before DETACH/DROP.
 */
@Injectable()
export class PartitionLifecycleJob {
  readonly #logger = new Logger(PartitionLifecycleJob.name);

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CheckpointJob) private readonly checkpoints: CheckpointJob,
    @Optional() @Inject(WORM_CLIENT) private readonly worm?: S3WormClient,
    @Optional() @Inject(AUDIT_CLOCK) clock?: () => Date,
  ) {
    this.now = clock ?? (() => new Date());
  }

  private readonly now: () => Date;

  async ensurePartitions(): Promise<number> {
    const rows = await this.prisma.client.$queryRaw<{ created: number }[]>`
      SELECT audit_ensure_partitions(${this.env.AUDIT_PARTITION_MONTHS_AHEAD}::int) AS created`;
    return toInt(rows[0]?.created ?? 0);
  }

  async partitions(): Promise<PartitionInfo[]> {
    const rows = await this.prisma.client.$queryRaw<{ name: string }[]>`
      SELECT c.relname AS name FROM pg_inherits i
        JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
       WHERE p.relname IN ('audit_events', 'session_events')`;
    return rows
      .flatMap((row) => parsePartition(row.name) ?? [])
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  async tick(): Promise<void> {
    await this.ensurePartitions();
    if (this.worm === undefined) return; // No WORM store: never archive, never drop.
    const now = this.now();
    const tenants = new Map(
      (await activeTenants(this.prisma, this.env.AUDIT_DEFAULT_RETENTION_DAYS)).map((t) => [
        t.id,
        t,
      ]),
    );
    // Closed months only (ended at least one day ago).
    for (const partition of (await this.partitions()).filter(
      (p) => p.end.getTime() + DAY <= now.getTime(),
    )) {
      const present = await this.#tenantsIn(partition);
      for (const tenantId of present)
        await this.archive(partition, tenantId, tenants.get(tenantId));
      await this.#maybeDrop(partition, present, tenants, now);
    }
  }

  async #tenantsIn(partition: PartitionInfo): Promise<string[]> {
    // Through the parent (partitions have no grants for runtime roles); pruning hits one partition.
    const rows =
      partition.parent === 'audit_events'
        ? await this.prisma.client.$queryRaw<{ tenant_id: string }[]>`
            SELECT DISTINCT tenant_id FROM audit_events
             WHERE recorded_at >= ${partition.start}::timestamptz AND recorded_at < ${partition.end}::timestamptz`
        : await this.prisma.client.$queryRaw<{ tenant_id: string }[]>`
            SELECT DISTINCT tenant_id FROM session_events
             WHERE recorded_at >= ${partition.start}::timestamptz AND recorded_at < ${partition.end}::timestamptz`;
    return rows.map((r) => r.tenant_id);
  }

  async archive(
    partition: PartitionInfo,
    tenantId: string,
    tenant: ActiveTenant | undefined,
  ): Promise<void> {
    const worm = this.worm;
    if (worm === undefined) return;
    const ctx = systemContext(ulid(), 'audit-worker:archive');
    await requestContext.run(ctx, () =>
      this.tenantDb.run(
        tenantId,
        async (tx) => {
          const existing = await tx.$queryRaw<{ status: string; retainUntil: Date }[]>`
            SELECT status, retain_until AS "retainUntil" FROM audit_archives
             WHERE tenant_id = ${tenantId}::uuid AND stream = ${partition.stream} AND partition_name = ${partition.name}`;
          if (existing.some((r) => r.status === 'verified')) return;
          const lines =
            partition.stream === 'audit'
              ? await this.#auditLines(tx, partition, tenantId)
              : await this.#sessionLines(tx, partition, tenantId);
          const body = gzipSync(Buffer.from(lines.text, 'utf8'));
          const sha256 = createHash('sha256').update(body).digest('hex');
          const retentionDays =
            partition.stream === 'audit' ? tenant?.retentionDays : tenant?.sessionRetentionDays;
          // A backlog can outlive its original retention; S3 requires a future Object Lock date.
          // Reuse an uploaded object's deadline so retries do not demand a moving deadline.
          const uploaded = existing.find((row) => row.status === 'uploaded');
          const retainUntil =
            uploaded?.retainUntil ??
            new Date(
              Math.max(
                partition.end.getTime() + (retentionDays ?? 36_500) * DAY,
                this.now().getTime() + DAY,
              ),
            );
          const key = `audit/${tenantId}/${partition.stream}/${partition.name}-${sha256.slice(0, 16)}.ndjson.gz`;
          if (!existing.some((r) => r.status === 'uploaded')) {
            await worm.putLocked(key, body, retainUntil, 'application/gzip');
            await this.#register(
              tx,
              tenantId,
              partition,
              lines,
              key,
              sha256,
              retainUntil,
              'uploaded',
            );
          }
          const readBack = await worm.get(key);
          const readHash = createHash('sha256').update(readBack.body).digest('hex');
          const verifiedRetention = Date.parse(readBack.retainUntil ?? '');
          if (
            readHash !== sha256 ||
            readBack.lockMode !== this.env.AUDIT_ARCHIVE_LOCK_MODE ||
            !Number.isFinite(verifiedRetention) ||
            verifiedRetention < retainUntil.getTime() ||
            verifiedRetention <= this.now().getTime()
          ) {
            throw new Error('archive read-back verification failed');
          }
          await this.#register(
            tx,
            tenantId,
            partition,
            lines,
            key,
            sha256,
            retainUntil,
            'verified',
          );
          await this.audit.recordMany(
            tx,
            [
              {
                action: 'audit.archive.verified',
                target: { type: 'AuditArchive', id: key },
                actor: SYSTEM_ACTOR,
                metadata: {
                  partition: partition.name,
                  rows: lines.count,
                  sha256,
                  retainUntil: retainUntil.toISOString(),
                  lockMode: readBack.lockMode,
                },
              },
            ],
            { tenantId },
          );
        },
        { timeoutMs: 600_000 },
      ),
    );
  }

  async #register(
    tx: Parameters<Parameters<TenantDb['run']>[1]>[0],
    tenantId: string,
    partition: PartitionInfo,
    lines: { count: number; fromSeq: bigint | null; toSeq: bigint | null },
    key: string,
    sha256: string,
    retainUntil: Date,
    status: 'uploaded' | 'verified',
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO audit_archives (id, tenant_id, stream, partition_name, from_seq, to_seq, row_count, object_key,
                                  sha256, retain_until, status)
      VALUES (${ulid()}, ${tenantId}::uuid, ${partition.stream}, ${partition.name}, ${lines.fromSeq}, ${lines.toSeq},
              ${lines.count}, ${key}, ${sha256}, ${retainUntil}::timestamptz, ${status})
      ON CONFLICT ON CONSTRAINT audit_archives_unique DO NOTHING`;
  }

  async #auditLines(
    tx: Parameters<Parameters<TenantDb['run']>[1]>[0],
    partition: PartitionInfo,
    tenantId: string,
  ) {
    const rows = await tx.$queryRaw<StoredAuditRow[]>`
      SELECT id, tenant_id AS "tenantId", seq, hash_version AS "hashVersion", action, actor_type AS "actorType",
             actor_id AS "actorId", actor, target_type AS "targetType", target_id AS "targetId",
             target_name AS "targetName", outcome::text AS outcome, reason, diff, correlation_id AS "correlationId",
             interaction_id AS "interactionId", metadata, occurred_at AS "occurredAt", recorded_at AS "recordedAt",
             prev_hash AS "prevHash", hash
        FROM audit_events
       WHERE tenant_id = ${tenantId}::uuid AND recorded_at >= ${partition.start}::timestamptz
         AND recorded_at < ${partition.end}::timestamptz
       ORDER BY seq ASC`;
    const normalized = rows.map(normalizeRow);
    // Full rows incl. actor details: the archive must be independently verifiable.
    const text = normalized
      .map((row) => JSON.stringify({ ...toWireEvent(row), actorDetails: row.actor }))
      .join('\n');
    return {
      text,
      count: normalized.length,
      fromSeq: normalized[0]?.seq ?? null,
      toSeq: normalized[normalized.length - 1]?.seq ?? null,
    };
  }

  async #sessionLines(
    tx: Parameters<Parameters<TenantDb['run']>[1]>[0],
    partition: PartitionInfo,
    tenantId: string,
  ) {
    const rows = await tx.$queryRaw<Record<string, unknown>[]>`
      SELECT id, session_id AS "sessionId", seq, type, payload, actor_id AS "actorId", page_id AS "pageId",
             occurred_at AS "occurredAt", recorded_at AS "recordedAt", created_by AS "createdBy",
             prev_hash AS "prevHash", hash
        FROM session_events
       WHERE tenant_id = ${tenantId}::uuid AND recorded_at >= ${partition.start}::timestamptz
         AND recorded_at < ${partition.end}::timestamptz
       ORDER BY session_id, seq`;
    return {
      text: rows.map((r) => JSON.stringify({ ...r, seq: toInt(r['seq']), tenantId })).join('\n'),
      count: rows.length,
      fromSeq: null,
      toSeq: null,
    };
  }

  async #maybeDrop(
    partition: PartitionInfo,
    present: readonly string[],
    tenants: ReadonlyMap<string, ActiveTenant>,
    now: Date,
  ): Promise<void> {
    for (const tenantId of present) {
      const tenant = tenants.get(tenantId);
      // Unknown (inactive/deleted) tenants keep their data: no drop.
      if (tenant === undefined || tenant.legalHold || !retentionElapsed(partition, tenant, now))
        return;
    }
    if (partition.stream === 'audit') {
      // The remaining chain must stay verifiable: sign a checkpoint exactly at each tenant's last
      // seq in this partition (seq ranges are contiguous per partition: recorded_at is chain time).
      for (const tenantId of present) {
        const rows = await this.prisma.client.$queryRaw<{ max: bigint | null }[]>`
          SELECT max(seq) AS max FROM audit_events
           WHERE tenant_id = ${tenantId}::uuid AND recorded_at >= ${partition.start}::timestamptz
             AND recorded_at < ${partition.end}::timestamptz`;
        const max = rows[0]?.max;
        if (max === null || max === undefined) continue;
        const checkpoint = await this.checkpoints.checkpointTenant(tenantId, toBigInt(max));
        if (checkpoint?.seq !== toBigInt(max)) return;
      }
    }
    try {
      await this.prisma.client.$queryRaw`SELECT audit_drop_partition(${partition.name})`;
      this.#logger.log(`Dropped archived partition ${partition.name}`);
      for (const tenantId of present) {
        await requestContext.run(systemContext(ulid(), 'audit-worker:retention'), () =>
          this.tenantDb.run(tenantId, (tx) =>
            this.audit.recordMany(
              tx,
              [
                {
                  action: 'audit.partition.dropped',
                  target: { type: 'AuditPartition', id: partition.name },
                  actor: SYSTEM_ACTOR,
                  metadata: {
                    stream: partition.stream,
                    start: partition.start.toISOString(),
                    end: partition.end.toISOString(),
                  },
                },
              ],
              { tenantId },
            ),
          ),
        );
      }
    } catch (error) {
      this.#logger.warn(
        `Partition ${partition.name} not dropped: ${error instanceof Error ? error.name : 'error'}`,
      );
    }
  }
}
