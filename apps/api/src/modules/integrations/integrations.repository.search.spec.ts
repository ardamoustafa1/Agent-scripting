import { expect, it, vi } from 'vitest';

import { DataSourceListQuerySchema } from './integrations.dto.js';
import { IntegrationsRepository } from './integrations.repository.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';

it('binds catalog search with tenant, active-row, protocol and keyset restrictions', async () => {
  const findMany = vi.fn().mockResolvedValue([]);
  const tx = { dataSource: { findMany } } as unknown as TransactionClient;
  await new IntegrationsRepository().listDataSources(
    tx,
    'tenant',
    DataSourceListQuerySchema.parse({ q: ' Customer ', protocol: 'sql', limit: 50 }),
  );
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        tenantId: 'tenant',
        deletedAt: null,
        protocol: 'sql',
        key: { contains: 'Customer', mode: 'insensitive' },
      },
      take: 51,
    }),
  );
  expect(DataSourceListQuerySchema.safeParse({ q: 'x'.repeat(121) }).success).toBe(false);
});
