import { describe, it, expect, vi } from 'vitest';

import { reserveSessionCapacity, reserveTenantCapacity } from './quota.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';

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
  for (const resource of ['users', 'scripts'] as const)
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

it('counts active sessions plus pending reservations inside an independent short transaction', async () => {
  const tx = {
    ...fixture(0),
    sessionCapacityReservation: {
      deleteMany: vi.fn(),
      count: vi.fn().mockResolvedValue(1),
      create: vi.fn(),
    },
  };
  tx.$queryRaw.mockResolvedValueOnce([{ settings }]).mockResolvedValueOnce([{ used: 1n }]);
  const run = vi.fn(async (_tenant: string, work: (client: TransactionClient) => Promise<void>) =>
    work(tx as unknown as TransactionClient),
  );
  await expect(
    reserveSessionCapacity({ run } as unknown as TenantDb, 'tenant', 'session'),
  ).rejects.toThrow('quota reached');
  expect(tx.sessionCapacityReservation.create).not.toHaveBeenCalled();
  expect(run).toHaveBeenCalledOnce();
});
