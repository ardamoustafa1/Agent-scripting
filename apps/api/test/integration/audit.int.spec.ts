import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { surveyScript } from '@verbis/script-schema/fixtures';

import { parsePartition, PartitionLifecycleJob } from '../../src/audit-worker/archive.job.js';
import { CheckpointJob } from '../../src/audit-worker/checkpoint.job.js';
import { DomainEventAuditHandler } from '../../src/audit-worker/domain-event-audit.handler.js';
import { EnvSecretResolver } from '../../src/audit-worker/secret-resolver.js';
import { SiemDispatcher } from '../../src/audit-worker/siem.dispatcher.js';
import { requestContext } from '../../src/common/context/request-context.js';
import { PrismaService } from '../../src/infra/database/prisma.service.js';
import { TenantDb } from '../../src/infra/database/tenant-db.js';
import { OutboxWriter } from '../../src/infra/outbox/outbox.writer.js';
import { S3WormClient } from '../../src/modules/audit/archive/s3-worm.client.js';
import { AuditRepository } from '../../src/modules/audit/audit.repository.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import { recomputeHash } from '../../src/modules/audit/core/audit-event.js';
import { CheckpointSigner } from '../../src/modules/audit/core/checkpoint-signer.js';
import { verifySessionChain } from '../../src/modules/audit/session-events/session-chain.js';
import { SessionEventWriter } from '../../src/modules/audit/session-events/session-event.writer.js';
import { checkpointKeys, roleClient, sqlState, workerTestEnv } from '../support/audit.js';
import { createTokenKit, type TokenKit } from '../support/tokens.js';

import {
  createTenant,
  integrationEnv,
  ownerPrisma,
  startApp,
  type TenantFixture,
  uniqueSlug,
} from './helpers.js';

import type { ApiEnv } from '../../src/env.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { KafkaProducer } from '../../src/modules/audit/siem/kafka.sink.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

let kit: TokenKit;
let owner: PrismaClient;
let app: NestFastifyApplication;
let env: ApiEnv;
const keys = checkpointKeys();
const json = { 'content-type': 'application/json' };

beforeAll(async () => {
  kit = await createTokenKit();
  owner = ownerPrisma();
  env = integrationEnv(kit.jwks, {
    AUDIT_CHECKPOINT_JWKS: keys.jwks,
    AUDIT_CHECKPOINT_SIGNING_JWK: keys.signingJwk,
  });
  app = await startApp(env);
});

afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});

async function tenantWithEvents(n: number): Promise<TenantFixture> {
  const tenant = await createTenant(owner, kit, uniqueSlug('audit'));
  const auth = await tenant.auth();
  for (let i = 0; i < n; i += 1) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/campaigns',
      headers: { ...json, ...auth },
      payload: { name: `C${String(i)}` },
    });
    expect(res.statusCode).toBe(201);
  }
  return tenant;
}

async function verify(tenant: TenantFixture, body: Record<string, string> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/audit-events/verify',
    headers: { ...json, ...(await tenant.auth()) },
    payload: body,
  });
  expect(res.statusCode).toBe(200);
  return res.json<{
    valid: boolean;
    checked: number;
    breaks: { kind: string; seq: string }[];
    anchor: { source: string };
  }>();
}

/** Owner as superuser with triggers bypassed: simulates a DBA/attacker editing storage directly. */
async function tamper(sql: string, ...params: unknown[]): Promise<void> {
  const client = await roleClient(inject('pgOwnerUrl'));
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(sql, params);
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
}

function workerJob(signer: CheckpointSigner) {
  const wenv = workerTestEnv(env);
  const prisma = new PrismaService(wenv);
  const tenantDb = new TenantDb(prisma);
  const audit = new AuditService(new OutboxWriter());
  return {
    prisma,
    tenantDb,
    audit,
    job: new CheckpointJob(wenv, prisma, tenantDb, new AuditRepository(), audit, signer),
    wenv,
  };
}

describe('audit chain: write path', () => {
  it('chains API mutations, the chain verifies, and verification itself is audited', async () => {
    const tenant = await tenantWithEvents(5);
    const report = await verify(tenant);
    expect(report).toMatchObject({ valid: true, breaks: [], anchor: { source: 'genesis' } });
    expect(report.checked).toBeGreaterThanOrEqual(5);
    const rows = await owner.auditEvent.findMany({
      where: { tenantId: tenant.tenantId },
      orderBy: { seq: 'asc' },
    });
    for (const row of rows) expect(recomputeHash(row)).toBe(row.hash);
    expect(rows.at(-1)?.action).toBe('audit.chain.verified');
    expect(rows.every((row) => /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(row.id))).toBe(true);
  });

  it('rows land in monthly partitions, not the default partition', async () => {
    const tenant = await tenantWithEvents(1);
    const rows = await owner.$queryRaw<{ partition: string }[]>`
      SELECT tableoid::regclass::text AS partition FROM audit_events WHERE tenant_id = ${tenant.tenantId}::uuid`;
    expect(rows.every((r) => /^audit_events_y\d{4}m\d{2}$/.test(r.partition))).toBe(true);
  });
});

describe('audit chain: tamper detection', () => {
  it('detects an edited row and reports its seq', async () => {
    const tenant = await tenantWithEvents(6);
    await tamper(
      `UPDATE audit_events SET target_name = 'forged' WHERE tenant_id = $1 AND seq = 3`,
      tenant.tenantId,
    );
    const report = await verify(tenant);
    expect(report.valid).toBe(false);
    expect(report.breaks[0]).toMatchObject({ kind: 'hash_mismatch', seq: '3' });
  });

  it('detects a deleted row as a gap', async () => {
    const tenant = await tenantWithEvents(6);
    await tamper(`DELETE FROM audit_events WHERE tenant_id = $1 AND seq = 4`, tenant.tenantId);
    const report = await verify(tenant, { toSeq: '6' });
    expect(report.breaks.map((b) => `${b.kind}@${b.seq}`)).toEqual([
      'sequence_gap@5',
      'link_mismatch@5',
    ]);
  });

  it('detects a consistently re-hashed forgery at the next link', async () => {
    const tenant = await tenantWithEvents(6);
    const row = await owner.auditEvent.findFirstOrThrow({
      where: { tenantId: tenant.tenantId, seq: 2n },
    });
    const forged = { ...row, targetName: 'forged' };
    await tamper(
      `UPDATE audit_events SET target_name = 'forged', hash = $2 WHERE tenant_id = $1 AND seq = 2`,
      tenant.tenantId,
      recomputeHash(forged),
    );
    expect((await verify(tenant)).breaks[0]).toMatchObject({ kind: 'link_mismatch', seq: '3' });
  });

  it('detects a fully rewritten tail through the signed checkpoint', async () => {
    const tenant = await tenantWithEvents(4);
    const signer = CheckpointSigner.fromJwk(keys.signingJwk, keys.jwks);
    const { job, prisma } = workerJob(signer);
    const checkpoint = await job.checkpointTenant(tenant.tenantId);
    expect(checkpoint?.seq).toBeGreaterThanOrEqual(4n);
    // Rewrite every row from 1 and re-hash the whole chain consistently.
    const rows = await owner.auditEvent.findMany({
      where: { tenantId: tenant.tenantId, seq: { lte: checkpoint!.seq } },
      orderBy: { seq: 'asc' },
    });
    let prev = rows[0]!.prevHash;
    for (const row of rows) {
      const next = { ...row, targetName: 'rewritten', prevHash: prev };
      const hash = recomputeHash(next);
      await tamper(
        `UPDATE audit_events SET target_name = 'rewritten', prev_hash = $3, hash = $4 WHERE tenant_id = $1 AND seq = $2`,
        tenant.tenantId,
        row.seq,
        prev,
        hash,
      );
      prev = hash;
    }
    const report = await verify(tenant, { toSeq: checkpoint!.seq.toString() });
    expect(report.breaks.map((b) => b.kind)).toContain('checkpoint_mismatch');
    // The worker refuses to sign on top of a broken chain and records the violation.
    const auth = await tenant.auth();
    await app.inject({
      method: 'POST',
      url: '/v1/campaigns',
      headers: { ...json, ...auth },
      payload: { name: 'after' },
    });
    expect(await job.checkpointTenant(tenant.tenantId)).toBeUndefined();
    const violation = await owner.auditEvent.findFirst({
      where: { tenantId: tenant.tenantId, action: 'audit.chain.integrityViolation' },
    });
    expect(violation?.outcome).toBe('failure');
    await prisma.client.$disconnect();
  });

  it('verifies a range from a checkpoint anchor after older history is gone', async () => {
    const tenant = await tenantWithEvents(5);
    const signer = CheckpointSigner.fromJwk(keys.signingJwk, keys.jwks);
    const { job, prisma } = workerJob(signer);
    const checkpoint = await job.checkpointTenant(tenant.tenantId, 3n);
    expect(checkpoint?.seq).toBe(3n);
    await tamper(`DELETE FROM audit_events WHERE tenant_id = $1 AND seq <= 3`, tenant.tenantId);
    const report = await verify(tenant, { fromSeq: '4' });
    expect(report).toMatchObject({ valid: true, anchor: { source: 'checkpoint' } });
    await prisma.client.$disconnect();
  });
});

describe('audit chain: immutability (unauthorized deletion is refused)', () => {
  let tenant: TenantFixture;
  beforeAll(async () => {
    tenant = await tenantWithEvents(2);
  });

  const MUTATIONS = [
    "UPDATE audit_events SET action = 'x.y'",
    'DELETE FROM audit_events',
    'TRUNCATE audit_events',
    'DELETE FROM audit_checkpoints',
    "UPDATE session_events SET type = 'x.y'",
    'DELETE FROM session_events',
    'DELETE FROM audit_archives',
  ];

  it.each(MUTATIONS)('verbis_app: %s → permission denied', async (statement) => {
    const client = await roleClient(inject('pgAppUrl'));
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.tenantId]);
      expect(await sqlState(client.query(statement))).toBe('42501');
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  });

  it.each(MUTATIONS)('verbis_audit_worker: %s → permission denied', async (statement) => {
    const client = await roleClient(inject('pgWorkerUrl'));
    try {
      expect(await sqlState(client.query(statement))).toBe('42501');
    } finally {
      await client.end();
    }
  });

  it('runtime roles cannot touch partitions directly or run partition DDL', async () => {
    const [partition] = await owner.$queryRaw<{ name: string }[]>`
      SELECT tableoid::regclass::text AS name FROM audit_events WHERE tenant_id = ${tenant.tenantId}::uuid LIMIT 1`;
    for (const url of [inject('pgAppUrl'), inject('pgWorkerUrl')]) {
      const client = await roleClient(url);
      try {
        expect(await sqlState(client.query(`SELECT * FROM ${partition!.name}`))).toBe('42501');
        expect(await sqlState(client.query(`DELETE FROM ${partition!.name}`))).toBe('42501');
        expect(
          await sqlState(
            client.query(`ALTER TABLE audit_events DETACH PARTITION ${partition!.name}`),
          ),
        ).toBe('42501');
        expect(await sqlState(client.query(`DROP TABLE ${partition!.name}`))).toBe('42501');
      } finally {
        await client.end();
      }
    }
    const app = await roleClient(inject('pgAppUrl'));
    try {
      expect(await sqlState(app.query(`SELECT audit_drop_partition($1)`, [partition!.name]))).toBe(
        '42501',
      );
    } finally {
      await app.end();
    }
  });

  it('the worker cannot drop a partition inside the retention floor or without verified archives', async () => {
    const [partition] = await owner.$queryRaw<{ name: string }[]>`
      SELECT tableoid::regclass::text AS name FROM audit_events WHERE tenant_id = ${tenant.tenantId}::uuid LIMIT 1`;
    const worker = await roleClient(inject('pgWorkerUrl'));
    try {
      await expect(
        worker.query(`SELECT audit_drop_partition($1)`, [partition!.name]),
      ).rejects.toThrow(/retention floor/);
      await expect(worker.query(`SELECT audit_drop_partition('users')`)).rejects.toThrow(
        /not a monthly audit partition/,
      );
    } finally {
      await worker.end();
    }
  });

  it('even the owner cannot UPDATE, DELETE or TRUNCATE (triggers), including on partitions', async () => {
    const [partition] = await owner.$queryRaw<{ name: string }[]>`
      SELECT tableoid::regclass::text AS name FROM audit_events WHERE tenant_id = ${tenant.tenantId}::uuid LIMIT 1`;
    await expect(
      owner.$executeRawUnsafe(
        `UPDATE audit_events SET action = 'x.y' WHERE tenant_id = '${tenant.tenantId}'`,
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      owner.$executeRawUnsafe(`DELETE FROM audit_events WHERE tenant_id = '${tenant.tenantId}'`),
    ).rejects.toThrow(/append-only/);
    await expect(owner.$executeRawUnsafe('TRUNCATE audit_events')).rejects.toThrow(/append-only/);
    await expect(owner.$executeRawUnsafe(`TRUNCATE ${partition!.name}`)).rejects.toThrow(
      /append-only/,
    );
    await expect(owner.$executeRawUnsafe(`DELETE FROM ${partition!.name}`)).rejects.toThrow(
      /append-only/,
    );
    await expect(owner.$executeRawUnsafe('DELETE FROM audit_checkpoints')).rejects.toThrow(
      /append-only/,
    );
    expect(
      await owner.auditEvent.count({ where: { tenantId: tenant.tenantId } }),
    ).toBeGreaterThanOrEqual(2);
  });

  it('the API has no route that deletes or edits audit events', async () => {
    const auth = await tenant.auth();
    for (const method of ['DELETE', 'PUT', 'PATCH'] as const) {
      expect(
        (
          await app.inject({
            method,
            url: '/v1/audit-events',
            headers: { ...json, ...auth },
            payload: {},
          })
        ).statusCode,
      ).toBe(404);
    }
  });
});

describe('audit query API', () => {
  it('filters, searches full text, paginates by seq and audits the read', async () => {
    const tenant = await tenantWithEvents(3);
    const auth = await tenant.auth();
    const page = (
      await app.inject({
        method: 'GET',
        url: '/v1/audit-events?limit=2&sort=seq&action=campaign.*&outcome=success',
        headers: auth,
      })
    ).json<{
      data: { seq: number; action: string }[];
      page: { nextCursor: string | null };
    }>();
    expect(page.data.map((e) => e.seq)).toEqual([1, 2]);
    expect(page.data.every((e) => e.action.startsWith('campaign.'))).toBe(true);
    const next = (
      await app.inject({
        method: 'GET',
        url: `/v1/audit-events?limit=2&sort=seq&action=campaign.*&outcome=success&cursor=${page.page.nextCursor ?? ''}`,
        headers: auth,
      })
    ).json<{ data: { seq: number }[] }>();
    expect(next.data.map((e) => e.seq)).toEqual([3]);
    const fts = (
      await app.inject({ method: 'GET', url: '/v1/audit-events?q=C1', headers: auth })
    ).json<{ data: { resource: { name: string | null } }[] }>();
    expect(fts.data.length).toBeGreaterThanOrEqual(1);
    const listed = await owner.auditEvent.findFirst({
      where: { tenantId: tenant.tenantId },
      orderBy: { seq: 'desc' },
    });
    expect(listed?.action).toBe('audit.event.listed');
    expect(
      (await app.inject({ method: 'GET', url: '/v1/audit-events?cursor=bogus', headers: auth }))
        .statusCode,
    ).toBe(400);
  });

  it('exports CSV and JSON and audits each export before streaming', async () => {
    const tenant = await tenantWithEvents(3);
    const auth = await tenant.auth();
    const csv = await app.inject({
      method: 'GET',
      url: '/v1/audit-events/export?format=csv',
      headers: auth,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.body.trim().split('\r\n');
    expect(lines[0]).toMatch(/^seq,id,/);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    const exportEvent = await owner.auditEvent.findFirst({
      where: { tenantId: tenant.tenantId, action: 'audit.export.created' },
    });
    expect(exportEvent?.metadata).toMatchObject({ format: 'csv' });
    const jsonExport = await app.inject({
      method: 'GET',
      url: '/v1/audit-events/export?format=json&outcome=success',
      headers: auth,
    });
    const parsed = JSON.parse(jsonExport.body) as { seq: string; hash: string }[];
    expect(parsed.length).toBeGreaterThanOrEqual(3);
    expect(
      await owner.auditEvent.count({
        where: { tenantId: tenant.tenantId, action: 'audit.export.created' },
      }),
    ).toBe(2);
  });

  it('denies export without the export permission and audits the denial', async () => {
    const tenant = await tenantWithEvents(1);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/audit-events/export',
      headers: await tenant.auth(tenant.designerId),
    });
    expect(res.statusCode).toBe(403);
    const denied = await owner.auditEvent.findFirst({
      where: { tenantId: tenant.tenantId, action: 'authz.access.denied' },
    });
    expect(denied).toMatchObject({ outcome: 'denied', actorId: tenant.designerId });
  });
});

describe('worker archive against real PostgreSQL', () => {
  it('exports independently verifiable audit rows and persists both archive states exactly once', async () => {
    const tenant = await tenantWithEvents(2);
    const source = await owner.auditEvent.findMany({
      where: { tenantId: tenant.tenantId },
      orderBy: { seq: 'asc' },
    });
    const recordedAt = source[0]!.recordedAt;
    const partition = parsePartition(
      `audit_events_y${String(recordedAt.getUTCFullYear())}m${String(recordedAt.getUTCMonth() + 1).padStart(2, '0')}`,
    )!;
    const worker = workerJob(CheckpointSigner.fromJwk(keys.signingJwk));
    let uploaded: Uint8Array = new Uint8Array(),
      until = '',
      puts = 0,
      gets = 0;
    const worm = new S3WormClient(
      {
        endpoint: 'https://synthetic-s3.example.invalid',
        region: 'synthetic',
        bucket: 'archive',
        accessKeyId: 'synthetic-key',
        secretAccessKey: 'synthetic-secret',
        mode: 'COMPLIANCE',
      },
      (_url, init) => {
        if (init.method === 'PUT') {
          puts++;
          uploaded = new Uint8Array(init.body as Uint8Array);
          until = new Headers(init.headers).get('x-amz-object-lock-retain-until-date')!;
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        gets++;
        return Promise.resolve(
          new Response(Buffer.from(uploaded), {
            headers: {
              'x-amz-object-lock-mode': 'COMPLIANCE',
              'x-amz-object-lock-retain-until-date': until,
            },
          }),
        );
      },
    );
    const job = new PartitionLifecycleJob(
      worker.wenv,
      worker.prisma,
      worker.tenantDb,
      worker.audit,
      worker.job,
      worm,
    );
    try {
      await job.archive(partition, tenant.tenantId, undefined);
      const lines = gunzipSync(uploaded)
        .toString()
        .split('\n')
        .map((line) => JSON.parse(line) as { seq: string; hash: string; actorDetails: unknown });
      expect(lines.map((line) => line.seq)).toEqual(source.map((row) => row.seq.toString()));
      expect(lines.map((line) => line.hash)).toEqual(source.map((row) => row.hash));
      expect(lines.map((line) => line.actorDetails)).toEqual(source.map((row) => row.actor));
      const registry = await owner.auditArchive.findMany({
        where: { tenantId: tenant.tenantId },
        orderBy: { status: 'asc' },
      });
      expect(registry.map((row) => row.status)).toEqual(['uploaded', 'verified']);
      for (const row of registry)
        expect(row).toMatchObject({
          fromSeq: source[0]!.seq,
          toSeq: source.at(-1)!.seq,
          rowCount: BigInt(source.length),
          sha256: createHash('sha256').update(uploaded).digest('hex'),
        });
      await job.archive(partition, tenant.tenantId, undefined);
      expect(puts).toBe(1);
      expect(gets).toBe(1);
      expect(await owner.auditArchive.count({ where: { tenantId: tenant.tenantId } })).toBe(2);
      expect(
        await owner.auditEvent.count({
          where: { tenantId: tenant.tenantId, action: 'audit.archive.verified' },
        }),
      ).toBe(1);
    } finally {
      await worker.prisma.client.$disconnect();
    }
  });
});

describe('automatic audit from domain events', () => {
  it('audits a domain event that no request audit covers, once', async () => {
    const tenant = await createTenant(owner, kit, uniqueSlug('audit-dom'));
    const { tenantDb, audit, prisma } = workerJob(CheckpointSigner.fromJwk(keys.signingJwk));
    const handler = new DomainEventAuditHandler(audit);
    const event = {
      id: crypto.randomUUID(),
      type: 'verbis.connectors.connector.updated.v1',
      tenantId: tenant.tenantId,
      aggregate: { type: 'Connector', id: 'k-1' },
      occurredAt: new Date().toISOString(),
      correlationId: `corr-${crypto.randomUUID()}`,
      actor: 'connector:genesys',
      payload: {},
    };
    const ctx = { requestId: 'x', correlationId: event.correlationId, ip: '', userAgent: '' };
    await requestContext.run(ctx, () =>
      tenantDb.run(tenant.tenantId, (tx) => handler.handle(event, tx)),
    );
    await requestContext.run(ctx, () =>
      tenantDb.run(tenant.tenantId, (tx) => handler.handle(event, tx)),
    );
    const rows = await owner.auditEvent.findMany({ where: { tenantId: tenant.tenantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'connectors.connector.updated',
      actorType: 'connector',
      actorId: 'genesys',
      correlationId: event.correlationId,
    });
    await prisma.client.$disconnect();
  });
});

describe('runtime session event stream', () => {
  it('chains agent input per session, detects tampering, and anchors the sealed head in the audit chain', async () => {
    const tenant = await createTenant(owner, kit, uniqueSlug('audit-sess'));
    const auth = await tenant.auth();
    const script = (
      await app.inject({
        method: 'POST',
        url: '/v1/scripts',
        headers: { ...json, ...auth },
        payload: { name: 'S' },
      })
    ).json<{ id: string }>();
    const version = (
      await app.inject({
        method: 'POST',
        url: `/v1/scripts/${script.id}/versions`,
        headers: { ...json, ...auth },
        payload: { document: surveyScript },
      })
    ).json<{ id: string; checksum: string }>();
    const session = await owner.session.create({
      data: {
        kind: 'preview',
        tenantId: tenant.tenantId,
        userId: tenant.adminId,
        scriptVersionId: version.id,
        state: 'active',
        checksum: version.checksum,
        createdBy: 't',
        updatedBy: 't',
      },
    });
    const writer = app.get(SessionEventWriter);
    const tenantDb = app.get(TenantDb);
    const ctx = {
      requestId: 'r',
      correlationId: 'c',
      ip: '',
      userAgent: '',
      principal: {
        type: 'user' as const,
        id: tenant.adminId,
        tenantId: tenant.tenantId,
        scopes: [],
      },
    };
    await requestContext.run(ctx, () =>
      tenantDb.run(tenant.tenantId, (tx) =>
        writer.append(tx, [
          { sessionId: session.id, type: 'page.entered', pageId: 'p-1' },
          {
            sessionId: session.id,
            type: 'field.changed',
            pageId: 'p-1',
            payload: { field: 'nps', value: 9 },
          },
          {
            sessionId: session.id,
            type: 'field.changed',
            pageId: 'p-1',
            payload: { field: 'email', email: 'x@y.z' },
          },
        ]),
      ),
    );
    const sealed = await requestContext.run(ctx, () =>
      tenantDb.run(tenant.tenantId, (tx) => writer.seal(tx, session.id)),
    );
    const rows = await owner.sessionEvent.findMany({
      where: { sessionId: session.id },
      orderBy: { seq: 'asc' },
    });
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(rows[2]?.payload).toMatchObject({ email: '[REDACTED]' });
    expect(verifySessionChain(session.id, rows, sealed)).toMatchObject({ valid: true });
    const anchor = await owner.auditEvent.findFirst({
      where: { tenantId: tenant.tenantId, action: 'runtime.session.sealed' },
    });
    expect(anchor?.metadata).toEqual({ seq: 3, hash: sealed.hash });
    await expect(
      requestContext.run(ctx, () =>
        tenantDb.run(tenant.tenantId, (tx) =>
          writer.append(tx, [{ sessionId: session.id, type: 'page.entered' }]),
        ),
      ),
    ).rejects.toThrow(/sealed/);

    await tamper(
      `UPDATE session_events SET payload = '{"field":"nps","value":1}' WHERE session_id = $1 AND seq = 2`,
      session.id,
    );
    const tampered = await owner.sessionEvent.findMany({
      where: { sessionId: session.id },
      orderBy: { seq: 'asc' },
    });
    expect(verifySessionChain(session.id, tampered, sealed).breaks[0]).toMatchObject({
      kind: 'hash_mismatch',
      seq: '2',
    });
  });
});

describe('SIEM delivery', () => {
  it('delivers in order, retries a failing sink without skipping, and records status', async () => {
    const tenant = await createTenant(owner, kit, uniqueSlug('audit-siem'));
    const auth = await tenant.auth();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/siem-destinations',
      headers: { ...json, ...auth },
      payload: { kind: 'kafka', name: 'kafka-main', config: { topic: 'verbis.audit' } },
    });
    expect(created.statusCode).toBe(201);
    const destinationId = created.json<{ id: string }>().id;
    for (let i = 0; i < 3; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/v1/campaigns',
        headers: { ...json, ...auth },
        payload: { name: `S${String(i)}` },
      });
    }
    const sent: string[] = [];
    let failNext = true;
    const producer: KafkaProducer = {
      send: (record) => {
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error('broker unavailable'));
        }
        sent.push(...record.messages.map((m) => m.headers['seq'] ?? ''));
        return Promise.resolve();
      },
      disconnect: () => Promise.resolve(),
    };
    const wenv = workerTestEnv(env);
    const prisma = new PrismaService(wenv);
    const tenantDb = new TenantDb(prisma);
    const dispatcher = new SiemDispatcher(
      wenv,
      prisma,
      tenantDb,
      new AuditRepository(),
      new AuditService(new OutboxWriter()),
      new EnvSecretResolver({}),
      producer,
    );
    expect(await dispatcher.deliverOne(tenant.tenantId, destinationId)).toBe('failed');
    const cursor = await owner.siemCursor.findUniqueOrThrow({ where: { destinationId } });
    expect(cursor.attempts).toBe(1);
    expect(cursor.lastError).toContain('broker unavailable');
    await owner.siemCursor.update({
      where: { destinationId },
      data: { nextAttemptAt: new Date(0) },
    });
    expect(await dispatcher.deliverOne(tenant.tenantId, destinationId)).toBe('delivered');
    const seqs = sent.map(Number);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(seqs[0]).toBe(
      Number((await owner.siemCursor.findUniqueOrThrow({ where: { destinationId } })).lastSeq) -
        seqs.length +
        1,
    );
    const actions = (
      await owner.auditEvent.findMany({
        where: { tenantId: tenant.tenantId },
        select: { action: true },
      })
    ).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'audit.siemDestination.created',
        'audit.siemDelivery.failed',
        'audit.siemDelivery.recovered',
      ]),
    );
    await prisma.client.$disconnect();
  });
});
