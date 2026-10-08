import { describe, expect, it, vi } from 'vitest';

import { createAbility } from '@verbis/authz';

import { ScriptListQuerySchema } from './scripts.dto.js';
import { ScriptsService } from './scripts.service.js';

import type { ScriptRow } from './scripts.repository.js';

const row = (n: number): ScriptRow =>
  ({
    id: `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`,
    name: `script-${String(n).padStart(3, '0')}`,
    description: null,
    status: 'draft',
    tags: [],
    currentVersionId: null,
    createdAt: new Date(2026, 9, 1, 0, 0, n),
    updatedAt: new Date(2026, 9, 1, 0, 0, n),
    version: 1,
  }) as unknown as ScriptRow;

function setup(rules: Parameters<typeof createAbility>[0], assignments: Record<number, string[]>) {
  const ability = createAbility(rules);
  const authz = {
    can: (action: string, subject: unknown) => ability.can(action as 'read', subject as 'Script'),
    authorize: (action: string, subject: unknown) => {
      if (!ability.can(action as 'read', subject as 'Script')) throw new Error('FORBIDDEN');
    },
  };
  const all = Object.keys(assignments).map(Number);
  const tx = {
    assignment: {
      findMany: vi.fn(({ where }: { where: { scriptId: { in: string[] } | string } }) => {
        const ids = typeof where.scriptId === 'string' ? [where.scriptId] : where.scriptId.in;
        return Promise.resolve(
          ids.flatMap((id) =>
            (assignments[Number(id.slice(-12))] ?? []).map((campaignId) => ({
              scriptId: id,
              campaignId,
            })),
          ),
        );
      }),
    },
    script: { findFirst: vi.fn(() => Promise.resolve({ id: 'x' })) },
  };
  const rows = all.map(row);
  const repository = {
    // Mimics the keyset repository: rows after the cursor, limit + 1 of them.
    list: vi.fn(
      async (_tx: unknown, _tenant: string, query: { limit: number; cursor?: { id: string } }) => {
        const start = query.cursor ? rows.findIndex((r) => r.id === query.cursor?.id) + 1 : 0;
        return Promise.resolve(rows.slice(start, start + query.limit + 1));
      },
    ),
    find: vi.fn((_tx: unknown, _tenant: string, id: string) =>
      Promise.resolve(rows.find((r) => r.id === id) ?? null),
    ),
  };
  const service = new ScriptsService(
    authz as never,
    {} as never,
    {} as never,
    { current: () => tx, tenantId: () => 'tenant' } as never,
    repository as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, repository, rows };
}
const scoped = [
  { action: 'read', subject: 'Script', conditions: { campaignIds: { $in: ['mine'] } } },
];

describe('scripts read scope', () => {
  it('lists only scripts that belong to the caller’s campaigns', async () => {
    const { service } = setup(scoped as never, {
      1: ['mine'],
      2: ['other'],
      3: [],
      4: ['other', 'mine'],
    });
    const page = await service.list(ScriptListQuerySchema.parse({ sort: 'name' }));
    expect(page.data.map((s) => s.name)).toEqual(['script-001', 'script-004']);
  });
  it('shows everything to a caller with unrestricted script access', async () => {
    const { service } = setup([{ action: 'manage', subject: 'all' }] as never, {
      1: [],
      2: ['other'],
    });
    const page = await service.list(ScriptListQuerySchema.parse({ sort: 'name' }));
    expect(page.data).toHaveLength(2);
  });
  it('keeps scanning past a full batch of hidden scripts to fill the page', async () => {
    const assignments: Record<number, string[]> = {};
    for (let n = 1; n <= 150; n++) assignments[n] = n === 150 ? ['mine'] : ['other'];
    const { service, repository } = setup(scoped as never, assignments);
    const page = await service.list(ScriptListQuerySchema.parse({ sort: 'name' }));
    expect(page.data.map((s) => s.name)).toEqual(['script-150']);
    expect(page.page.nextCursor).toBeNull();
    expect(repository.list.mock.calls.length).toBeGreaterThan(1);
  });
  it('refuses a single script outside the caller’s campaigns', async () => {
    const { service, rows } = setup(scoped as never, { 1: ['mine'], 2: ['other'] });
    await expect(service.get(rows[0]!.id)).resolves.toMatchObject({ name: 'script-001' });
    await expect(service.get(rows[1]!.id)).rejects.toThrow('FORBIDDEN');
  });
});
