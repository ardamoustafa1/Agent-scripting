import { expect, it, vi } from 'vitest';

import { AuditRepository } from './audit.repository.js';

import type { StoredAuditRow } from './core/audit-event.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

it('binds every audit filter and both keyset directions as SQL parameters', async () => {
  const queries: { sql: string; values: unknown[] }[] = [];
  const raw = vi.fn((parts: TemplateStringsArray, ...values: unknown[]) => {
    const nested = values.filter(
      (value): value is { sql: string; values: unknown[] } =>
        value !== null && typeof value === 'object' && 'sql' in value,
    );
    queries.push({
      sql: parts.join('?') + nested.map((value) => value.sql).join(' '),
      values: nested.flatMap((value) => value.values),
    });
    return Promise.resolve([]);
  });
  const tx = { $queryRaw: raw } as unknown as TransactionClient,
    repo = new AuditRepository();
  const filters = {
    from: '2026-01-01',
    to: '2027-01-01',
    actorType: 'user',
    actorId: "actor' OR TRUE",
    action: 'script._%\\*',
    resourceType: 'Script',
    resourceId: 'script',
    outcome: 'denied' as const,
    correlationId: 'correlation',
    interactionId: 'interaction',
    q: "value' OR TRUE",
    fromSeq: 1n,
    toSeq: 9n,
  };
  await repo.search(tx, 'tenant', filters, { limit: 20, direction: 'asc', after: 2n });
  expect(queries[0]!.sql).toContain('seq >');
  expect(queries[0]!.sql).not.toContain(filters.actorId);
  expect(queries[0]!.values).toContain(filters.actorId);
  expect(queries[0]!.values).toContain('script.\\_\\%\\\\%');
  await repo.search(
    tx,
    'tenant',
    { action: 'script.created' },
    { limit: 20, direction: 'desc', after: 3n },
  );
  expect(queries[1]!.sql).toContain('seq <');
  expect(queries[1]!.values).toContain('script.created');
  await repo.search(tx, 'tenant', {}, { limit: 1, direction: 'asc' });
});
it('normalizes audit rows while retaining empty, null and absent chain boundaries', async () => {
  const row = {
    seq: 1n,
    hashVersion: 2,
    occurredAt: new Date(0),
    recordedAt: new Date(0),
    hash: 'hash',
  } as StoredAuditRow;
  const raw = vi.fn().mockResolvedValue([row]);
  const tx = { $queryRaw: raw } as unknown as TransactionClient,
    repo = new AuditRepository();
  expect(await repo.findBySeq(tx, 'tenant', 1n)).toMatchObject({ seq: 1n });
  expect(await repo.head(tx, 'tenant')).toEqual({ seq: 1n, hash: 'hash' });
  raw.mockResolvedValue([{ min: 2n }]);
  expect(await repo.minSeq(tx, 'tenant')).toBe(2n);
  raw.mockResolvedValue([{ min: null }]);
  expect(await repo.minSeq(tx, 'tenant')).toBeUndefined();
  raw.mockResolvedValue([]);
  expect(await repo.minSeq(tx, 'tenant')).toBeUndefined();
  expect(await repo.findBySeq(tx, 'tenant', 1n)).toBeUndefined();
  expect(await repo.head(tx, 'tenant')).toBeUndefined();
  expect(await repo.range(tx, 'tenant', 0n, undefined, 20)).toEqual([]);
  expect(await repo.range(tx, 'tenant', 0n, 10n, 20)).toEqual([]);
});
