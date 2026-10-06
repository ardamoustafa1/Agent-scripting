import { Inject, Injectable } from '@nestjs/common';

import { DomainEventHandler } from '../infra/events/event-consumers.service.js';
import { AuditService } from '../modules/audit/audit.service.js';

import type { TransactionClient } from '../infra/database/prisma.service.js';
import type { EventHandler } from '../infra/events/event-consumer.js';
import type { EventEnvelope } from '../infra/outbox/outbox.types.js';
import type { AuditActor } from '../modules/audit/core/audit-event.js';

/** `user:<id>` / `service:<id>` / `connector:<id>` / anything else → system. */
export function actorFromRef(ref: string): AuditActor {
  const [kind, ...rest] = ref.split(':');
  const id = rest.join(':');
  if (kind === 'user' && id !== '') return { type: 'user', id };
  if (kind === 'service' && id !== '') return { type: 'apiClient', id };
  if (kind === 'connector' && id !== '') return { type: 'connector', id };
  return { type: 'system', id: ref === '' ? 'unknown' : ref };
}

/** `verbis.campaigns.campaign.created.v1` → `campaigns.campaign.created`. */
export function actionFromSubject(subject: string): string {
  const parts = subject.split('.');
  return parts.slice(1, 4).join('.');
}

/**
 * Safety net: every domain event whose originating request did NOT write an audit event (same
 * tenant + correlationId) is audited automatically — connector, system and job-originated changes
 * never stay invisible. Idempotent through the processed_events dedupe of the processor.
 */
@DomainEventHandler()
@Injectable()
export class DomainEventAuditHandler implements EventHandler {
  readonly name = 'audit-domain-events';
  readonly stream = 'DOMAIN';
  readonly filterSubjects = ['verbis.>'];
  readonly maxDeliver = 20;

  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async handle(event: EventEnvelope, tx: TransactionClient): Promise<void> {
    const audited = await tx.$queryRaw<{ found: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM audit_events WHERE tenant_id = ${event.tenantId}::uuid AND correlation_id = ${event.correlationId}
      ) AS found`;
    if (audited[0]?.found === true) return;
    await this.audit.recordMany(
      tx,
      [
        {
          action: actionFromSubject(event.type),
          target: { type: event.aggregate.type, id: event.aggregate.id },
          actor: actorFromRef(event.actor),
          occurredAt: new Date(event.occurredAt),
          metadata: { source: 'domain-event', eventId: event.id, eventType: event.type },
        },
      ],
      { tenantId: event.tenantId },
    );
  }
}
