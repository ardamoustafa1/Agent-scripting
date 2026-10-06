import { Injectable } from '@nestjs/common';

import type { TransactionClient } from '../../infra/database/prisma.service.js';

@Injectable()
export class AdminRepository {
  /** Own-tenant outbox rows only (RLS on outbox_events applies to the app role). */
  async outboxCounts(tx: TransactionClient, tenantId: string) {
    const groups = await tx.outboxEvent.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { _all: true },
    });
    const oldest = await tx.outboxEvent.findFirst({
      where: { tenantId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    const dead = await tx.outboxEvent.findMany({
      where: { tenantId, status: 'dead' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, eventType: true, attempts: true, lastError: true },
    });
    return { groups, oldest: oldest?.createdAt ?? null, dead };
  }

  async requeue(tx: TransactionClient, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<
      { requeued: boolean }[]
    >`SELECT outbox_requeue(${id}::uuid) AS requeued`;
    return rows[0]?.requeued === true;
  }
}
