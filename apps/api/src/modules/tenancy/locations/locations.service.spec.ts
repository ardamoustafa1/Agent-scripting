import { describe, expect, it, vi } from 'vitest';

import { requestContext, type RequestContext } from '../../../common/context/request-context.js';
import {
  ConflictError,
  NotFoundError,
  VersionMismatchError,
} from '../../../common/errors/domain-errors.js';

import { CreateLocationSchema, LocationListQuerySchema } from './locations.dto.js';
import { LocationsService } from './locations.service.js';

import type { TenantDb } from '../../../infra/database/tenant-db.js';
import type { OutboxWriter } from '../../../infra/outbox/outbox.writer.js';
import type { AuditService } from '../../audit/audit.service.js';

const TENANT = '0199a000-0000-7000-8000-000000000001';
const ID = '0199a000-0000-7000-8000-0000000000bb';
const NOW = new Date('2026-10-06T10:00:00.000Z');
const row = (over: Record<string, unknown> = {}) => ({
  id: ID,
  code: 'ankara-hq',
  name: 'Ankara HQ',
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
  ...over,
});

function setup(existing: Record<string, unknown> | null = row()) {
  const tx = {
    location: {
      findFirst: vi.fn((_args: unknown) => Promise.resolve(existing)),
      findMany: vi.fn((_args: unknown) => Promise.resolve([row()])),
      create: vi.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve(row({ code: args.data['code'], name: args.data['name'] })),
      ),
      updateMany: vi.fn((_args: unknown) => Promise.resolve({ count: 1 })),
    },
  };
  const audit = { record: vi.fn(() => Promise.resolve({})) };
  const outbox = { record: vi.fn(() => Promise.resolve()) };
  const service = new LocationsService(
    { current: () => tx, tenantId: () => TENANT } as unknown as TenantDb,
    audit as unknown as AuditService,
    outbox as unknown as OutboxWriter,
  );
  const ctx = {
    requestId: 'r',
    correlationId: 'c',
    ip: '',
    userAgent: '',
    principal: { type: 'user', id: 'u-1', tenantId: TENANT, scopes: [] },
  } as unknown as RequestContext;
  const run = <T>(fn: () => T): T => requestContext.run(ctx, fn);
  return { tx, audit, outbox, service, run };
}

describe('location catalog (tenant sites)', () => {
  it('validates codes as stable kebab-case ids and bounds names', () => {
    expect(CreateLocationSchema.safeParse({ code: 'Ankara HQ', name: 'x' }).success).toBe(false);
    expect(CreateLocationSchema.safeParse({ code: 'ankara-hq', name: '  ' }).success).toBe(false);
    expect(CreateLocationSchema.parse({ code: 'ankara-hq', name: ' Ankara HQ ' }).name).toBe(
      'Ankara HQ',
    );
    expect(LocationListQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
  });

  it('creates a tenant-scoped location with audit and outbox in the request transaction', async () => {
    const { tx, audit, outbox, service, run } = setup(null);
    const dto = await run(() => service.create({ code: 'izmir', name: 'Izmir' }));
    expect(tx.location.create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        tenantId: TENANT,
        code: 'izmir',
        createdBy: 'user:u-1',
      },
    });
    expect(dto.code).toBe('izmir');
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'tenancy.location.created' }),
    );
    expect(outbox.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: 'verbis.tenancy.location.created.v1' }),
    );
  });

  it('rejects a duplicate code without touching the database transaction state', async () => {
    const { tx, audit, service, run } = setup(row());
    await expect(
      run(() => service.create({ code: 'ankara-hq', name: 'Other' })),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(tx.location.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('renames with optimistic locking and audits before/after', async () => {
    const { tx, audit, service, run } = setup(row());
    await run(() => service.update(ID, 1, { name: 'Ankara Campus' }));
    expect(tx.location.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: ID, tenantId: TENANT, deletedAt: null, version: 1 },
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'tenancy.location.updated' }),
    );
    const stale = setup(row({ version: 3 }));
    await expect(
      stale.run(() => stale.service.update(ID, 1, { name: 'x' })),
    ).rejects.toBeInstanceOf(VersionMismatchError);
  });

  it('soft-deletes and 404s for unknown ids', async () => {
    const ok = setup(row());
    await ok.run(() => ok.service.remove(ID, 1));
    expect(ok.audit.record).toHaveBeenCalledWith(
      ok.tx,
      expect.objectContaining({ action: 'tenancy.location.deleted', after: null }),
    );
    const missing = setup(null);
    await expect(missing.run(() => missing.service.remove(ID, 1))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('searches by name or code on the server and paginates by keyset', async () => {
    const { tx, service, run } = setup();
    const page = await run(() =>
      service.list(LocationListQuerySchema.parse({ q: 'ank', limit: 1 })),
    );
    expect(page.data).toHaveLength(1);
    expect(tx.location.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        tenantId: TENANT,
        deletedAt: null,
        OR: [
          { name: { contains: 'ank', mode: 'insensitive' } },
          { code: { contains: 'ank', mode: 'insensitive' } },
        ],
      },
    });
  });
});
