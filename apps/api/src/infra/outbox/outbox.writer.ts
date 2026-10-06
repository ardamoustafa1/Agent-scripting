import { Injectable } from '@nestjs/common';
import { context as otelContext, propagation } from '@opentelemetry/api';

import { requestContext } from '../../common/context/request-context.js';
import { actorRef } from '../../common/security/principal.js';

import { EVENT_SUBJECT, type DomainEventInput } from './outbox.types.js';

import type { Prisma } from '../../generated/prisma/client.js';
import type { TransactionClient } from '../database/prisma.service.js';

/**
 * Records domain events in the transactional outbox, inside the caller's transaction, so an
 * event exists if and only if the state change committed (ADR-0005).
 */
@Injectable()
export class OutboxWriter {
  async record(tx: TransactionClient, event: DomainEventInput): Promise<string> {
    if (!EVENT_SUBJECT.test(event.type)) throw new Error(`Invalid event subject: ${event.type}`);
    const ctx = requestContext.require();
    if (ctx.principal === undefined) throw new Error('Domain events require a principal');
    // W3C trace context travels with the event so consumers join the same trace.
    const carrier: Record<string, string> = {};
    propagation.inject(otelContext.active(), carrier);
    const row = await tx.outboxEvent.create({
      data: {
        tenantId: ctx.principal.tenantId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.type,
        payload: event.payload as Prisma.InputJsonObject,
        headers: { ...carrier, correlationId: ctx.correlationId },
        createdBy: actorRef(ctx.principal),
      },
      select: { id: true },
    });
    return row.id;
  }
}
