import { Injectable } from '@nestjs/common';

import type { EventCountQuery } from './analytics.dto.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

@Injectable()
export class AnalyticsRepository {
  counts(tx: TransactionClient, tenantId: string, query: EventCountQuery) {
    return tx.analyticsEventCount.findMany({
      where: {
        tenantId,
        ...(query.eventType === undefined ? {} : { eventType: query.eventType }),
        ...(query.from === undefined && query.to === undefined
          ? {}
          : {
              day: {
                ...(query.from === undefined ? {} : { gte: new Date(query.from) }),
                ...(query.to === undefined ? {} : { lte: new Date(query.to) }),
              },
            }),
      },
      orderBy: [{ day: 'asc' }, { eventType: 'asc' }],
      take: 1_000,
      select: { eventType: true, day: true, count: true },
    });
  }
}
