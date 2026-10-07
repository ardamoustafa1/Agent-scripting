import { Writable } from 'node:stream';

import { Redis } from 'ioredis';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';

import { createAbility } from '@verbis/authz';
import { DataSourceRefSchema, ScriptDocumentSchema } from '@verbis/script-schema';
import { surveyScript } from '@verbis/script-schema/fixtures';

import { createApp } from '../../src/bootstrap.js';
import { requestContext } from '../../src/common/context/request-context.js';
import { uuidv7 } from '../../src/common/crypto/uuid.js';
import { createLoggerOptions } from '../../src/common/logging/logger.js';
import { TenantDb } from '../../src/infra/database/tenant-db.js';
import { NatsService } from '../../src/infra/nats/nats.service.js';
import { OutboxRelayService } from '../../src/infra/outbox/outbox-relay.service.js';
import { EventEnvelopeSchema } from '../../src/infra/outbox/outbox.types.js';
import { RedisService } from '../../src/infra/redis/redis.service.js';
import { AnalyticsSessionConsumer } from '../../src/modules/analytics/session.consumer.js';
import { recomputeHash } from '../../src/modules/audit/core/audit-event.js';
import { DefinitionSchema, PolicySchema } from '../../src/modules/integrations/engine/contracts.js';
import { IntegrationEngineService } from '../../src/modules/integrations/integration-engine.service.js';
import { AgentDesktopController } from '../../src/modules/runtime/agent-desktop.controller.js';
import { RuntimeEngineService } from '../../src/modules/runtime/runtime-engine.service.js';
import { RuntimePorts } from '../../src/modules/runtime/runtime-ports.js';
import { RuntimeStateStore } from '../../src/modules/runtime/runtime-state.store.js';
import { SecureCaptureService } from '../../src/modules/runtime/secure-capture.service.js';
import { startApiProcess, type ApiProcess } from '../support/api-process.js';
import { assertNoPciCanary, scanPciStores } from '../support/pci-canary.js';
import { createTokenKit, type TokenKit } from '../support/tokens.js';

import {
  createTenant,
  integrationEnv,
  ownerPrisma,
  startApp,
  uniqueSlug,
  type TenantFixture,
} from './helpers.js';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

let owner: PrismaClient, app: NestFastifyApplication, kit: TokenKit;
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
beforeAll(async () => {
  kit = await createTokenKit();
  owner = ownerPrisma();
  app = await startApp(integrationEnv(kit.jwks));
});
afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});
async function fixture(pci = false, testApp = app) {
  const tenant = await createTenant(owner, kit, uniqueSlug('runtime'));
  const headers = { 'content-type': 'application/json', ...(await tenant.auth()) };
  const scriptResult = await testApp.inject({
    method: 'POST',
    url: '/v1/scripts',
    headers,
    payload: { name: 'Runtime fixture' },
  });
  expect(scriptResult.statusCode).toBe(201);
  const script = scriptResult.json<{ id: string }>();
  const versionResult = await testApp.inject({
    method: 'POST',
    url: `/v1/scripts/${script.id}/versions`,
    headers,
    payload: {
      document: {
        ...surveyScript,
        variables: [
          ...(surveyScript.variables ?? []),
          ...(pci
            ? [{ key: 'pciCanary', type: 'string', scope: 'session', classification: 'pci' }]
            : []),
          { key: 'runtimeCounter', type: 'number', scope: 'session', persist: true },
          {
            key: 'runtimeCustomer',
            type: 'string',
            scope: 'session',
            persist: true,
            classification: 'pii',
          },
        ],
      },
    },
  });
  expect(versionResult.statusCode).toBe(201);
  const version = versionResult.json<{ id: string; checksum: string }>();
  // Test fixture simulates the secure launch creator, never a public session-create endpoint.
  const session = await owner.session.create({
    data: {
      kind: 'preview',
      tenantId: tenant.tenantId,
      userId: tenant.adminId,
      scriptVersionId: version.id,
      checksum: version.checksum,
      createdBy: 'fixture',
      updatedBy: 'fixture',
    },
  });
  const bffId = uuidv7(),
    tabId = uuidv7(),
    engine = testApp.get(RuntimeEngineService);
  async function run<T>(
    fn: () => Promise<T>,
    overrideTenant: TenantFixture = tenant,
    instance: NestFastifyApplication = testApp,
    ownTransactions = false,
  ) {
    const rules = [{ action: 'manage' as const, subject: 'all' as const }];
    return requestContext.run(
      {
        requestId: uuidv7(),
        correlationId: uuidv7(),
        ip: '',
        userAgent: 'fixture',
        principal: {
          type: 'user',
          authMethod: 'sso',
          tenantId: overrideTenant.tenantId,
          id: overrideTenant.adminId,
          sessionId: bffId,
          scopes: [],
        },
        authz: {
          ability: createAbility(rules),
          rules,
          roles: ['tenant_admin'],
          separationOfDuties: true,
        },
      },
      () =>
        ownTransactions
          ? fn()
          : instance.get(TenantDb).run(overrideTenant.tenantId, async (tx) => {
              requestContext.require().tx = tx;
              return fn();
            }),
    );
  }
  await run(() => engine.initialize(session.id));
  const lease = await run(() => engine.attach(session.id, { tabId }));
  if (lease.writeToken === undefined) throw new Error('Fixture lease missing');
  const claim = { tabId, writeToken: lease.writeToken };
  await run(() =>
    engine.command(session.id, {
      ...claim,
      expectedSequence: 1,
      command: { type: 'transition', state: 'active' },
    }),
  );
  return { tenant, session, engine, run, claim, bffId };
}
async function verifyFieldAudits(
  tenantId: string,
  sessionId: string,
  count: number,
  synthetic = '',
) {
  const writes = await owner.auditEvent.findMany({
    where: {
      tenantId,
      targetId: sessionId,
      action: 'runtime.session.fieldchanged',
      outcome: 'success',
    },
  });
  expect(writes).toHaveLength(count);
  if (synthetic)
    expect(
      JSON.stringify(writes, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    ).not.toContain(synthetic);
  for (const row of writes) expect(recomputeHash(row)).toBe(row.hash);
}
describe('runtime PostgreSQL / Redis boundaries', () => {
  it('recovers an acknowledged durable field on a fresh API instance after losing the hot cache', async () => {
    const f = await fixture();
    await f.run(() =>
      f.engine.command(f.session.id, {
        ...f.claim,
        expectedSequence: 2,
        command: { type: 'field', variable: 'runtimeCounter', value: 42 },
      }),
    );
    const slot = app.get(RuntimeStateStore).slot(f.tenant.tenantId, f.session.id);
    await app.get(RedisService).client.del(slot);
    const peer = await startApp(integrationEnv(kit.jwks));
    try {
      const recovered = await f.run(
        () => peer.get(RuntimeEngineService).view(f.session.id),
        f.tenant,
        peer,
      );
      expect(recovered).toMatchObject({
        sequence: 3,
        state: 'active',
        snapshot: { variables: { runtimeCounter: 42 } },
      });
      expect(await owner.sessionEvent.count({ where: { sessionId: f.session.id, seq: 3 } })).toBe(
        1,
      );
      expect(await owner.session.findUniqueOrThrow({ where: { id: f.session.id } })).toMatchObject({
        sequence: 3,
      });
    } finally {
      await peer.close();
    }
  });
  it.each([false, true])(
    'recovers HTTP-acknowledged encrypted state after SIGKILL (hot cache evicted=%s)',
    async (evictCache) => {
      const f = await fixture();
      const token = await kit.sign({ sub: f.tenant.adminId, tnt: f.tenant.tenantId, sid: f.bffId });
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      const path = `/v1/sessions/${f.session.id}`;
      const synthetic = 'Synthetic process recovery customer';
      let processApi: ApiProcess | undefined;
      const call = async (method: string, suffix: string, payload?: unknown, auth = headers) => {
        if (!processApi) throw new Error('API child missing');
        const response = await fetch(`${processApi.origin}${path}${suffix}`, {
          method,
          headers: auth,
          ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
          signal: AbortSignal.timeout(10_000),
        });
        return { status: response.status, body: await response.json() };
      };
      try {
        processApi = await startApiProcess(integrationEnv(kit.jwks));
        const firstPid = processApi.pid;
        expect(firstPid).not.toBe(process.pid);
        const counterAck = await call('POST', '/commands', {
          ...f.claim,
          expectedSequence: 2,
          command: { type: 'field', variable: 'runtimeCounter', value: 42 },
        });
        expect(counterAck.status).toBe(201);
        expect(counterAck.body).toMatchObject({ sequence: 3 });
        const piiAck = await call('POST', '/commands', {
          ...f.claim,
          expectedSequence: 3,
          command: { type: 'field', variable: 'runtimeCustomer', value: synthetic },
        });
        expect(piiAck.status).toBe(201);
        expect(piiAck.body).toMatchObject({ sequence: 4 });
        expect(await processApi.kill()).toBe('SIGKILL'); // Actual SIGKILL; no graceful app.close or shutdown flush.
        if (evictCache) {
          const slot = app.get(RuntimeStateStore).slot(f.tenant.tenantId, f.session.id);
          await app.get(RedisService).client.del(slot);
        }
        processApi = await startApiProcess(integrationEnv(kit.jwks));
        expect(processApi.pid).not.toBe(firstPid);
        const recovered = await call('GET', '/state');
        expect(recovered.status).toBe(200);
        expect(recovered.body).toMatchObject({
          sequence: 4,
          state: 'active',
          snapshot: { variables: { runtimeCounter: 42, runtimeCustomer: synthetic } },
        });
        const lease = await call('POST', '/attach', f.claim);
        expect(lease.status).toBe(201);
        expect(lease.body).toMatchObject({ readOnly: false, writeToken: f.claim.writeToken });
        const stale = await call('POST', '/commands', {
          ...f.claim,
          expectedSequence: 2,
          command: { type: 'field', variable: 'runtimeCounter', value: 99 },
        });
        expect(stale.status).toBe(412);
        const next = await call('POST', '/commands', {
          ...f.claim,
          expectedSequence: 4,
          command: { type: 'field', variable: 'runtimeCounter', value: 43 },
        });
        expect(next.status).toBe(201);
        expect(next.body).toMatchObject({
          sequence: 5,
          snapshot: { variables: { runtimeCounter: 43 } },
        });
        const other = await createTenant(owner, kit, uniqueSlug('process-other'));
        const denied = await call('GET', '/state', undefined, {
          ...headers,
          authorization: `Bearer ${await other.token()}`,
        });
        expect([403, 404]).toContain(denied.status);
        const row = await owner.session.findUniqueOrThrow({ where: { id: f.session.id } });
        expect(row.sequence).toBe(5);
        expect(JSON.stringify(row.variables)).not.toContain(synthetic);
        const events = await owner.sessionEvent.findMany({
          where: { sessionId: row.id },
          orderBy: { seq: 'asc' },
        });
        expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
        expect(JSON.stringify(events)).not.toContain(synthetic);
        const outbox = await owner.outboxEvent.findMany({
          where: {
            tenantId: f.tenant.tenantId,
            aggregateId: row.id,
            eventType: 'verbis.runtime.session.changed.v1',
          },
        });
        expect(outbox).toHaveLength(5);
        await verifyFieldAudits(f.tenant.tenantId, f.session.id, 3, synthetic);
        expect(JSON.stringify(outbox)).not.toContain(synthetic);
      } finally {
        await processApi?.kill();
      }
    },
  );
  it('fences racing HTTP commands from two independent API processes to one durable winner', async () => {
    const f = await fixture();
    const token = await kit.sign({ sub: f.tenant.adminId, tnt: f.tenant.tenantId, sid: f.bffId });
    const children: ApiProcess[] = [];
    try {
      children.push(await startApiProcess(integrationEnv(kit.jwks)));
      children.push(await startApiProcess(integrationEnv(kit.jwks)));
      expect(new Set(children.map((child) => child.pid)).size).toBe(2);
      expect(children.every((child) => child.pid !== process.pid)).toBe(true);
      const results = await Promise.all(
        children.map(async (child, index) => {
          const value = index + 21;
          const response = await fetch(`${child.origin}/v1/sessions/${f.session.id}/commands`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              ...f.claim,
              expectedSequence: 2,
              command: { type: 'field', variable: 'runtimeCounter', value },
            }),
            signal: AbortSignal.timeout(10_000),
          });
          return { status: response.status, value, body: await response.json() };
        }),
      );
      expect(results.map((result) => result.status).sort()).toEqual([201, 412]);
      const winner = results.find((result) => result.status === 201);
      expect(winner).toBeDefined();
      expect(winner?.body).toMatchObject({
        sequence: 3,
        snapshot: { variables: { runtimeCounter: winner?.value } },
      });
      await Promise.all(children.map((child) => child.kill()));
      const slot = app.get(RuntimeStateStore).slot(f.tenant.tenantId, f.session.id);
      await app.get(RedisService).client.del(slot);
      const durable = await f.run(() => f.engine.view(f.session.id));
      expect(durable.sequence).toBe(3);
      expect(durable.snapshot.variables['runtimeCounter']).toBe(winner?.value);
      await verifyFieldAudits(f.tenant.tenantId, f.session.id, 1);
      expect(await owner.sessionEvent.count({ where: { sessionId: f.session.id, seq: 3 } })).toBe(
        1,
      );
      expect(
        await owner.outboxEvent.count({
          where: {
            tenantId: f.tenant.tenantId,
            aggregateId: f.session.id,
            eventType: 'verbis.runtime.session.changed.v1',
          },
        }),
      ).toBe(3);
    } finally {
      await Promise.all(children.map((child) => child.kill()));
    }
  });
  it('serializes racing writes and appends only one event for the winning sequence', async () => {
    const f = await fixture();
    const results = await Promise.allSettled(
      [1, 2].map((value) =>
        f.run(() =>
          f.engine.command(f.session.id, {
            ...f.claim,
            expectedSequence: 2,
            command: { type: 'field', variable: 'runtimeCounter', value },
          }),
        ),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const row = await owner.session.findUniqueOrThrow({ where: { id: f.session.id } });
    expect(row.sequence).toBe(3);
    expect(await owner.sessionEvent.count({ where: { sessionId: row.id, seq: 3 } })).toBe(1);
    expect(
      await owner.outboxEvent.count({
        where: {
          tenantId: f.tenant.tenantId,
          aggregateId: row.id,
          eventType: 'verbis.runtime.session.changed.v1',
        },
      }),
    ).toBe(3);
  });
  it('makes the second tab read-only and fences writes from that tab', async () => {
    const f = await fixture(),
      secondTab = uuidv7();
    const lease = await f.run(() => f.engine.attach(f.session.id, { tabId: secondTab }));
    expect(lease.readOnly).toBe(true);
    expect(lease.writeToken).toBeUndefined();
    await expect(
      f.run(() =>
        f.engine.command(f.session.id, {
          ...f.claim,
          tabId: secondTab,
          expectedSequence: 2,
          command: { type: 'field', variable: 'runtimeCounter', value: 9 },
        }),
      ),
    ).rejects.toThrow();
  });
  it('takes over an owned writer lease, fences the former writer and audits takeover/release', async () => {
    const f = await fixture();
    const tabId = uuidv7();
    const lease = await f.run(() => f.engine.attach(f.session.id, { tabId }, true));
    expect(lease.readOnly).toBe(false);
    expect(lease.writeToken).toBeDefined();
    await expect(
      f.run(() =>
        f.engine.command(f.session.id, {
          ...f.claim,
          expectedSequence: 2,
          command: { type: 'field', variable: 'runtimeCounter', value: 99 },
        }),
      ),
    ).rejects.toThrow();
    await expect(f.run(() => f.engine.release(f.session.id, f.claim))).rejects.toThrow();
    const claim = { tabId, writeToken: lease.writeToken! };
    await f.run(() =>
      f.engine.command(f.session.id, {
        ...claim,
        expectedSequence: 2,
        command: { type: 'field', variable: 'runtimeCounter', value: 10 },
      }),
    );
    await f.run(() => f.engine.release(f.session.id, claim));
    const next = await f.run(() => f.engine.attach(f.session.id, { tabId: uuidv7() }));
    expect(next.readOnly).toBe(false);
    const audits = await owner.auditEvent.findMany({
      where: {
        targetId: f.session.id,
        action: { in: ['runtime.session.writerTakenOver', 'runtime.session.writerReleased'] },
      },
      select: { action: true, metadata: true },
    });
    expect(audits.map((audit) => audit.action).sort()).toEqual([
      'runtime.session.writerReleased',
      'runtime.session.writerTakenOver',
    ]);
    expect(JSON.stringify(audits)).not.toContain(lease.writeToken);
    await expect(
      f.run(
        () => f.engine.attach(f.session.id, { tabId }, true),
        await createTenant(owner, kit, uniqueSlug('foreign-takeover')),
      ),
    ).rejects.toThrow();
  });
  it('encrypts PII snapshots and redacts event/outbox values', async () => {
    const f = await fixture(),
      synthetic = 'Synthetic runtime customer';
    await f.run(() =>
      f.engine.command(f.session.id, {
        ...f.claim,
        expectedSequence: 2,
        command: { type: 'field', variable: 'runtimeCustomer', value: synthetic },
      }),
    );
    const row = await owner.session.findUniqueOrThrow({ where: { id: f.session.id } });
    expect(JSON.stringify(row.variables)).not.toContain(synthetic);
    const events = await owner.sessionEvent.findMany({ where: { sessionId: row.id } });
    expect(JSON.stringify(events)).not.toContain(synthetic);
    expect(JSON.stringify(events)).toContain('[REDACTED]');
    const outbox = await owner.outboxEvent.findMany({
      where: { tenantId: f.tenant.tenantId, aggregateId: row.id },
    });
    expect(JSON.stringify(outbox)).not.toContain(synthetic);
    const recovered = await f.run(() => f.engine.view(row.id));
    expect(recovered.snapshot.variables['runtimeCustomer']).toBe(synthetic);
    const observed = await f.run(() => f.engine.view(row.id, true));
    expect(observed.readOnly).toBe(true);
    expect(observed.snapshot.variables['runtimeCustomer']).toBe('[REDACTED]');
  });
  it('rejects cross-tenant session access even with an unrestricted role', async () => {
    const f = await fixture(),
      other = await createTenant(owner, kit, uniqueSlug('runtime-other'));
    await expect(f.run(() => f.engine.view(f.session.id), other)).rejects.toThrow('not found');
  });
  it('rolls events and audit back with a failed command transaction', async () => {
    const f = await fixture();
    await expect(
      f.run(async () => {
        await f.engine.command(f.session.id, {
          ...f.claim,
          expectedSequence: 2,
          command: { type: 'field', variable: 'runtimeCounter', value: 8 },
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect((await owner.session.findUniqueOrThrow({ where: { id: f.session.id } })).sequence).toBe(
      2,
    );
    expect(await owner.sessionEvent.count({ where: { sessionId: f.session.id, seq: 3 } })).toBe(0);
    expect(
      (await f.run(() => f.engine.view(f.session.id))).snapshot.variables['runtimeCounter'],
    ).toBeUndefined();
  });
});

it('allows a concurrent writer during slow upstream I/O and rejects the fenced late result', async () => {
  const f = await fixture();
  const row = await owner.session.findUniqueOrThrow({
    where: { id: f.session.id },
    include: { scriptVersion: true },
  });
  const document = ScriptDocumentSchema.parse(row.scriptVersion.document);
  document.dataSources.push(
    DataSourceRefSchema.parse({ id: 'lookup', ref: 'tenant-datasource:lookup', version: 1 }),
  );
  await owner.scriptVersion.update({
    where: { id: row.scriptVersionId },
    data: { document: JSON.parse(JSON.stringify(document)) as Record<string, never> },
  });
  await owner.session.update({
    where: { id: row.id },
    data: { decisionTrace: { preview: true, liveDataSources: true } },
  });
  await owner.dataSource.create({
    data: {
      tenantId: f.tenant.tenantId,
      key: 'lookup',
      protocol: 'rest',
      definition: JSON.parse(
        JSON.stringify(
          DefinitionSchema.parse({ baseUrl: 'https://service.test', endpoint: '/lookup' }),
        ),
      ) as Record<string, never>,
      policy: JSON.parse(
        JSON.stringify(PolicySchema.parse({ allowedOrigins: ['https://service.test'] })),
      ) as Record<string, never>,
      secretRefs: [],
      createdBy: 'fixture',
      updatedBy: 'fixture',
    },
  });
  const integration = app.get(IntegrationEngineService);
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const spy = vi.spyOn(integration.executor, 'execute').mockImplementationOnce(async () => {
    expect(requestContext.require().tx).toBeUndefined();
    signalStarted();
    await waiting;
    return {
      value: { ok: true },
      trace: {
        request: null,
        response: null,
        mapped: null,
        durationMs: 250,
        cached: false,
        mock: false,
        error: null,
      },
    };
  });
  const pending = f.run(
    () =>
      app
        .get(AgentDesktopController)
        .call(row.id, { ...f.claim, expectedSequence: 2, sourceId: 'lookup', input: {} }),
    f.tenant,
    app,
    true,
  );
  const rejection = expect(pending).rejects.toMatchObject({
    code: 'VERBIS_CONCURRENCY_VERSION_MISMATCH',
  });
  try {
    await started;
    await f.run(async () => {
      await app.get(TenantDb).current().$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
      return f.engine.command(row.id, {
        ...f.claim,
        expectedSequence: 2,
        command: { type: 'field', variable: 'runtimeCounter', value: 7 },
      });
    });
  } finally {
    finish();
  }
  try {
    await rejection;
  } finally {
    spy.mockRestore();
  }
  const current = await owner.session.findUniqueOrThrow({ where: { id: row.id } });
  expect(current.sequence).toBe(3);
  expect(
    await owner.sessionEvent.count({ where: { sessionId: row.id, type: 'datasource.called' } }),
  ).toBe(0);
  expect(
    await owner.auditEvent.count({
      where: { tenantId: f.tenant.tenantId, action: 'integration.datasource.executed' },
    }),
  ).toBe(1);
});

it('PCI canary: signed hosted capture and rejected raw PAN leave no PAN in SQL, decrypted state, Redis, NATS, analytics or logs', async () => {
  const pan = '4111111111111111'; // Public synthetic card; the isolated PSP fixture owns the raw value.
  let logs = '';
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs += chunk.toString();
      done();
    },
  });
  const env = integrationEnv(kit.jwks, {
    ANALYTICS_ENABLED: 'true',
    ANALYTICS_PSEUDONYM_KEY: Buffer.alloc(32, 7).toString('base64'),
  });
  const canaryApp = await createApp(env, { logger: pino(createLoggerOptions('info'), stream) });
  const redis = new Redis(inject('redisUrl'));
  await canaryApp.init();
  await canaryApp.getHttpAdapter().getInstance().ready();
  try {
    const f = await fixture(true, canaryApp);
    const interaction = await owner.interaction.create({
      data: {
        tenantId: f.tenant.tenantId,
        externalId: uuidv7(),
        channelType: 'voice',
        direction: 'inbound',
        startedAt: new Date(),
        createdBy: 'fixture',
        updatedBy: 'fixture',
      },
    });
    await owner.session.update({
      where: { id: f.session.id },
      data: { kind: 'interaction', interactionId: interaction.id },
    });
    const keys = await generateKeyPair('ES256'),
      jwk = await exportJWK(keys.publicKey);
    const provider = new SecureCaptureService(
      {
        ...env,
        PSP_TENANT_PROFILES: JSON.stringify([
          {
            tenantId: f.tenant.tenantId,
            url: 'https://psp.canary.test/capture',
            issuer: 'https://psp.canary.test',
            jwks: { keys: [jwk] },
          },
        ]),
      },
      canaryApp.get(RedisService),
      canaryApp.get(RuntimePorts),
    );
    provider.onModuleInit();
    const headers = {
      authorization: `Bearer ${await kit.sign({ sub: f.tenant.adminId, tnt: f.tenant.tenantId, sid: f.bffId })}`,
      'idempotency-key': 'pci-canary-capture',
    };
    const call = (receipt: string) =>
      canaryApp.inject({
        method: 'POST',
        url: `/v1/sessions/${f.session.id}/secure-field`,
        headers,
        payload: { ...f.claim, expectedSequence: 2, variable: 'pciCanary', receipt },
      });
    const denied = await call(pan);
    expect(denied.statusCode, denied.body).toBe(400);
    assertNoPciCanary(denied.body, pan);
    const hostedProvider = async (input: string) => {
      expect(input).toBe(pan);
      return new SignJWT({
        tenantId: f.tenant.tenantId,
        sessionId: f.session.id,
        variable: 'pciCanary',
        token: 'tok_canary_' + 'a'.repeat(32),
      })
        .setProtectedHeader({ alg: 'ES256' })
        .setIssuer('https://psp.canary.test')
        .setAudience('verbis-secure-field')
        .setJti(uuidv7())
        .setIssuedAt()
        .setExpirationTime('90s')
        .sign(keys.privateKey);
    };
    const receipt = await hostedProvider(pan),
      captured = await call(receipt);
    expect(captured.statusCode, captured.body).toBe(201);
    assertNoPciCanary(captured.body, pan);
    // Payment token is persisted; the decrypted authoritative and cache state still contain no PAN.
    const row = await owner.session.findUniqueOrThrow({ where: { id: f.session.id } }),
      store = canaryApp.get(RuntimeStateStore);
    const snapshot = await store.read(
      f.tenant.tenantId,
      row.id,
      row.sequence,
      row.variables,
      row.version,
    );
    expect(snapshot.variables['pciCanary']).toBe('tok_canary_' + 'a'.repeat(32));
    assertNoPciCanary(snapshot, pan);
    assertNoPciCanary(store.open(f.tenant.tenantId, row.id, row.variables), pan);
    const nats = canaryApp.get(NatsService);
    await nats.ensureStreams();
    const relay = canaryApp.get(OutboxRelayService);
    for (let n = 0; n < 50; n++) {
      if ((await relay.runOnce()).claimed === 0) break;
    }
    const manager = await nats.manager();
    let messages = 0,
      facts = 0;
    for (const name of ['DOMAIN', 'AUDIT', 'SECURITY', 'SESSION', 'INTERACTION', 'DLQ']) {
      const info = await manager.streams.info(name);
      for (let seq = info.state.first_seq; seq > 0 && seq <= info.state.last_seq; seq++) {
        const message = await manager.streams.getMessage(name, { seq });
        if (!message) continue;
        const text = new TextDecoder().decode(message.data);
        assertNoPciCanary(text, pan);
        messages++;
        // Streams are shared with other suites (e.g. the outbox poison-message test), so a
        // non-envelope payload is still scanned for the PAN above but not projected.
        const parsed = EventEnvelopeSchema.safeParse(safeJson(text));
        if (!parsed.success) continue;
        const event = parsed.data;
        if (
          event.tenantId === f.tenant.tenantId &&
          event.type === 'verbis.runtime.session.changed.v1'
        ) {
          await f.run(() =>
            canaryApp.get(AnalyticsSessionConsumer).handle(event, requestContext.require().tx!),
          );
          facts++;
        }
      }
    }
    expect(messages).toBeGreaterThan(0);
    expect(facts).toBeGreaterThan(0);
    expect(
      await owner.analyticsFact.count({ where: { tenantId: f.tenant.tenantId } }),
    ).toBeGreaterThan(0);
    await scanPciStores(owner, redis, pan);
    assertNoPciCanary(logs, pan);
    // Positive control: the scanner itself must fail on a formatted or encoded leak.
    expect(() => {
      assertNoPciCanary('4111 1111 1111 1111', pan);
    }).toThrow();
    expect(() => {
      assertNoPciCanary(Buffer.from(pan).toString('base64'), pan);
    }).toThrow();
  } finally {
    redis.disconnect();
    await canaryApp.close();
  }
});
