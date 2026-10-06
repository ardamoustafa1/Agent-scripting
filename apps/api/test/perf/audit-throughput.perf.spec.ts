import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { requestContext } from '../../src/common/context/request-context.js';
import { PrismaService } from '../../src/infra/database/prisma.service.js';
import { TenantDb } from '../../src/infra/database/tenant-db.js';
import { OutboxWriter } from '../../src/infra/outbox/outbox.writer.js';
import { AuditRepository } from '../../src/modules/audit/audit.repository.js';
import { AuditService, type AuditInput } from '../../src/modules/audit/audit.service.js';
import { ChainVerifier, GENESIS_ANCHOR } from '../../src/modules/audit/core/chain-verifier.js';
import {
  createTenant,
  integrationEnv,
  ownerPrisma,
  uniqueSlug,
  type TenantFixture,
} from '../integration/helpers.js';
import { createTokenKit } from '../support/tokens.js';

import type { PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * Write-throughput gate (ADR-0014): ≥ 10,000 audit events/s, sustained, through the real writer
 * (validation, PII masking, hashing, chain-head row lock, unnest insert, RLS, partitions) as the
 * least-privilege runtime role. Batched (as the worker and bulk paths write); 8 tenants in
 * parallel because each tenant's chain is serialized by design.
 */
const TENANTS = 8;
const EVENTS_PER_TENANT = 12_500; // 100k events total
const BATCH = 500;
const TARGET_PER_SECOND = 10_000;

let owner: PrismaClient;
let prisma: PrismaService;
let tenantDb: TenantDb;
let audit: AuditService;
let tenants: TenantFixture[];

beforeAll(async () => {
  const kit = await createTokenKit();
  owner = ownerPrisma();
  const env = integrationEnv(kit.jwks, { DATABASE_APP_URL: inject('pgAppUrl') });
  prisma = new PrismaService(env);
  tenantDb = new TenantDb(prisma);
  audit = new AuditService(new OutboxWriter());
  tenants = await Promise.all(
    Array.from({ length: TENANTS }, () => createTenant(owner, kit, uniqueSlug('perf'))),
  );
});

afterAll(async () => {
  await prisma.client.$disconnect();
  await owner.$disconnect();
});

function batch(tenant: TenantFixture, offset: number): AuditInput[] {
  return Array.from({ length: BATCH }, (_v, i) => ({
    action: 'runtime.field.changed',
    target: { type: 'Session', id: `s-${String((offset + i) % 997)}`, name: null },
    actor: { type: 'user' as const, id: tenant.adminId, ip: '198.51.100.7', sessionId: 'sess' },
    before: { value: offset + i, email: 'redact@me.test' },
    after: { value: offset + i + 1, email: 'redact@me.test' },
    diffMode: 'patch' as const,
    metadata: { page: 'p-1', field: 'nps' },
  }));
}

async function writeTenant(tenant: TenantFixture): Promise<void> {
  const ctx = {
    requestId: 'perf',
    correlationId: `perf-${tenant.tenantId}`,
    ip: '',
    userAgent: 'perf',
  };
  for (let offset = 0; offset < EVENTS_PER_TENANT; offset += BATCH) {
    await requestContext.run(ctx, () =>
      tenantDb.run(tenant.tenantId, (tx) =>
        audit.recordMany(tx, batch(tenant, offset), { tenantId: tenant.tenantId }),
      ),
    );
  }
}

describe('audit write throughput', () => {
  it(`sustains ≥ ${String(TARGET_PER_SECOND)} events/s and the result is a valid chain`, async () => {
    // Warm-up (connections, plans, partitions) outside the measurement.
    await writeTenant({ ...tenants[0]!, tenantId: tenants[0]!.tenantId });
    const started = performance.now();
    await Promise.all(tenants.map((tenant) => writeTenant(tenant)));
    const seconds = (performance.now() - started) / 1000;
    const total = TENANTS * EVENTS_PER_TENANT;
    const rate = total / seconds;
    process.stdout.write(
      `[perf] ${String(total)} audit events in ${seconds.toFixed(2)}s = ${rate.toFixed(0)} events/s\n`,
    );
    expect(rate).toBeGreaterThanOrEqual(TARGET_PER_SECOND);

    // Nothing lost, no gaps, every hash intact — for each tenant.
    const repository = new AuditRepository();
    for (const tenant of tenants) {
      const expected = BigInt(EVENTS_PER_TENANT * (tenant === tenants[0] ? 2 : 1));
      const verifier = new ChainVerifier(tenant.tenantId, GENESIS_ANCHOR);
      let after = 0n;
      await requestContext.run({ requestId: 'v', correlationId: 'v', ip: '', userAgent: '' }, () =>
        tenantDb.run(
          tenant.tenantId,
          async (tx) => {
            for (;;) {
              const rows = await repository.range(tx, tenant.tenantId, after, undefined, 10_000);
              if (rows.length === 0) break;
              verifier.push(rows);
              after = rows[rows.length - 1]!.seq;
            }
          },
          { timeoutMs: 120_000 },
        ),
      );
      expect(verifier.result(expected)).toMatchObject({ valid: true, checked: Number(expected) });
    }
  });

  it('serializes concurrent writers of one tenant without gaps or forks', async () => {
    const tenant = tenants[1]!;
    const before = await owner.auditChainHead.findUniqueOrThrow({
      where: { tenantId: tenant.tenantId },
    });
    const ctx = { requestId: 'c', correlationId: 'c', ip: '', userAgent: '' };
    await Promise.all(
      Array.from({ length: 20 }, (_v, i) =>
        requestContext.run(ctx, () =>
          tenantDb.run(tenant.tenantId, (tx) =>
            audit.recordMany(tx, batch(tenant, i * BATCH).slice(0, 50), {
              tenantId: tenant.tenantId,
            }),
          ),
        ),
      ),
    );
    const after = await owner.auditChainHead.findUniqueOrThrow({
      where: { tenantId: tenant.tenantId },
    });
    expect(after.seq - before.seq).toBe(1000n);
    const dupes = await owner.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM (SELECT prev_hash FROM audit_events WHERE tenant_id = ${tenant.tenantId}::uuid GROUP BY prev_hash HAVING count(*) > 1) d`;
    expect(Number(dupes[0]?.n ?? 0)).toBe(0);
  });
});
