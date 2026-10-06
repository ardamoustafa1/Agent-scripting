import { z } from 'zod';

import { AdminQuotaSchema } from '@verbis/shared-types';

import { ConflictError } from '../../common/errors/domain-errors.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
/** Serialize capacity allocation with tenant policy updates; caller owns the audit transaction. */
export async function reserveTenantCapacity(
  tx: TransactionClient,
  tenantId: string,
  resource: 'users' | 'scripts',
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
      : await tx.script.count({ where: { tenantId, deletedAt: null } });
  const limit = resource === 'users' ? locked.maxUsers : locked.maxScripts;
  if (count >= limit) throw new ConflictError(`Tenant ${resource} quota reached`);
}

/** A short independent transaction reserves a future session id. Failed launches expire after
 * two minutes; successful INSERT consumes the lease in the same transaction as the session.
 * The request transaction is capped at 15s, safely below the lease lifetime. */
export async function reserveSessionCapacity(
  db: TenantDb,
  tenantId: string,
  sessionId: string,
): Promise<void> {
  await db.run(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<{ settings: unknown }[]>`
      SELECT settings FROM tenants WHERE id=${tenantId}::uuid FOR NO KEY UPDATE`;
    const policy = z.object({ quotas: AdminQuotaSchema.optional() }).safeParse(rows[0]?.settings);
    if (!policy.success) throw new ConflictError('Tenant quota policy is invalid');
    if (!policy.data.quotas) return;
    await tx.sessionCapacityReservation.deleteMany({
      where: { tenantId, expiresAt: { lte: new Date() } },
    });
    // Both sides of consumption are counted from ONE MVCC snapshot (not two count queries).
    const [capacity] = await tx.$queryRaw<{ used: bigint }[]>`
      SELECT (
        (SELECT count(*) FROM sessions WHERE tenant_id=${tenantId}::uuid AND deleted_at IS NULL
          AND state IN ('launching','active','paused','wrapup')) +
        (SELECT count(*) FROM session_capacity_reservations WHERE tenant_id=${tenantId}::uuid)
      ) AS used`;
    if (!capacity || capacity.used >= BigInt(policy.data.quotas.maxActiveSessions))
      throw new ConflictError('Tenant sessions quota reached');
    await tx.sessionCapacityReservation.create({
      data: { id: sessionId, tenantId, expiresAt: new Date(Date.now() + 120000) },
    });
  });
}
