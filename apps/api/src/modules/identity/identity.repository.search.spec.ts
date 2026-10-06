import { describe, expect, it, vi } from 'vitest';

import { GroupListQuerySchema, UserListQuerySchema } from './identity.dto.js';
import { IdentityRepository } from './identity.repository.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';

// D-17: pickers search on the server instead of filtering the first page client-side.
describe('identity list search (q)', () => {
  const repo = new IdentityRepository();
  const tenant = '019a0000-0000-7000-8000-000000000001';

  it('filters users by case-insensitive displayName or email contains', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await repo.listUsers(
      { user: { findMany } } as unknown as TransactionClient,
      tenant,
      UserListQuerySchema.parse({ q: ' ali ' }),
    );
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        tenantId: tenant,
        OR: [
          { displayName: { contains: 'ali', mode: 'insensitive' } },
          { email: { contains: 'ali', mode: 'insensitive' } },
        ],
      },
    });
  });

  it('filters groups by displayName contains and keeps tenant scope', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await repo.listGroups(
      { group: { findMany } } as unknown as TransactionClient,
      tenant,
      GroupListQuerySchema.parse({ q: 'sales' }),
    );
    const where = JSON.stringify(findMany.mock.calls[0]?.[0]);
    expect(where).toContain('"displayName":{"contains":"sales","mode":"insensitive"}');
    expect(where).toContain(tenant);
  });

  it('rejects empty and oversized search terms', () => {
    expect(UserListQuerySchema.safeParse({ q: '   ' }).success).toBe(false);
    expect(GroupListQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
  });
});
