import { Injectable } from '@nestjs/common';

import { DomainEventHandler } from '../../infra/events/event-consumers.service.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';
import type { EventHandler } from '../../infra/events/event-consumer.js';
import type { EventEnvelope } from '../../infra/outbox/outbox.types.js';

/**
 * Counts domain events per tenant, type and UTC day. Runs through the idempotent processor, so a
 * redelivered event is never counted twice.
 */
@DomainEventHandler()
@Injectable()
export class AnalyticsEventCounter implements EventHandler {
  readonly name = 'analytics-event-counter';
  readonly stream = 'DOMAIN';
  readonly filterSubjects = ['verbis.>'];

  async handle(event: EventEnvelope, tx: TransactionClient): Promise<void> {
    const day = new Date(event.occurredAt.slice(0, 10));
    await tx.$executeRaw`
      INSERT INTO analytics_event_counts (tenant_id, event_type, day, count, updated_at)
      VALUES (${event.tenantId}::uuid, ${event.type}, ${day}::date, 1, now())
      ON CONFLICT (tenant_id, event_type, day) DO UPDATE
        SET count = analytics_event_counts.count + 1, updated_at = now()`;
  }
}
