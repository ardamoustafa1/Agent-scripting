import { expect, it, vi } from 'vitest';

import { requestContext } from '../../common/context/request-context.js';

import { DefinitionSchema, PolicySchema, SaveDataSourceSchema } from './engine/contracts.js';
import { EnvelopeVault, EnvKeyAdapter } from './engine/vault.js';
import { IntegrationEngineService } from './integration-engine.service.js';

import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { RedisService } from '../../infra/redis/redis.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthzService } from '../authz/authz.service.js';

const tenant = '01990000-0000-7000-8000-000000000001',
  id = '01990000-0000-7000-8000-000000000002';
function fixture() {
  const row = {
    id,
    tenantId: tenant,
    version: 1,
    key: 'synthetic',
    protocol: 'rest',
    definition: DefinitionSchema.parse({
      baseUrl: 'https://synthetic.invalid',
      endpoint: '/lookup',
      profiles: { dev: { baseUrl: 'https://dev.synthetic.invalid', auth: { type: 'none' } } },
    }),
    policy: PolicySchema.parse({}),
    secretRefs: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  const tx = {
    dataSource: {
      findFirst: vi.fn().mockResolvedValue(row),
      create: vi
        .fn()
        .mockImplementation(({ data }: { data: object }) => Promise.resolve({ ...row, ...data })),
      update: vi
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ ...row, ...data, version: 2 }),
        ),
    },
    secret: { findFirst: vi.fn().mockResolvedValue({ id }) },
    scriptVersion: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) },
    authz = { authorize: vi.fn(), can: vi.fn().mockReturnValue(true) };
  const service = new IntegrationEngineService(
    { tenantId: () => tenant, current: () => tx } as unknown as TenantDb,
    { record: vi.fn().mockResolvedValue(undefined) },
    audit as unknown as AuditService,
    authz as unknown as AuthzService,
    {
      client: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') },
    } as unknown as RedisService,
    new EnvelopeVault(new EnvKeyAdapter(Buffer.alloc(32, 7))),
  );
  const run = <T>(fn: () => T, actor = id) =>
    requestContext.run(
      {
        requestId: 'synthetic',
        correlationId: 'synthetic',
        ip: '',
        userAgent: 'test',
        principal: { type: 'user', id: actor, tenantId: tenant, scopes: [] },
      },
      fn,
    );
  const input = () =>
    SaveDataSourceSchema.parse({
      key: row.key,
      protocol: row.protocol,
      definition: row.definition,
      policy: row.policy,
    });
  return { service, row, tx, audit, authz, run, input };
}
it('creates and updates an integration with optimistic protection and audited public metadata', async () => {
  const f = fixture();
  expect(await f.run(() => f.service.save(f.input()))).toMatchObject({
    key: 'synthetic',
    version: 1,
  });
  expect(await f.run(() => f.service.save(f.input(), id, 1))).toMatchObject({ version: 2 });
  expect(f.tx.dataSource.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id, tenantId: tenant, version: 1 } }),
  );
  expect(await f.service.get(id)).toMatchObject({ id, protocol: 'rest' });
  await expect(f.run(() => f.service.save(f.input(), id, 0))).rejects.toThrow();
});
it('refuses direct production profile changes and missing secret dependencies before writing', async () => {
  const f = fixture();
  const changed = f.input();
  changed.definition.profiles.prod = {
    baseUrl: 'https://prod.synthetic.invalid',
    auth: { type: 'none' },
  };
  await expect(f.run(() => f.service.save(changed))).rejects.toThrow(
    'Production profiles require approval',
  );
  const secret = f.input();
  secret.definition.auth = { type: 'bearer', secretRef: id };
  f.tx.secret.findFirst.mockResolvedValue(null);
  await expect(f.run(() => f.service.save(secret))).rejects.toThrow();
  expect(f.tx.dataSource.create).not.toHaveBeenCalled();
});
it('deduplicates tenant-owned secrets across profiles without exposing their values', async () => {
  const f = fixture();
  const input = f.input();
  input.definition.auth = { type: 'bearer', secretRef: id };
  input.definition.profiles.dev!.auth = { type: 'bearer', secretRef: id };
  await f.run(() => f.service.save(input));
  expect(f.tx.dataSource.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ secretRefs: [id] }) as unknown }),
  );
});
it('requires independent approval before promoting a dev profile into production', async () => {
  const f = fixture();
  await f.run(() =>
    f.service.promote(id, 1, { from: 'dev', reason: 'Synthetic approval request' }),
  );
  const update = f.tx.dataSource.update.mock.calls[0]![0] as {
    data: { definition: typeof f.row.definition };
  };
  f.row.definition = update.data.definition;
  await expect(f.run(() => f.service.promote(id, 1))).rejects.toThrow(
    'Independent approval required',
  );
  await f.run(() => f.service.promote(id, 1), tenant);
  const approved = (
    f.tx.dataSource.update.mock.calls.at(-1)![0] as {
      data: { definition: typeof f.row.definition };
    }
  ).data.definition;
  expect(approved.profiles.prod).toEqual(f.row.definition.profiles.dev);
  expect(approved.pendingPromotion).toBeUndefined();
  expect(f.audit.record).toHaveBeenCalledWith(
    f.tx,
    expect.objectContaining({ action: 'integration.profile.promoted' }),
  );
});
it('rejects unavailable promotion profiles, stale versions and missing integrations', async () => {
  const f = fixture();
  await expect(
    f.run(() => f.service.promote(id, 1, { from: 'test', reason: 'Synthetic' })),
  ).rejects.toThrow('Source profile required');
  await expect(f.run(() => f.service.promote(id, 0))).rejects.toThrow();
  f.tx.dataSource.findFirst.mockResolvedValue(null);
  await expect(f.service.get(id)).rejects.toThrow();
  expect(f.tx.dataSource.update).not.toHaveBeenCalled();
});
it('filters integration usage by readable scripts and exact datasource references and bounds its scan', async () => {
  const f = fixture();
  const used = {
    scriptId: id,
    number: 1,
    documentEncoding: 'json',
    documentCompressed: null,
    document: { dataSources: [{ ref: 'tenant-datasource:synthetic' }] },
    script: { name: 'Synthetic consumer', tenantId: tenant, deletedAt: null },
  };
  f.tx.scriptVersion.findMany.mockResolvedValue([
    used,
    { ...used, script: { ...used.script, deletedAt: new Date() } },
    { ...used, document: { dataSources: [{ ref: 'tenant-datasource:other' }] } },
    { ...used, document: {} },
  ]);
  expect(await f.service.usage(id)).toEqual({
    data: [{ scriptId: id, name: 'Synthetic consumer', number: 1 }],
    truncated: false,
  });
  f.authz.can.mockReturnValue(false);
  expect((await f.service.usage(id)).data).toEqual([]);
  f.tx.scriptVersion.findMany.mockResolvedValue(Array.from({ length: 1001 }, () => used));
  expect((await f.service.usage(id)).truncated).toBe(true);
});

it('allows an update-only editor to modify an existing integration without creation permission', async () => {
  const f = fixture();
  f.authz.authorize.mockImplementation((action: string) => {
    if (action === 'create') throw new Error('No creation permission');
  });
  expect(await f.run(() => f.service.save(f.input(), id, 1))).toMatchObject({ version: 2 });
  expect(f.authz.authorize).not.toHaveBeenCalledWith('create', expect.anything());
});
