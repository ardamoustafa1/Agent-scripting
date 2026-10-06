import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../generated/prisma/client.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

const TENANT_SELECT = {
  id: true,
  slug: true,
  name: true,
  region: true,
  status: true,
  settings: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.TenantSelect;

export type TenantRow = Prisma.TenantGetPayload<{ select: typeof TENANT_SELECT }>;

@Injectable()
export class TenancyRepository {
  /** RLS exposes only the current tenant's row; the id filter is the application-level layer. */
  find(tx: TransactionClient, tenantId: string): Promise<TenantRow | null> {
    return tx.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: TENANT_SELECT });
  }

  async updateSettings(
    tx: TransactionClient,
    tenantId: string,
    expectedVersion: number,
    settings: Prisma.InputJsonValue,
    actor: string,
  ): Promise<TenantRow | null> {
    const updated = await tx.tenant.updateMany({
      where: { id: tenantId, version: expectedVersion, deletedAt: null },
      data: { settings, updatedBy: actor, version: { increment: 1 } },
    });
    if (updated.count === 0) return null;
    return this.find(tx, tenantId);
  }
}
