import { Inject, Injectable } from '@nestjs/common';

import { DomainEventHandler } from '../../infra/events/event-consumers.service.js';

import { RuntimeJobsService } from './runtime-jobs.service.js';
import { RuntimeGateway } from './runtime.gateway.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';
import type { EventHandler } from '../../infra/events/event-consumer.js';
import type { EventEnvelope } from '../../infra/outbox/outbox.types.js';

@Injectable()
@DomainEventHandler()
export class RuntimeEventsHandler implements EventHandler {
  readonly name = 'runtime-delivery';
  readonly stream = 'SESSION';
  readonly filterSubjects = [
    'verbis.runtime.session.changed.v1',
    'verbis.runtime.outcome.submitted.v1',
    'verbis.runtime.recording.requested.v1',
  ];
  constructor(
    @Inject(RuntimeGateway) private readonly gateway: RuntimeGateway,
    @Inject(RuntimeJobsService) private readonly jobs: RuntimeJobsService,
  ) {}
  async handle(event: EventEnvelope, tx: TransactionClient): Promise<void> {
    await this.jobs.enqueue(event, tx);
    if (event.type === 'verbis.runtime.session.changed.v1')
      this.gateway.publish(event.tenantId, event.aggregate.id, event.payload);
  }
}
