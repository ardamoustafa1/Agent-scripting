import { randomUUID, X509Certificate } from 'node:crypto';

import { createMongoAbility } from '@casl/ability';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { AppAbility, AppRawRule } from '@verbis/authz';

import { requestContext, systemContext } from '../../../common/context/request-context.js';
import { sha256Base64Url, sha256Hex } from '../crypto/random.js';
import { generateSpCredential } from '../saml/sp-credentials.js';

import {
  CreateServiceClientSchema,
  ServiceClientsService,
  UpdateServiceClientSchema,
} from './service-clients.service.js';

import type { TenantDb } from '../../../infra/database/tenant-db.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { ResolvedAbility } from '../../authz/ability.factory.js';

let certificate: string;
beforeAll(async () => {
  certificate = (await generateSpCredential('Synthetic service client')).certificate;
});
function fixture(rules: AppRawRule[] = [{ action: 'read', subject: 'Script' }]) {
  const tenantId = randomUUID();
  const row = {
    id: randomUUID(),
    name: 'Synthetic client',
    authMethod: 'client_secret_basic',
    scopes: ['read:Script'],
    status: 'active',
    certificateThumbprint: null,
    lastUsedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  };
  const tx = {
    tenant: { findFirst: vi.fn().mockResolvedValue({ slug: 'synthetic' }) },
    serviceClient: {
      findMany: vi.fn().mockResolvedValue([row]),
      findFirst: vi.fn().mockResolvedValue(row),
      create: vi
        .fn<(input: { data: Record<string, unknown> }) => Promise<typeof row>>()
        .mockImplementation((input: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...row, ...input.data }),
        ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi
        .fn<(input: { data: Record<string, unknown> }) => Promise<typeof row>>()
        .mockImplementation((input: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...row, ...input.data, version: 2 }),
        ),
    },
  };
  const audit = {
    record: vi
      .fn<(tx: unknown, event: Record<string, unknown>) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
  const service = new ServiceClientsService(
    { current: () => tx, tenantId: () => tenantId } as unknown as TenantDb,
    audit as unknown as AuditService,
  );
  const context = {
    ...systemContext(randomUUID(), 'test'),
    principal: { type: 'user' as const, id: randomUUID(), tenantId, scopes: [] },
    authz: { ability: createMongoAbility<AppAbility>(rules) } as ResolvedAbility,
  };
  const run = <T>(work: () => T) => requestContext.run(context, work);
  const input = CreateServiceClientSchema.parse({ name: row.name, scopes: row.scopes });
  return { service, tx, audit, row, run, context, input, tenantId };
}

describe('service client credentials and permission delegation', () => {
  it.each(['client_secret_basic', 'client_secret_post'] as const)(
    'reveals %s secret once and persists only its digest',
    async (authMethod) => {
      const f = fixture();
      const result = await f.run(() => f.service.create({ ...f.input, authMethod }));
      expect(result.clientSecret).toMatch(/^vsc_[A-Za-z0-9_-]+$/);
      expect(f.tx.serviceClient.create.mock.calls[0]?.[0].data).toMatchObject({
        tenantId: f.tenantId,
        secretHash: sha256Hex(result.clientSecret ?? ''),
        createdBy: `user:${f.context.principal.id}`,
      });
      expect(JSON.stringify(f.audit.record.mock.calls)).not.toContain(result.clientSecret);
      expect(await f.service.get(result.id)).not.toHaveProperty('clientSecret');
      expect(result.tokenEndpoint).toBe('/oauth2/synthetic/token');
    },
  );
  it('binds a TLS client to the real certificate digest and never generates a secret', async () => {
    const f = fixture();
    const result = await f.run(() =>
      f.service.create({ ...f.input, authMethod: 'tls_client_auth', certificate }),
    );
    expect(result.clientSecret).toBeNull();
    expect(result.certificateThumbprint).toBe(
      sha256Base64Url(new X509Certificate(certificate).raw),
    );
    expect(f.tx.serviceClient.create.mock.calls[0]?.[0].data['secretHash']).toBeNull();
  });
  it('also supports certificate binding for secret-based clients', async () => {
    const f = fixture();
    const result = await f.run(() => f.service.create({ ...f.input, certificate }));
    expect(result.clientSecret).toMatch(/^vsc_/);
    expect(result.certificateThumbprint).not.toBeNull();
  });
  it.each(['missing TLS certificate', 'invalid certificate'] as const)(
    'rejects %s before storing a credential',
    async (reason) => {
      const f = fixture();
      await expect(
        f.run(() =>
          f.service.create({
            ...f.input,
            ...(reason === 'missing TLS certificate'
              ? { authMethod: 'tls_client_auth' as const }
              : { certificate: 'not a certificate' }),
          }),
        ),
      ).rejects.toMatchObject({ code: 'VERBIS_VALIDATION_FAILED' });
      expect(f.tx.serviceClient.create).not.toHaveBeenCalled();
      expect(f.audit.record).not.toHaveBeenCalled();
    },
  );
  it.each(
    [
      [{ action: 'read', subject: 'Script', conditions: { teamId: 'limited-team' } }],
      [{ action: 'read', subject: 'Script', fields: ['name'] }],
      [
        { action: 'read', subject: 'Script' },
        { action: 'read', subject: 'Script', inverted: true, conditions: { private: true } },
      ],
      [
        { action: 'read', subject: 'Script' },
        { action: 'read', subject: 'Script', inverted: true, fields: ['secret'] },
      ],
      [{ action: 'read', subject: 'Campaign' }],
      [],
    ].map((rules) => ({ rules })),
  )('prevents escalation from conditional, restricted or absent grants (%j)', async ({ rules }) => {
    const f = fixture(rules as AppRawRule[]);
    await expect(f.run(() => f.service.create(f.input))).rejects.toThrow('permissions');
    expect(f.tx.serviceClient.create).not.toHaveBeenCalled();
  });
  it('rejects unknown scopes and a missing resolved ability even if the caller bypasses DTO parsing', async () => {
    const f = fixture();
    await expect(
      f.run(() => f.service.create({ ...f.input, scopes: ['unknown:Script'] })),
    ).rejects.toThrow('permissions');
    delete (f.context as { authz?: ResolvedAbility }).authz;
    await expect(f.run(() => f.service.create(f.input))).rejects.toThrow('permissions');
  });
  it('accepts an unrestricted inherited manage grant while rejecting malformed DTO scopes', async () => {
    const f = fixture([{ action: 'manage', subject: 'all' }]);
    await expect(f.run(() => f.service.create(f.input))).resolves.toMatchObject({
      scopes: ['read:Script'],
    });
    expect(
      CreateServiceClientSchema.safeParse({ name: 'x', scopes: ['unknown:Script'] }).success,
    ).toBe(false);
    expect(UpdateServiceClientSchema.safeParse({}).success).toBe(false);
  });
  it('keeps reads tenant scoped and formats nullable or present timestamps', async () => {
    const f = fixture();
    f.row.lastUsedAt = new Date('2026-01-01T00:00:00Z') as never;
    expect(await f.service.list()).toEqual([
      expect.objectContaining({ lastUsedAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(f.tx.serviceClient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: f.tenantId, deletedAt: null } }),
    );
    f.tx.tenant.findFirst.mockResolvedValue(null);
    expect((await f.service.get(f.row.id)).tokenEndpoint).toBe('/oauth2//token');
    f.tx.serviceClient.findFirst.mockResolvedValue(null);
    await expect(f.service.get(randomUUID())).rejects.toThrow();
  });
  it('updates allowed fields under a version fence and checks delegated scopes again', async () => {
    const f = fixture();
    await f.run(() => f.service.update(f.row.id, 1, { name: 'Renamed' }));
    expect(f.tx.serviceClient.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { tenantId: f.tenantId, version: 1, deletedAt: null },
      data: { name: 'Renamed', version: { increment: 1 } },
    });
    await f.run(() =>
      f.service.update(f.row.id, 1, { scopes: ['read:Script'], status: 'disabled' }),
    );
    await expect(
      f.run(() => f.service.update(f.row.id, 1, { scopes: ['manage:all'] })),
    ).rejects.toThrow('permissions');
    expect(f.tx.serviceClient.updateMany).toHaveBeenCalledTimes(2);
  });
  it.each(['stale version', 'concurrent update'] as const)(
    'rejects %s without auditing a successful write',
    async (reason) => {
      const f = fixture();
      if (reason === 'concurrent update')
        f.tx.serviceClient.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        f.run(() =>
          f.service.update(f.row.id, reason === 'stale version' ? 9 : 1, { status: 'disabled' }),
        ),
      ).rejects.toThrow();
      expect(f.audit.record).not.toHaveBeenCalled();
    },
  );
  it('rotates to a new one-time secret and denies secret rotation for TLS clients', async () => {
    const f = fixture();
    const first = await f.run(() => f.service.rotateSecret(f.row.id));
    const next = await f.run(() => f.service.rotateSecret(f.row.id));
    expect(first.clientSecret).not.toBe(next.clientSecret);
    expect(f.tx.serviceClient.update.mock.calls[1]?.[0].data['secretHash']).toBe(
      sha256Hex(next.clientSecret),
    );
    expect(JSON.stringify(f.audit.record.mock.calls)).not.toContain(next.clientSecret);
    f.row.authMethod = 'tls_client_auth';
    await expect(f.run(() => f.service.rotateSecret(f.row.id))).rejects.toThrow('no secret');
    expect(f.tx.serviceClient.update).toHaveBeenCalledTimes(2);
  });
  it('rejects stale deletion and soft disables a valid deletion with an audit record', async () => {
    const f = fixture();
    await expect(f.run(() => f.service.remove(f.row.id, 9))).rejects.toThrow();
    expect(f.tx.serviceClient.update).not.toHaveBeenCalled();
    await f.run(() => f.service.remove(f.row.id, 1));
    expect(f.tx.serviceClient.update.mock.calls[0]?.[0].data).toMatchObject({
      status: 'disabled',
      version: { increment: 1 },
    });
    expect(f.tx.serviceClient.update.mock.calls[0]?.[0].data['deletedAt']).toBeInstanceOf(Date);
    expect(f.audit.record.mock.calls[0]?.[1]).toMatchObject({
      action: 'identity.serviceClient.deleted',
    });
  });
});
