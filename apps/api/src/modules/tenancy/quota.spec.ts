import { describe, it, expect, vi } from 'vitest';

import { reserveTenantCapacity } from './quota.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';

const settings = { quotas: { maxUsers: 1, maxScripts: 1, maxActiveSessions: 1 } };
function fixture(count: number) {
  return {
    tenant: { findFirst: vi.fn().mockResolvedValue({ settings }) },
    $queryRaw: vi.fn().mockResolvedValue([{ settings }]),
    user: { count: vi.fn().mockResolvedValue(count) },
    script: { count: vi.fn().mockResolvedValue(count) },
    session: { count: vi.fn().mockResolvedValue(count) },
  };
}
describe('atomic tenant quotas', () => {
  for (const resource of ['users', 'scripts', 'sessions'] as const)
    it(`refuses capacity beyond ${resource} limit after locking tenant policy`, async () => {
      const tx = fixture(1);
      await expect(
        reserveTenantCapacity(tx as unknown as TransactionClient, 'fixture', resource),
      ).rejects.toThrow('quota reached');
      expect(tx.$queryRaw).toHaveBeenCalledOnce();
    });
  it('permits capacity below the limit', async () => {
    await expect(
      reserveTenantCapacity(fixture(0) as unknown as TransactionClient, 'fixture', 'users'),
    ).resolves.toBeUndefined();
  });
  it('leaves an unset quota policy unchanged', async () => {
    const tx = fixture(1000);
    tx.tenant.findFirst.mockResolvedValue({ settings: {} });
    await reserveTenantCapacity(tx as unknown as TransactionClient, 'fixture', 'users');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
