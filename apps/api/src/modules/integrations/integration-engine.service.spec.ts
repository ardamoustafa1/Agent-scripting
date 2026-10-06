import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { requestContext } from '../../common/context/request-context.js';
import { type TenantDb } from '../../infra/database/tenant-db.js';
import { type RedisService } from '../../infra/redis/redis.service.js';
import { type AuditService } from '../audit/audit.service.js';
import { type AuthzService } from '../authz/authz.service.js';

import {
  DefinitionSchema,
  PolicySchema,
  SaveDataSourceSchema,
  SecretSetSchema,
} from './engine/contracts.js';
import { EnvelopeVault, EnvKeyAdapter } from './engine/vault.js';
import { IntegrationEngineService } from './integration-engine.service.js';

const tenantId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const sessionId = '00000000-0000-4000-8000-000000000003';
const id = '00000000-0000-4000-8000-000000000004';
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: string;
beforeAll(async () => {
  keys = await generateKeyPair('EdDSA');
  jwks = JSON.stringify({ keys: [await exportJWK(keys.publicKey)] });
});
afterEach(() => {
  vi.unstubAllEnvs();
});
function fixture(state = 'active', declaredVersion = 1) {
  const audits = vi.fn(() => Promise.resolve({})),
    emitted = vi.fn().mockResolvedValue(undefined);
  const tx = {
    dataSource: {
      findFirst: vi.fn(() =>
        Promise.resolve({
          id,
          tenantId,
          key: 'lookup',
          version: 1,
          protocol: 'rest',
          definition: DefinitionSchema.parse({ baseUrl: 'https://service.test', endpoint: '/api' }),
          policy: PolicySchema.parse({}),
          secretRefs: [],
        }),
      ),
    },
    tenant: { findFirst: vi.fn(() => Promise.resolve({ settings: {} })) },
    session: {
      findFirst: vi.fn((_arg: { where: Record<string, unknown> }) =>
        Promise.resolve(
          state === 'active'
            ? {
                kind: 'interaction',
                sequence: 1,
                state: 'active',
                scriptVersion: {
                  documentEncoding: 'json',
                  documentCompressed: null,
                  document: {
                    dataSources: [
                      { id: 'lookup', ref: 'tenant-datasource:lookup', version: declaredVersion },
                    ],
                  },
                },
              }
            : null,
        ),
      ),
    },
    secret: {
      findFirst: vi.fn(() => Promise.resolve(null)),
      findMany: vi.fn(() => Promise.resolve([])),
      create: vi.fn((arg: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...arg.data,
          version: 1,
          createdAt: new Date(0),
          updatedAt: new Date(0),
          rotatedAt: null,
          lastUsedAt: null,
        }),
      ),
    },
  };
  const db = {
    current: () => tx,
    tenantId: () => tenantId,
    run: (_tenant: string, fn: (transaction: typeof tx) => unknown) => Promise.resolve(fn(tx)),
  };
  const service = new IntegrationEngineService(
    db as unknown as TenantDb,
    { record: emitted },
    { record: audits } as unknown as AuditService,
    { authorize: vi.fn() } as unknown as AuthzService,
    {
      client: { get: () => Promise.resolve(null), set: () => Promise.resolve('OK') },
    } as unknown as RedisService,
    new EnvelopeVault(new EnvKeyAdapter(Buffer.alloc(32, 7))),
  );
  const execute = vi.spyOn(service.executor, 'execute').mockResolvedValue({
    value: { ok: true },
    trace: {
      request: null,
      response: null,
      mapped: null,
      durationMs: 1,
      cached: false,
      mock: false,
      error: null,
    },
  });
  const run = <T>(fn: () => T) =>
    requestContext.run(
      {
        requestId: 'request',
        correlationId: 'correlation',
        ip: '',
        userAgent: '',
        principal: { id: userId, tenantId, type: 'user', scopes: [], sessionId: 'bff-session' },
      },
      fn,
    );
  return { service, tx, audits, execute, run, emitted };
}
async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({
    sid: sessionId,
    tnt: tenantId,
    bff: 'bff-session',
    scp: 'integration:execute',
    ...overrides,
  })
    .setSubject(userId)
    .setIssuer('verbis-runtime')
    .setAudience(`integrations:${tenantId}`)
    .setIssuedAt()
    .setExpirationTime('5m')
    .setProtectedHeader({ alg: 'EdDSA' })
    .sign(keys.privateKey);
}
describe('integration API service boundaries', () => {
  it('sets encrypted secret values and returns metadata only, with a mutation audit', async () => {
    const f = fixture();
    const result = await f.run(() =>
      f.service.setSecret(
        SecretSetSchema.parse({ name: 'fixture', kind: 'generic', value: 'synthetic-value' }),
      ),
    );
    expect(JSON.stringify(result)).not.toContain('synthetic-value');
    expect(result).not.toHaveProperty('ciphertext');
    expect(f.tx.secret.create).toHaveBeenCalledOnce();
    expect(f.audits).toHaveBeenCalledWith(
      f.tx,
      expect.objectContaining({ action: 'integration.secret.set' }),
    );
  });
  it.each([{ sid: id }, { tnt: id }, { bff: 'another-bff' }, { scp: 'other' }])(
    'rejects a token bound to another context %j',
    async (claims) => {
      vi.stubEnv('INTEGRATION_RUNTIME_JWKS', jwks);
      const f = fixture();
      const signed = await token(claims);
      await expect(
        f.run(() => f.service.execute(id, sessionId, signed, { input: {}, environment: 'prod' })),
      ).rejects.toMatchObject({ code: 'VERBIS_AUTH_UNAUTHENTICATED' });
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it('requires a signed session token and rejects inactive sessions', async () => {
    vi.stubEnv('INTEGRATION_RUNTIME_JWKS', jwks);
    const f = fixture('ended');
    await expect(
      f.run(() => f.service.execute(id, sessionId, undefined, { input: {}, environment: 'prod' })),
    ).rejects.toMatchObject({ code: 'VERBIS_AUTH_UNAUTHENTICATED' });
    const signed = await token();
    await expect(
      f.run(() => f.service.execute(id, sessionId, signed, { input: {}, environment: 'prod' })),
    ).rejects.toMatchObject({ code: 'VERBIS_AUTHZ_FORBIDDEN' });
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('requires the data source version pinned in the session script', async () => {
    vi.stubEnv('INTEGRATION_RUNTIME_JWKS', jwks);
    const f = fixture('active', 2);
    const signed = await token();
    await expect(
      f.run(() => f.service.execute(id, sessionId, signed, { input: {}, environment: 'prod' })),
    ).rejects.toMatchObject({ code: 'VERBIS_AUTHZ_FORBIDDEN' });
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('executes only the authorized session and derives profile from the server', async () => {
    vi.stubEnv('INTEGRATION_RUNTIME_JWKS', jwks);
    vi.stubEnv('VERBIS_ENVIRONMENT', 'test');
    const f = fixture();
    const signed = await token();
    await expect(
      f.run(() => f.service.execute(id, sessionId, signed, { input: {}, environment: 'prod' })),
    ).resolves.toMatchObject({ value: { ok: true } });
    expect(f.execute).toHaveBeenCalledWith(
      tenantId,
      expect.anything(),
      { input: {}, environment: 'test' },
      expect.anything(),
      [],
      expect.objectContaining({ sessionId }),
    );
    expect(f.tx.session.findFirst.mock.calls[0]?.[0].where).toMatchObject({
      tenantId,
      userId,
      id: sessionId,
      state: 'active',
    });
  });
});

it('failed real executions emit safe latency metadata before surfacing the upstream failure', async () => {
  const f = fixture();
  f.execute.mockResolvedValue({
    value: undefined,
    trace: {
      request: null,
      response: null,
      mapped: null,
      durationMs: 27,
      cached: false,
      mock: false,
      error: 'VERBIS_INTEGRATION_FAILED',
    },
  });
  await expect(
    f.run(() =>
      f.service.executeAuthorized(id, sessionId, {
        input: { customer: 'sensitive-fixture' },
        environment: 'prod',
      }),
    ),
  ).rejects.toThrow();
  expect(f.emitted).toHaveBeenCalledWith(f.tx, {
    type: 'verbis.analytics.datasource.executed.v1',
    aggregateType: 'Session',
    aggregateId: sessionId,
    payload: {
      sequence: 1,
      state: 'active',
      eventType: 'datasource.called',
      event: { name: id, status: 'failure', durationMs: 27 },
    },
  });
  expect(JSON.stringify(f.emitted.mock.calls)).not.toContain('sensitive-fixture');
});

describe('integration authoring execution fences', () => {
  it('rejects live production console calls before invoking any connector', async () => {
    const f = fixture();
    await expect(
      f.run(() => f.service.console(id, { input: {}, environment: 'prod' }, true)),
    ).rejects.toMatchObject({ code: 'VERBIS_AUTHZ_FORBIDDEN' });
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'audits mock or sandbox console calls with explicit execution options (%s)',
    async (live) => {
      const f = fixture();
      await f.run(() =>
        f.service.console(id, { input: { synthetic: true }, environment: 'test' }, live),
      );
      expect(f.execute.mock.calls[0]?.[5]).toEqual({ preview: !live });
      expect(f.audits).toHaveBeenCalledWith(
        f.tx,
        expect.objectContaining({ action: 'integration.datasource.tested', outcome: 'success' }),
      );
    },
  );
  it('audits unsuccessful previews and never authorizes a secret read for an unsaved source', async () => {
    const f = fixture();
    const failed = {
      value: undefined,
      trace: {
        request: null,
        response: null,
        mapped: null,
        durationMs: 4,
        cached: false,
        mock: true,
        error: 'synthetic failure',
      },
    };
    f.execute.mockResolvedValue(failed);
    const body = SaveDataSourceSchema.parse({
      key: 'synthetic',
      protocol: 'rest' as const,
      definition: DefinitionSchema.parse({ baseUrl: 'https://service.test', endpoint: '/api' }),
      policy: PolicySchema.parse({}),
    });
    expect(
      await f.run(() => f.service.draftPreview(body, { input: {}, environment: 'test' })),
    ).toEqual(failed.trace);
    const reader = f.execute.mock.calls[0]?.[3];
    await expect(reader?.(id)).rejects.toMatchObject({ code: 'VERBIS_AUTHZ_FORBIDDEN' });
    expect(f.audits).toHaveBeenCalledWith(
      f.tx,
      expect.objectContaining({ action: 'integration.datasource.previewed', outcome: 'failure' }),
    );
  });
  it('requires both an exact saved version and an explicit sandbox profile for runtime simulation', async () => {
    const f = fixture();
    await expect(
      f.run(() =>
        f.service.previewRuntimeCall('tenant-datasource:lookup', 2, {
          input: {},
          environment: 'test',
        }),
      ),
    ).rejects.toMatchObject({ code: 'VERBIS_CONCURRENCY_VERSION_MISMATCH' });
    await expect(
      f.run(() =>
        f.service.previewRuntimeCall('tenant-datasource:lookup', 1, {
          input: {},
          environment: 'test',
        }),
      ),
    ).rejects.toThrow('explicit test profile');
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'uses only the explicit test profile and reports failed results (%s)',
    async (failed) => {
      const f = fixture();
      const source = await f.tx.dataSource.findFirst();
      f.tx.dataSource.findFirst.mockResolvedValue({
        ...source,
        definition: DefinitionSchema.parse({
          ...source.definition,
          profiles: { test: { baseUrl: 'https://sandbox.service.test', auth: { type: 'none' } } },
        }),
      });
      if (failed)
        f.execute.mockResolvedValue({
          value: undefined,
          trace: {
            request: null,
            response: null,
            mapped: null,
            durationMs: 7,
            cached: false,
            mock: false,
            error: 'synthetic failure',
          },
        });
      const pending = f.run(() =>
        f.service.previewRuntimeCall('tenant-datasource:lookup', 1, {
          input: { synthetic: true },
          environment: 'test',
        }),
      );
      if (failed)
        await expect(pending).rejects.toMatchObject({ code: 'VERBIS_INTEGRATION_FAILED' });
      else await expect(pending).resolves.toEqual({ value: { ok: true }, durationMs: 1 });
      expect(f.execute.mock.calls[0]?.[2]).toEqual({
        input: { synthetic: true },
        environment: 'test',
      });
      expect(f.audits).toHaveBeenCalledWith(
        f.tx,
        expect.objectContaining({
          action: 'integration.datasource.previewExecuted',
          outcome: failed ? 'failure' : 'success',
        }),
      );
    },
  );
  it('denies undeclared secret references on saved sources even during an authorized sandbox call', async () => {
    const f = fixture();
    await f.run(() => f.service.console(id, { input: {}, environment: 'test' }, true));
    await expect(f.execute.mock.calls[0]?.[3]?.(id)).rejects.toMatchObject({
      code: 'VERBIS_AUTHZ_FORBIDDEN',
    });
  });
  it('denies introspection for non-GraphQL sources and returns tenant-scoped metrics', async () => {
    const f = fixture();
    await expect(f.run(() => f.service.introspect(id, 'test'))).rejects.toMatchObject({
      code: 'VERBIS_AUTHZ_FORBIDDEN',
    });
    expect(await f.run(() => f.service.metrics(id))).toEqual([]);
  });
  it('fails closed when runtime JWT verification keys are absent', async () => {
    vi.stubEnv('INTEGRATION_RUNTIME_JWKS', '');
    const f = fixture();
    await expect(
      f.run(() =>
        f.service.execute(id, sessionId, 'synthetic-token', { input: {}, environment: 'prod' }),
      ),
    ).rejects.toMatchObject({ code: 'VERBIS_INTEGRATION_UNAVAILABLE' });
    expect(f.execute).not.toHaveBeenCalled();
  });
});
