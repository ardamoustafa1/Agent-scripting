import { expect, it, vi } from 'vitest';

import { requestContext } from '../../common/context/request-context.js';
import { Keyring } from '../identity/crypto/keyring.js';
import { RuntimeCipher } from '../runtime/runtime-cipher.js';

import { AdminPrivacyService } from './privacy.service.js';

import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { AnalyticsStore } from '../analytics/storage.js';
import type { AuditService } from '../audit/audit.service.js';
import type { RuntimeStateStore } from '../runtime/runtime-state.store.js';

const tenant = '01990000-0000-7000-8000-000000000001';
const id = '01990000-0000-7000-8000-000000000002';
const interaction = '01990000-0000-7000-8000-000000000003';
const session = '01990000-0000-7000-8000-000000000004';
const run = <T>(fn: () => T) =>
  requestContext.run(
    {
      requestId: 'synthetic',
      correlationId: 'synthetic',
      ip: '',
      userAgent: 'test',
      principal: { type: 'user', id, tenantId: tenant, scopes: [] },
    },
    fn,
  );
it('creates privacy requests using real tenant-bound encryption rather than plaintext storage', async () => {
  const cipher = new RuntimeCipher(
    new Keyring(`synthetic:${Buffer.alloc(32, 7).toString('base64')}`),
  );
  const raw = vi.fn().mockImplementation((_sql: TemplateStringsArray, ...values: unknown[]) =>
    Promise.resolve([
      {
        id: values[0],
        kind: values[2],
        state: 'pending',
        subject_sealed: values[3],
        matched_ids: [],
        created_at: new Date('2026-10-04T00:00:00Z'),
        version: 1,
      },
    ]),
  );
  const tx = { $queryRaw: raw };
  const record = vi.fn().mockResolvedValue(undefined);
  const service = new AdminPrivacyService(
    {} as AnalyticsStore,
    { tenantId: () => tenant, current: () => tx } as unknown as TenantDb,
    { record } as unknown as AuditService,
    cipher,
    {} as RuntimeStateStore,
  );
  const result = await run(() =>
    service.create({
      kind: 'search',
      subject: 'synthetic-subject',
      reason: 'Synthetic verified request',
      verified: true,
    }),
  );
  expect(result).toMatchObject({ kind: 'search', state: 'pending', count: 0, version: 1 });
  const values = raw.mock.calls[0]!.slice(1) as string[];
  expect(values[3]).not.toContain('synthetic-subject');
  expect(values[4]).not.toContain('Synthetic verified request');
  expect(record).toHaveBeenCalledWith(
    tx,
    expect.objectContaining({
      action: 'admin.privacy.requested',
      metadata: { kind: 'search', identityVerified: true },
    }),
  );
});
function fixture(kind: 'search' | 'export' | 'anonymize' = 'search') {
  const cipher = new RuntimeCipher(
    new Keyring(`synthetic:${Buffer.alloc(32, 8).toString('base64')}`),
  );
  const row = {
    id,
    kind,
    state: 'pending',
    subject_sealed: cipher.seal('synthetic-subject', `runtime:privacy:${tenant}:${id}`),
    matched_ids: [] as string[],
    created_at: new Date('2026-10-04T00:00:00Z'),
    version: 3,
  };
  const sample = {
    id: interaction,
    version: 2,
    status: 'ended',
    channelType: 'voice',
    startedAt: new Date('2026-10-03T00:00:00Z'),
    endedAt: null,
    attributes: {
      sealed: cipher.seal(
        JSON.stringify({
          customerId: 'synthetic-subject',
          ani: 'synthetic-number',
          unrelated: 'private-value',
        }),
        `runtime:interaction:${tenant}:${interaction}`,
      ),
    },
  };
  const raw = vi.fn().mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    if (sql.includes('UPDATE admin_privacy_requests'))
      return Promise.resolve([
        {
          ...row,
          state: 'completed',
          matched_ids: JSON.parse(values[0] as string) as unknown,
          version: 4,
        },
      ]);
    if (sql.includes('SELECT * FROM admin_privacy_requests')) return Promise.resolve([row]);
    return Promise.resolve([]);
  });
  const tx = {
    $queryRaw: raw,
    tenant: { findFirst: vi.fn().mockResolvedValue({ settings: {} }) },
    interaction: {
      findMany: vi.fn().mockResolvedValue([sample]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    session: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([{ id: session }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    outcome: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const analytics = { eraseSessions: vi.fn().mockResolvedValue(undefined) },
    audit = { record: vi.fn().mockResolvedValue(undefined) },
    state = { evict: vi.fn().mockResolvedValue(undefined) };
  const service = new AdminPrivacyService(
    analytics as unknown as AnalyticsStore,
    { tenantId: () => tenant, current: () => tx } as unknown as TenantDb,
    audit as unknown as AuditService,
    cipher,
    state as unknown as RuntimeStateStore,
  );
  return { service, tx, row, sample, cipher, analytics, audit, state };
}
it('lists only public request metadata and completes an exact subject search', async () => {
  const f = fixture();
  expect(await f.service.list()).toEqual([
    {
      id,
      kind: 'search',
      state: 'pending',
      count: 0,
      version: 3,
      createdAt: '2026-10-04T00:00:00.000Z',
    },
  ]);
  const result = await run(() => f.service.process(id, 3));
  expect(result).toMatchObject({ count: 1, state: 'completed', version: 4 });
  expect(f.tx.interaction.updateMany).not.toHaveBeenCalled();
  expect(f.audit.record).toHaveBeenCalledWith(
    f.tx,
    expect.objectContaining({
      action: 'admin.privacy.processed',
      metadata: { kind: 'search', count: 1, immutableAuditPreserved: true },
    }),
  );
});
it('anonymizes terminal interaction data, sessions and outcomes, and evicts cached runtime state', async () => {
  const f = fixture('anonymize');
  expect(await run(() => f.service.process(id, 3))).toMatchObject({ state: 'completed', count: 1 });
  const changed = f.tx.interaction.updateMany.mock.calls[0]![0] as {
    where: unknown;
    data: { attributes: { sealed: string }; participants: unknown[] };
  };
  expect(changed.where).toEqual({ id: interaction, tenantId: tenant, version: 2 });
  expect(
    f.cipher.openString(
      changed.data.attributes.sealed,
      `runtime:interaction:${tenant}:${interaction}`,
    ),
  ).toBe('{}');
  expect(changed.data.participants).toEqual([]);
  expect(f.tx.session.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ variables: {}, version: { increment: 1 } }) as unknown,
    }),
  );
  expect(f.tx.outcome.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ notes: null, sealedData: null, callbackAt: null }) as unknown,
    }),
  );
  expect(f.analytics.eraseSessions).toHaveBeenCalledWith(f.tx, tenant, [session]);
  expect(f.state.evict).toHaveBeenCalledWith(tenant, session);
});
it.each([
  'legalHold',
  'invalidSettings',
  'activeInteraction',
  'activeSession',
  'changedVersion',
  'missingLocked',
  'tooMany',
] as const)('blocks anonymization for %s before destructive writes', async (reason) => {
  const f = fixture('anonymize');
  if (reason === 'legalHold')
    f.tx.tenant.findFirst.mockResolvedValue({ settings: { audit: { legalHold: true } } });
  if (reason === 'invalidSettings') f.tx.tenant.findFirst.mockResolvedValue({ settings: null });
  if (reason === 'activeInteraction') f.sample.status = 'active';
  if (reason === 'activeSession') f.tx.session.count.mockResolvedValue(1);
  if (reason === 'changedVersion')
    f.tx.interaction.findMany
      .mockResolvedValueOnce([f.sample])
      .mockResolvedValueOnce([{ ...f.sample, version: 4 }]);
  if (reason === 'missingLocked')
    f.tx.interaction.findMany.mockResolvedValueOnce([f.sample]).mockResolvedValueOnce([]);
  if (reason === 'tooMany')
    f.tx.interaction.findMany.mockResolvedValue(Array.from({ length: 1001 }, () => f.sample));
  await expect(run(() => f.service.process(id, 3))).rejects.toThrow();
  expect(f.tx.interaction.updateMany).not.toHaveBeenCalled();
  expect(f.tx.session.updateMany).not.toHaveBeenCalled();
  expect(f.analytics.eraseSessions).not.toHaveBeenCalled();
  expect(f.state.evict).not.toHaveBeenCalled();
});
it('requires the optimistic request version, a pending state and a returned update row', async () => {
  const f = fixture();
  await expect(run(() => f.service.process(id, 2))).rejects.toThrow();
  f.row.state = 'completed';
  await expect(run(() => f.service.process(id, 3))).rejects.toThrow('Request already processed');
  f.row.state = 'pending';
  f.tx.$queryRaw.mockResolvedValueOnce([f.row]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  await expect(run(() => f.service.process(id, 3))).rejects.toThrow();
});
it('exports only allowlisted identifiers after completion and audits the export', async () => {
  const f = fixture('export');
  await expect(f.service.export(id)).rejects.toThrow('Completed export request required');
  f.row.state = 'completed';
  f.row.matched_ids = [interaction];
  const result = await f.service.export(id);
  expect(result).toEqual({
    requestId: id,
    records: [
      {
        id: interaction,
        channel: 'voice',
        startedAt: '2026-10-03T00:00:00.000Z',
        endedAt: null,
        customerId: 'synthetic-subject',
        ani: 'synthetic-number',
      },
    ],
  });
  expect(JSON.stringify(result)).not.toContain('private-value');
  expect(f.audit.record).toHaveBeenCalledWith(
    f.tx,
    expect.objectContaining({ action: 'admin.privacy.exported', metadata: { count: 1 } }),
  );
});
it('rejects missing requests and keeps empty searches free of destructive side effects', async () => {
  const f = fixture();
  f.tx.$queryRaw.mockResolvedValueOnce([]);
  await expect(f.service.export(id)).rejects.toThrow('PrivacyRequest not found');
  f.tx.interaction.findMany.mockResolvedValue([]);
  expect(await run(() => f.service.process(id, 3))).toMatchObject({ count: 0, state: 'completed' });
  expect(f.state.evict).not.toHaveBeenCalled();
});
