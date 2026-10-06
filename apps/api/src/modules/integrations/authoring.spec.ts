import { describe, expect, it, vi } from 'vitest';

import { requestContext } from '../../common/context/request-context.js';

import { DefinitionSchema, PolicySchema, SaveDataSourceSchema } from './engine/contracts.js';
import { EnvelopeVault, EnvKeyAdapter } from './engine/vault.js';
import { IntegrationEngineService } from './integration-engine.service.js';

import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { RedisService } from '../../infra/redis/redis.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthzService } from '../authz/authz.service.js';

const id = '00000000-0000-4000-8000-000000000004',
  tenantId = '00000000-0000-4000-8000-000000000001';
function fixture() {
  const row = {
    id,
    tenantId,
    key: 'lookup',
    version: 1,
    protocol: 'rest' as const,
    definition: DefinitionSchema.parse({
      baseUrl: 'https://api.example.com',
      endpoint: '/',
      profiles: { test: { baseUrl: 'https://test.customer.example.io', auth: { type: 'none' } } },
    }),
    policy: PolicySchema.parse({}),
    secretRefs: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  const update = vi.fn((args: { where: { version?: number }; data: { definition: unknown } }) => {
    if (args.where.version !== row.version) return Promise.reject(new Error('version'));
    row.definition = DefinitionSchema.parse(args.data.definition);
    row.version++;
    return Promise.resolve(row);
  });
  const tx = {
    dataSourceVersion: { findFirst: vi.fn().mockResolvedValue(null) },
    dataSource: { findFirst: vi.fn(() => Promise.resolve(row)), update },
  };
  const audit = vi.fn(() => Promise.resolve({})),
    authorize = vi.fn();
  const service = new IntegrationEngineService(
    { current: () => tx, tenantId: () => tenantId } as unknown as TenantDb,
    { record: vi.fn().mockResolvedValue(undefined) },
    { record: audit } as unknown as AuditService,
    { authorize } as unknown as AuthzService,
    {
      client: { get: () => Promise.resolve(null), set: () => Promise.resolve('OK') },
    } as unknown as RedisService,
    new EnvelopeVault(new EnvKeyAdapter(Buffer.alloc(32, 7))),
  );
  const run = <T>(actor: string, work: () => T) =>
    requestContext.run(
      {
        requestId: 'fixture',
        correlationId: 'fixture',
        ip: '',
        userAgent: '',
        principal: { id: actor, tenantId, type: 'user', scopes: [], sessionId: 'fixture-session' },
      },
      work,
    );
  return { row, service, audit, authorize, update, run };
}
describe('integration authoring approval and concurrency', () => {
  it('pins a profile, rejects self-approval, then independently approves with an audit event', async () => {
    const f = fixture();
    await f.run('author', () =>
      f.service.promote(id, 1, { from: 'test', reason: 'Synthetic release' }),
    );
    expect(f.row.definition.pendingPromotion?.profile.baseUrl).toBe(
      'https://test.customer.example.io',
    );
    expect(f.row.definition.profiles.prod).toBeUndefined();
    await expect(f.run('author', () => f.service.promote(id, 2))).rejects.toThrow();
    await f.run('reviewer', () => f.service.promote(id, 2));
    expect(f.authorize).toHaveBeenCalledWith('approve', expect.any(Object));
    expect(f.row.definition.profiles.prod?.baseUrl).toBe('https://test.customer.example.io');
    expect(f.row.definition.pendingPromotion).toBeUndefined();
    expect(f.audit).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ action: 'integration.profile.promoted' }),
    );
  });
  it('rejects stale versions and direct prod changes without writing', async () => {
    const f = fixture();
    await expect(
      f.run('author', () => f.service.promote(id, 3, { from: 'test', reason: 'Synthetic' })),
    ).rejects.toThrow();
    const body = SaveDataSourceSchema.parse({
      key: f.row.key,
      protocol: f.row.protocol,
      definition: {
        ...f.row.definition,
        profiles: { prod: { baseUrl: 'https://prod.example.com', auth: { type: 'none' } } },
      },
      policy: f.row.policy,
    });
    await expect(f.run('author', () => f.service.save(body, id, 1))).rejects.toThrow();
    expect(f.update).not.toHaveBeenCalled();
    expect(f.audit).not.toHaveBeenCalled();
  });
  it('audits unsaved preview and supplies a rejecting secret reader with preview mode', async () => {
    const f = fixture();
    const execute = vi.spyOn(f.service.executor, 'execute').mockResolvedValue({
      value: {},
      trace: {
        request: null,
        response: null,
        mapped: {},
        durationMs: 1,
        cached: false,
        mock: true,
        error: null,
      },
    });
    const body = SaveDataSourceSchema.parse({
      key: f.row.key,
      protocol: f.row.protocol,
      definition: f.row.definition,
      policy: f.row.policy,
    });
    await f.run('author', () => f.service.draftPreview(body, { input: {}, environment: 'dev' }));
    expect(execute).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ id: 'authoring-preview' }),
      expect.any(Object),
      execute.mock.calls[0]?.[3],
      [],
      { preview: true },
    );
    expect(f.update).not.toHaveBeenCalled();
    expect(f.audit).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ action: 'integration.datasource.previewed' }),
    );
  });
  it('requires a configured sandbox profile before requesting promotion', async () => {
    const f = fixture();
    await expect(
      f.run('author', () => f.service.promote(id, 1, { from: 'dev', reason: 'Synthetic' })),
    ).rejects.toThrow();
    expect(f.update).not.toHaveBeenCalled();
  });
});

describe('designer live preview boundaries', () => {
  it('rejects stale pins and requires a separately configured test profile', async () => {
    const f = fixture();
    await expect(
      f.service.previewRuntimeCall('tenant-datasource:lookup', 2, {
        input: {},
        environment: 'test',
      }),
    ).rejects.toMatchObject({ code: 'VERBIS_CONCURRENCY_VERSION_MISMATCH' });
    delete f.row.definition.profiles.test;
    const execute = vi.spyOn(f.service.executor, 'execute');
    await expect(
      f.service.previewRuntimeCall('tenant-datasource:lookup', 1, {
        input: {},
        environment: 'test',
      }),
    ).rejects.toMatchObject({ code: 'VERBIS_AUTHZ_FORBIDDEN' });
    expect(execute).not.toHaveBeenCalled();
    expect(f.authorize).toHaveBeenCalledWith('execute', expect.anything());
  });
});
