import { X509Certificate } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import pg from 'pg';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';

import { uuidv7 } from '../../src/common/crypto/uuid.js';
import { RedisService } from '../../src/infra/redis/redis.service.js';
import { sha256Base64Url } from '../../src/modules/identity/crypto/random.js';
import { generateSpCredential } from '../../src/modules/identity/saml/sp-credentials.js';
import { DefinitionSchema, PolicySchema } from '../../src/modules/integrations/engine/contracts.js';
import {
  GatewayJobSchema,
  type GatewayJob,
} from '../../src/modules/integrations/engine/gateway-contracts.js';
import { executeSql, SqlTargetSchema } from '../../src/modules/integrations/gateway/sql-driver.js';
import { IntegrationEngineService } from '../../src/modules/integrations/integration-engine.service.js';
import { PrivateEgressService } from '../../src/modules/integrations/private-egress.service.js';
import { createTokenKit } from '../support/tokens.js';

import { createTenant, integrationEnv, ownerPrisma, startApp, uniqueSlug } from './helpers.js';

const kit = await createTokenKit(),
  credential = await generateSpCredential('private-worker');
const edgeSecret = 'integration-edge-secret-32-characters';
const clientId = uuidv7();
let app: Awaited<ReturnType<typeof startApp>>,
  owner: ReturnType<typeof ownerPrisma>,
  tenant: Awaited<ReturnType<typeof createTenant>>;
beforeAll(async () => {
  owner = ownerPrisma();
  tenant = await createTenant(owner, kit, uniqueSlug('private-egress'));
  app = await startApp(
    integrationEnv(kit.jwks, {
      PRIVATE_EGRESS_ENABLED: 'true',
      MTLS_CLIENT_CERT_HEADER: 'x-client-cert',
      MTLS_PROXY_SECRET: edgeSecret,
    }),
  );
});
afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});
async function workerHeaders(client = clientId, tenantId = tenant.tenantId, bound = true) {
  const token = await kit.sign({
    typ: 'service',
    sub: `svc:${client}`,
    tnt: tenantId,
    scp: ['execute:Integration'],
    ...(bound
      ? { cnf: { 'x5t#S256': sha256Base64Url(new X509Certificate(credential.certificate).raw) } }
      : {}),
  });
  return {
    authorization: `Bearer ${token}`,
    'x-client-cert': encodeURIComponent(credential.certificate),
    'x-verbis-mtls-proxy-secret': edgeSecret,
  };
}
async function claim(client = clientId, tenantId = tenant.tenantId) {
  return app.inject({
    method: 'POST',
    url: '/v1/private-egress/jobs/claim',
    headers: await workerHeaders(client, tenantId),
    payload: {},
  });
}
async function pendingJob(): Promise<GatewayJob> {
  for (let n = 0; n < 100; n++) {
    const res = await claim();
    expect(res.statusCode, res.body).toBe(200);
    if (res.json() !== null) return GatewayJobSchema.parse(res.json());
    await delay(10);
  }
  throw new Error('No gateway job received');
}
it('saves a SQL source and runs a named parameterized read through an isolated, single-use gateway lease', async () => {
  const source = {
    key: 'sql-customer',
    protocol: 'sql' as const,
    definition: DefinitionSchema.parse({
      baseUrl: 'https://sql.invalid',
      endpoint: '/query',
      privateGateway: { clientId, target: 'crm-db' },
      sql: { queryKey: 'lookup', parameters: ['customer'] },
    }),
    policy: PolicySchema.parse({ timeoutMs: 10000, retries: 0 }),
  };
  const save = await app.inject({
    method: 'POST',
    url: '/v1/data-sources',
    headers: await tenant.auth(),
    payload: source,
  });
  expect(save.statusCode, save.body).toBe(201);
  const id = save.json<{ id: string }>().id;
  const engine = app.get(IntegrationEngineService);
  const pending = engine.executor.execute(
    tenant.tenantId,
    { ...source, id, version: 1 },
    { input: { customer: 'private-customer-input' }, environment: 'test' },
    () => Promise.reject(new Error('No API secret should be used')),
    [],
  );
  const job = await pendingJob();
  expect(job.command).toEqual({
    kind: 'sql',
    queryKey: 'lookup',
    parameters: ['private-customer-input'],
  });
  const redis = app.get(RedisService).client;
  for (const key of await redis.keys('private-egress:*')) {
    const local = key.replace(/^verbis:api:/, '');
    if ((await redis.type(local)) === 'string')
      expect(await redis.get(local)).not.toContain('private-customer-input');
  }
  const otherTenant = await createTenant(owner, kit, uniqueSlug('other-gateway'));
  expect((await claim(uuidv7())).json()).toBeNull();
  expect((await claim(clientId, otherTenant.tenantId)).json()).toBeNull();
  const complete = (headers: Record<string, string>, lease = job.lease) =>
    app.inject({
      method: 'POST',
      url: `/v1/private-egress/jobs/${job.id}/complete`,
      headers,
      payload: { lease, response: { status: 200, body: '[{"ok":true}]' } },
    });
  expect((await complete(await workerHeaders(uuidv7()))).statusCode).toBe(404);
  expect((await complete(await workerHeaders(), 'b'.repeat(64))).statusCode).toBe(403);
  expect((await complete(await workerHeaders())).statusCode).toBe(204);
  expect((await complete(await workerHeaders())).statusCode).toBe(404);
  const result = await pending;
  expect(result.value).toEqual([{ ok: true }]);
  expect(JSON.stringify(result.trace)).not.toContain('private-customer-input');
});
it('requires a certificate-bound service, rejects user callers and unsigned proxy forwarding', async () => {
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/private-egress/jobs/claim',
        headers: await tenant.auth(),
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/private-egress/jobs/claim',
        headers: await workerHeaders(clientId, tenant.tenantId, false),
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  const headers = await workerHeaders();
  delete (headers as Record<string, string>)['x-verbis-mtls-proxy-secret'];
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/private-egress/jobs/claim',
        headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(401);
});
it('uses real PostgreSQL read-only transactions, rejects mutation/row overflow and keeps injection in parameters', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'verbis-sql-'));
  try {
    const file = path.join(root, 'credentials.json');
    writeFileSync(
      file,
      JSON.stringify({ database: 'test', user: 'test', password: 'private-db-password' }),
      { mode: 0o600 },
    );
    const target = SqlTargetSchema.parse({
      kind: 'postgres',
      host: 'db.corp.test',
      allowedCidrs: ['10.0.0.0/8'],
      credentialsFile: file,
      queries: {
        lookup: { text: 'SELECT $1::text AS customer', parameterCount: 1 },
        mutation: { text: "SELECT nextval('pci_sql_canary') AS result", parameterCount: 0 },
        rows: { text: 'SELECT generate_series(1,10) AS n', parameterCount: 0, maxRows: 2 },
      },
    });
    await owner.$executeRawUnsafe('CREATE SEQUENCE pci_sql_canary');
    const dependencies = {
      resolve: () => Promise.resolve({ address: '10.1.2.3', family: 4 }),
      client: () => new pg.Client({ connectionString: inject('pgOwnerUrl') }),
    };
    const value = "' OR 1=1 --";
    const result = await executeSql(
      target,
      'lookup',
      [value],
      AbortSignal.timeout(5000),
      5000,
      10000,
      dependencies,
    );
    expect(JSON.parse(result.body)).toEqual([{ customer: value }]);
    await expect(
      executeSql(target, 'mutation', [], AbortSignal.timeout(5000), 5000, 10000, dependencies),
    ).rejects.toThrow('SQL_EXECUTION_FAILED');
    await expect(
      executeSql(target, 'rows', [], AbortSignal.timeout(5000), 5000, 10000, dependencies),
    ).rejects.toThrow('SQL_ROW_LIMIT');
    await expect(
      executeSql(target, 'unknown', [], AbortSignal.timeout(5000), 5000, 10000, dependencies),
    ).rejects.toThrow('SQL_QUERY_DENIED');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('expires jobs, limits completion bytes and cleans up cancellation without replay storage', async () => {
  const broker = app.get(PrivateEgressService);
  const pending = broker
    .dispatch(
      tenant.tenantId,
      clientId,
      'crm',
      { kind: 'sql', queryKey: 'lookup', parameters: [] },
      500,
      4,
      AbortSignal.timeout(5000),
    )
    .then(
      () => null,
      (error: unknown) => error,
    );
  const job = await pendingJob();
  const response = await app.inject({
    method: 'POST',
    url: `/v1/private-egress/jobs/${job.id}/complete`,
    headers: await workerHeaders(),
    payload: { lease: job.lease, response: { status: 200, body: '12345' } },
  });
  expect(response.statusCode).toBe(403);
  expect(await pending).toMatchObject({ code: 'TIMEOUT' });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/v1/private-egress/jobs/${job.id}/complete`,
        headers: await workerHeaders(),
        payload: { lease: job.lease, response: { status: 200, body: '{}' } },
      })
    ).statusCode,
  ).toBe(404);
  const redis = app.get(RedisService).client;
  expect(await redis.keys(`private-egress:${tenant.tenantId}:${clientId}:${job.id}:*`)).toEqual([]);
});
