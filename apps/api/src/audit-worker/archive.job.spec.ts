import { gunzipSync } from 'node:zlib';

import { expect, it, vi } from 'vitest';

import { parsePartition, PartitionLifecycleJob } from './archive.job.js';

import type { ApiEnv } from '../env.js';
import type { CheckpointJob } from './checkpoint.job.js';
import type { PrismaService, TransactionClient } from '../infra/database/prisma.service.js';
import type { TenantDb } from '../infra/database/tenant-db.js';
import type { S3WormClient } from '../modules/audit/archive/s3-worm.client.js';
import type { AuditService } from '../modules/audit/audit.service.js';

const tenant = '01990000-0000-7000-8000-000000000001';
function fixture(stream: 'audit' | 'session' = 'audit') {
  const partition = parsePartition(`${stream === 'audit' ? 'audit' : 'session'}_events_y2026m05`)!;
  const settings = { audit: { retentionDays: 365, sessionRetentionDays: 365, legalHold: false } };
  let statuses: { status: string; retainUntil?: Date }[] = [];
  let body: Buffer = Buffer.alloc(0),
    retainUntil = new Date('2027-06-01T00:00:00Z');
  const sessionRow = {
    id: 'synthetic',
    sessionId: tenant,
    seq: 3 as number | bigint | string,
    type: 'state',
    payload: {},
    actorId: 'synthetic',
    pageId: 'home',
    occurredAt: new Date('2026-05-01T00:00:00Z'),
    recordedAt: new Date('2026-05-01T00:00:00Z'),
    createdBy: 'synthetic',
    prevHash: '0'.repeat(64),
    hash: 'a'.repeat(64),
  };
  const tx = {
    $queryRaw: vi
      .fn()
      .mockImplementation((sql: TemplateStringsArray) =>
        Promise.resolve(
          sql.join('').includes('SELECT status')
            ? statuses
            : stream === 'session'
              ? [sessionRow]
              : [],
        ),
      ),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  const raw = vi.fn().mockImplementation((sql: TemplateStringsArray) => {
    const query = sql.join('');
    if (query.includes('audit_ensure_partitions')) return Promise.resolve([{ created: 2 }]);
    if (query.includes('audit_active_tenants')) return Promise.resolve([{ id: tenant, settings }]);
    if (query.includes('pg_inherits'))
      return Promise.resolve([{ name: partition.name }, { name: 'unrelated' }]);
    if (query.includes('SELECT DISTINCT tenant_id'))
      return Promise.resolve([{ tenant_id: tenant }]);
    if (query.includes('SELECT max(seq)')) return Promise.resolve([{ max: 3n }]);
    return Promise.resolve([]);
  });
  const putLocked = vi.fn().mockImplementation((_key: string, value: Buffer, until: Date) => {
    body = value;
    retainUntil = until;
    return Promise.resolve();
  });
  const worm = {
    putLocked,
    get: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ body, lockMode: 'COMPLIANCE', retainUntil: retainUntil.toISOString() }),
      ),
  };
  const audit = { recordMany: vi.fn().mockResolvedValue([]) },
    checkpoints = { checkpointTenant: vi.fn().mockResolvedValue({ seq: 3n }) };
  const job = new PartitionLifecycleJob(
    {
      AUDIT_PARTITION_MONTHS_AHEAD: 2,
      AUDIT_DEFAULT_RETENTION_DAYS: 365,
      AUDIT_ARCHIVE_LOCK_MODE: 'COMPLIANCE',
    } as ApiEnv,
    { client: { $queryRaw: raw } } as unknown as PrismaService,
    {
      run: (_tenant: string, work: (tx: TransactionClient) => Promise<unknown>) =>
        work(tx as unknown as TransactionClient),
    } as unknown as TenantDb,
    audit as unknown as AuditService,
    checkpoints as unknown as CheckpointJob,
    worm as unknown as S3WormClient,
    () => new Date('2026-07-02T00:00:00Z'),
  );
  return {
    job,
    partition,
    settings,
    tx,
    raw,
    worm,
    audit,
    checkpoints,
    sessionRow,
    setStatuses: (value: typeof statuses) => {
      statuses = value;
    },
  };
}
it.each([3, 3n, '3'])(
  'normalizes session sequence %s while preserving numeric NDJSON format',
  async (sequence) => {
    const f = fixture('session');
    f.sessionRow.seq = sequence;
    await f.job.archive(f.partition, tenant, undefined);
    const body = f.worm.putLocked.mock.calls[0]![1] as Buffer;
    const line = JSON.parse(gunzipSync(body).toString()) as { seq: number; tenantId: string };
    expect(line.seq).toBe(3);
    expect(line.tenantId).toBe(tenant);
    expect(f.tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(f.audit.recordMany).toHaveBeenCalledTimes(1);
  },
);
it.each([
  'badHash',
  'missingMode',
  'wrongMode',
  'missingRetention',
  'invalidRetention',
  'shortRetention',
] as const)('refuses to verify unsafe read-back metadata: %s', async (reason) => {
  const f = fixture();
  f.worm.get.mockImplementation(() => {
    const body = f.worm.putLocked.mock.calls[0]![1] as Buffer;
    const until = f.worm.putLocked.mock.calls[0]![2] as Date;
    return Promise.resolve({
      body: reason === 'badHash' ? Buffer.from('corrupted') : body,
      lockMode:
        reason === 'missingMode' ? null : reason === 'wrongMode' ? 'GOVERNANCE' : 'COMPLIANCE',
      retainUntil:
        reason === 'missingRetention'
          ? null
          : reason === 'invalidRetention'
            ? 'invalid'
            : new Date(until.getTime() - (reason === 'shortRetention' ? 1000 : 0)).toISOString(),
    });
  });
  await expect(f.job.archive(f.partition, tenant, undefined)).rejects.toThrow(
    'verification failed',
  );
  expect(f.tx.$executeRaw).toHaveBeenCalledTimes(1);
  expect(f.audit.recordMany).not.toHaveBeenCalled();
});
it('records upload and verification separately, skips verified rows and resumes uploaded objects', async () => {
  const f = fixture();
  await f.job.archive(f.partition, tenant, undefined);
  const states = f.tx.$executeRaw.mock.calls.map((call) => call.at(-1) as unknown);
  expect(states).toEqual(['uploaded', 'verified']);
  f.setStatuses([{ status: 'verified' }]);
  await f.job.archive(f.partition, tenant, undefined);
  expect(f.worm.putLocked).toHaveBeenCalledTimes(1);
  f.setStatuses([{ status: 'uploaded' }]);
  await f.job.archive(f.partition, tenant, undefined);
  expect(f.worm.putLocked).toHaveBeenCalledTimes(1);
  expect(f.worm.get).toHaveBeenCalledTimes(2);
});
it.each(['retention', 'legalHold', 'checkpointMismatch', 'eligible', 'databaseRefusal'] as const)(
  'drops partitions only after every retention/archive/checkpoint gate: %s',
  async (condition) => {
    const f = fixture();
    if (condition !== 'retention') f.settings.audit.retentionDays = 30;
    if (condition === 'legalHold') f.settings.audit.legalHold = true;
    if (condition === 'checkpointMismatch')
      f.checkpoints.checkpointTenant.mockResolvedValue({ seq: 2n });
    if (condition === 'databaseRefusal') {
      const original = f.raw.getMockImplementation()!;
      f.raw.mockImplementation((sql: TemplateStringsArray) =>
        sql.join('').includes('audit_drop_partition')
          ? Promise.reject(new Error('Synthetic retention fence'))
          : (original(sql) as Promise<unknown[]>),
      );
    }
    await f.job.tick();
    const drops = f.raw.mock.calls.filter(([sql]) =>
      (sql as TemplateStringsArray).join('').includes('audit_drop_partition'),
    );
    expect(drops).toHaveLength(condition === 'eligible' || condition === 'databaseRefusal' ? 1 : 0);
    expect(
      f.audit.recordMany.mock.calls.some(
        ([, events]) => (events as { action: string }[])[0]?.action === 'audit.partition.dropped',
      ),
    ).toBe(condition === 'eligible');
  },
);

it('uses a future Object Lock deadline when archiving a retention-expired backlog', async () => {
  const f = fixture();
  await f.job.archive(f.partition, tenant, {
    id: tenant,
    retentionDays: 30,
    sessionRetentionDays: 30,
    legalHold: false,
  });
  const until = f.worm.putLocked.mock.calls[0]![2] as Date;
  expect(until.getTime()).toBeGreaterThan(Date.parse('2026-07-02T00:00:00Z'));
});

it('resumes an uploaded object with its persisted deadline when tenant settings become unavailable', async () => {
  const f = fixture();
  await f.job.archive(f.partition, tenant, {
    id: tenant,
    retentionDays: 365,
    sessionRetentionDays: 365,
    legalHold: false,
  });
  const retainUntil = f.worm.putLocked.mock.calls[0]![2] as Date;
  f.setStatuses([{ status: 'uploaded', retainUntil }]);
  await f.job.archive(f.partition, tenant, undefined);
  expect(f.worm.putLocked).toHaveBeenCalledTimes(1);
  expect(f.worm.get).toHaveBeenCalledTimes(2);
  expect(f.tx.$executeRaw.mock.calls.at(-1)).toContain(retainUntil);
});
