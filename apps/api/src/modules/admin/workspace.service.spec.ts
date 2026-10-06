import { createServer } from 'node:http';

import { exportJWK, generateKeyPair } from 'jose';
import { expect, it, vi } from 'vitest';

import { createAbility } from '@verbis/authz';
import { AdminTenantInputSchema } from '@verbis/shared-types';

import { requestContext } from '../../common/context/request-context.js';

import { AdminConnectorInputSchema, IssuerInputSchema } from './workspace.dto.js';
import { AdminWorkspaceService } from './workspace.service.js';

import type { ApiEnv } from '../../env.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { AuditService } from '../audit/audit.service.js';
import type { HubClient } from '../connectors/hub-client.js';
import type { AddressInfo } from 'node:net';

const tenant = '01990000-0000-7000-8000-000000000001';
const id = '01990000-0000-7000-8000-000000000002';
function run<T>(fn: () => T, options: { local?: boolean; denied?: boolean } = {}) {
  return requestContext.run(
    {
      requestId: 'synthetic',
      correlationId: 'synthetic',
      ip: '',
      userAgent: 'test',
      principal: {
        type: 'user',
        id,
        tenantId: tenant,
        scopes: [],
        authMethod: options.local ? 'break_glass' : 'sso',
      },
      authz: {
        ability: createAbility(options.denied ? [] : [{ action: 'manage', subject: 'all' }]),
        roles: options.denied ? [] : ['super_admin'],
        rules: [],
        separationOfDuties: true,
      },
    },
    fn,
  );
}
function fixture() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    identityProvider: { findFirst: vi.fn().mockResolvedValue(null) },
    secret: { count: vi.fn().mockResolvedValue(1) },
    dataSource: { findMany: vi.fn().mockResolvedValue([]) },
    tenant: { findFirstOrThrow: vi.fn().mockResolvedValue({ settings: {} }) },
    connector: {
      create: vi.fn().mockResolvedValue({ version: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue({ id, version: 2, config: {}, secretRefs: [] }),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue({
        id,
        ctiIdentities: [
          { platform: 'other', platformUserId: 'retained' },
          { platform: 'fixture', platformUserId: 'old' },
        ],
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    launchTrustedIssuer: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) },
    hub = { call: vi.fn().mockResolvedValue({ connectors: [] }) };
  const env = {} as ApiEnv;
  const service = new AdminWorkspaceService(
    { current: () => tx, tenantId: () => tenant } as unknown as TenantDb,
    audit as unknown as AuditService,
    hub as unknown as HubClient,
    env,
  );
  return { service, tx, audit, hub, env };
}
const input = AdminTenantInputSchema.parse({
  slug: 'synthetic',
  name: 'Synthetic tenant',
  region: 'test',
  status: 'active',
  quotas: { maxUsers: 10, maxScripts: 10, maxActiveSessions: 10 },
  features: {},
});
it.each([{ local: true }, { denied: true }])(
  'denies platform tenant access for %j before database calls',
  async (options) => {
    const f = fixture();
    await expect(run(() => f.service.tenants(), options)).rejects.toThrow();
    await expect(run(() => f.service.tenant(input), options)).rejects.toThrow();
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
  },
);
it('lists tenant defaults without returning internal settings and records the access', async () => {
  const f = fixture();
  const row = { ...input, id, version: 1, settings: {} };
  f.tx.$queryRaw.mockResolvedValue([{ value: [row] }]);
  const result = await run(() => f.service.tenants());
  expect(result[0]).toMatchObject({ quotas: { maxUsers: 1000 }, features: {} });
  expect(result[0]).not.toHaveProperty('settings');
  expect(f.audit.record).toHaveBeenCalledWith(
    f.tx,
    expect.objectContaining({ action: 'admin.tenants.read' }),
  );
  f.tx.$queryRaw.mockResolvedValue([]);
  expect(await run(() => f.service.tenants())).toEqual([]);
});
it.each([undefined, 3])(
  'writes tenant version %s through the platform function and audits its public metadata',
  async (version) => {
    const f = fixture();
    f.tx.$queryRaw.mockResolvedValue([
      {
        value: {
          ...input,
          id,
          version: (version ?? 0) + 1,
          settings: { quotas: input.quotas, features: input.features },
        },
      },
    ]);
    expect(await run(() => f.service.tenant(input, id, version))).toMatchObject({
      id,
      version: (version ?? 0) + 1,
      quotas: input.quotas,
    });
    expect(f.audit.record).toHaveBeenCalledWith(
      f.tx,
      expect.objectContaining({
        action: version === undefined ? 'admin.tenant.created' : 'admin.tenant.updated',
      }),
    );
  },
);
it.each(['40001', '42501', 'unexpected'])(
  'handles platform write error %s without recording success',
  async (code) => {
    const f = fixture();
    f.tx.$queryRaw.mockRejectedValue({ meta: { code } });
    await expect(run(() => f.service.tenant(input, id, 2))).rejects.toBeDefined();
    expect(f.audit.record).not.toHaveBeenCalled();
  },
);
it('rejects a platform function that returns no tenant and computes operation failure rates', async () => {
  const f = fixture();
  await expect(run(() => f.service.tenant(input))).rejects.toThrow('Tenant update failed');
  expect(await f.service.operations()).toMatchObject({ total: 0, failed: 0, errorRate: null });
  f.tx.$queryRaw.mockResolvedValue([{ total: 20n, failed: 5n }]);
  expect(await f.service.operations()).toMatchObject({ total: 20, failed: 5, errorRate: 0.25 });
});
it('bounds secret usage and includes only an AI reference to the requested secret', async () => {
  const f = fixture();
  const references = Array.from({ length: 501 }, (_, i) => ({
    id: String(i),
    key: 'synthetic',
    protocol: 'rest',
  }));
  f.tx.dataSource.findMany.mockResolvedValue(references);
  f.tx.tenant.findFirstOrThrow.mockResolvedValue({ settings: { ai: { secretRef: id } } });
  expect(await f.service.secretUsage(id)).toMatchObject({
    truncated: true,
    ai: { enabled: false },
  });
  expect((await f.service.secretUsage(id)).data).toHaveLength(500);
  f.tx.tenant.findFirstOrThrow.mockResolvedValue({
    settings: { ai: { secretRef: tenant, enabled: true } },
  });
  expect((await f.service.secretUsage(id)).ai).toBeNull();
  f.tx.secret.count.mockResolvedValue(0);
  await expect(f.service.secretUsage(id)).rejects.toThrow();
});
it('creates and updates only tenant-owned connector secrets, enforcing optimistic versions', async () => {
  const f = fixture();
  const connector = AdminConnectorInputSchema.parse({
    adapterType: 'generic',
    platform: 'synthetic',
    status: 'draft',
    config: { endpoint: 'https://synthetic.example' },
    secretRefs: [],
  });
  expect(await run(() => f.service.connector(connector, id))).toMatchObject({ id, version: 1 });
  expect(await run(() => f.service.connector(connector, id, 1))).toMatchObject({ version: 2 });
  expect(f.tx.connector.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id, tenantId: tenant, version: 1, deletedAt: null } }),
  );
  f.tx.connector.updateMany.mockResolvedValue({ count: 0 });
  await expect(run(() => f.service.connector(connector, id, 1))).rejects.toThrow();
  f.tx.secret.count.mockResolvedValue(0);
  await expect(
    run(() => f.service.connector({ ...connector, secretRefs: [id] }, id)),
  ).rejects.toThrow();
});
it('reports absent and running connectors through the hub and validates configuration', async () => {
  const f = fixture();
  expect(await f.service.connectorHealth(id)).toEqual({ connectorId: id, state: 'not_running' });
  f.hub.call.mockResolvedValue({ connectors: [{ connectorId: id, state: 'running' }] });
  expect(await f.service.connectorHealth(id)).toEqual({ connectorId: id, state: 'running' });
  expect(await f.service.connectorDetail(id)).toMatchObject({ config: {} });
  f.tx.connector.findFirst.mockResolvedValue(null);
  await expect(f.service.connectorHealth(id)).rejects.toThrow();
  await expect(f.service.connectorDetail(id)).rejects.toThrow();
});
it('rotates real Ed25519 and EC public keys and rejects malformed key material and stale versions', async () => {
  const f = fixture();
  for (const alg of ['EdDSA', 'ES256']) {
    const pair = await generateKeyPair(alg);
    const key = await exportJWK(pair.publicKey);
    const issuer = IssuerInputSchema.parse({
      issuer: 'synthetic',
      status: 'active',
      jwks: { keys: [{ ...key, kid: alg }] },
    });
    expect(await run(() => f.service.issuer(issuer, id))).toMatchObject({ id, version: 1 });
    expect(await run(() => f.service.issuer(issuer, id, 2))).toMatchObject({ version: 3 });
    await expect(
      run(() =>
        f.service.issuer(
          { ...issuer, jwks: { keys: [{ ...issuer.jwks.keys[0]!, x: 'bad' }] } },
          id,
        ),
      ),
    ).rejects.toThrow('Invalid public key');
    f.tx.launchTrustedIssuer.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(run(() => f.service.issuer(issuer, id, 2))).rejects.toThrow();
  }
  expect(await f.service.issuers()).toEqual([]);
});
it('replaces only one CTI platform mapping after locking and checking permission', async () => {
  const f = fixture();
  const result = await run(() =>
    f.service.mapping(id, { platform: 'fixture', platformUserId: 'new' }),
  );
  expect(result.ctiIdentities).toEqual([
    { platform: 'other', id: 'retained' },
    { platform: 'fixture', id: 'new' },
  ]);
  expect(f.tx.$queryRaw).toHaveBeenCalledTimes(3);
  await expect(
    run(() => f.service.mapping(id, { platform: 'fixture', platformUserId: 'new' }), {
      denied: true,
    }),
  ).rejects.toThrow();
  f.tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: tenant }]);
  await expect(
    run(() => f.service.mapping(id, { platform: 'fixture', platformUserId: 'new' })),
  ).rejects.toThrow('Platform identity already mapped');
  f.tx.user.findFirst.mockResolvedValue(null);
  await expect(
    run(() => f.service.mapping(id, { platform: 'fixture', platformUserId: 'new' })),
  ).rejects.toThrow();
});

it('validates discovery and identity connectivity against a synthetic loopback server', async () => {
  const f = fixture();
  let origin = '',
    mode = 'valid';
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.statusCode = mode === 'unavailable' ? 503 : 200;
    response.end(
      JSON.stringify({
        issuer: mode === 'mismatch' ? 'https://other.invalid' : origin,
        authorization_endpoint: origin + '/authorize',
        token_endpoint: origin + '/token',
        jwks_uri: origin + '/jwks',
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);
  f.env.IDENTITY_EGRESS_ALLOW_HTTP_HOSTS = ['127.0.0.1'];
  f.env.IDENTITY_EGRESS_ALLOW_PRIVATE_HOSTS = ['127.0.0.1'];
  try {
    expect(await f.service.discover(origin)).toMatchObject({
      issuer: origin,
      authorizationEndpoint: origin + '/authorize',
    });
    expect(await f.service.discover(origin + '/.well-known/openid-configuration')).toMatchObject({
      issuer: origin,
    });
    f.tx.identityProvider.findFirst.mockResolvedValue({
      protocol: 'oidc',
      config: { issuer: origin },
    });
    expect(await f.service.testIdentity(id)).toMatchObject({
      protocol: 'oidc',
      stage: 'discovery',
    });
    f.tx.identityProvider.findFirst.mockResolvedValue({
      protocol: 'saml',
      config: { ssoUrl: origin },
    });
    expect(await f.service.testIdentity(id)).toMatchObject({
      protocol: 'saml',
      stage: 'endpoint',
      httpStatus: 200,
      reachable: true,
    });
    mode = 'mismatch';
    await expect(f.service.discover(origin)).rejects.toThrow('Issuer mismatch');
    mode = 'unavailable';
    await expect(f.service.discover(origin)).rejects.toThrow('Identity discovery failed');
    f.tx.identityProvider.findFirst.mockResolvedValue(null);
    await expect(f.service.testIdentity(id)).rejects.toThrow();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      }),
    );
  }
});
