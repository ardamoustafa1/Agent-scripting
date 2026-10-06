import { z } from 'zod';

import { AdminQuotaSchema } from '@verbis/shared-types';

import { ConflictError } from '../../common/errors/domain-errors.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';
/** Serialize capacity allocation with tenant policy updates; caller owns the audit transaction. */
export async function reserveTenantCapacity(
  tx: TransactionClient,
  tenantId: string,
  resource: 'users' | 'scripts' | 'sessions',
): Promise<void> {
  const tenant = await tx.tenant.findFirst({ where: { id: tenantId }, select: { settings: true } });
  const policy = z.object({ quotas: AdminQuotaSchema.optional() }).safeParse(tenant?.settings);
  if (!policy.success) throw new ConflictError('Tenant quota policy is invalid');
  if (!policy.data.quotas) return;
  const rows = await tx.$queryRaw<
    { settings: unknown }[]
  >`SELECT settings FROM tenants WHERE id=${tenantId}::uuid FOR UPDATE`;
  const locked = z.object({ quotas: AdminQuotaSchema }).parse(rows[0]?.settings).quotas;
  const count =
    resource === 'users'
      ? await tx.user.count({ where: { tenantId, deletedAt: null } })
      : resource === 'scripts'
        ? await tx.script.count({ where: { tenantId, deletedAt: null } })
        : await tx.session.count({
            where: {
              tenantId,
              deletedAt: null,
              state: { in: ['launching', 'active', 'paused', 'wrapup'] },
            },
          });
  const limit =
    resource === 'users'
      ? locked.maxUsers
      : resource === 'scripts'
        ? locked.maxScripts
        : locked.maxActiveSessions;
  if (count >= limit) throw new ConflictError(`Tenant ${resource} quota reached`);
}
