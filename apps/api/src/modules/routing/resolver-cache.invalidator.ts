import { Inject, Injectable } from '@nestjs/common';

import { DomainEventHandler } from '../../infra/events/event-consumers.service.js';

import { ResolverCache } from './resolver.cache.js';

import type { EventHandler } from '../../infra/events/event-consumer.js';
import type { EventEnvelope } from '../../infra/outbox/outbox.types.js';

/**
 * Invalidates the tenant's resolver snapshots when anything routing-relevant committed
 * (version published/retired, assignment or campaign change, script archived). Runs after commit
 * via the outbox → JetStream path, so readers never cache pre-commit state under the new key.
 */
@DomainEventHandler()
@Injectable()
export class ResolverCacheInvalidator implements EventHandler {
  readonly name = 'routing-resolver-cache';
  readonly stream = 'DOMAIN';
  readonly filterSubjects = ['verbis.scripts.>', 'verbis.assignments.>', 'verbis.campaigns.>'];

  constructor(@Inject(ResolverCache) private readonly cache: ResolverCache) {}

  async handle(event: EventEnvelope): Promise<void> {
    await this.cache.invalidate(event.tenantId);
  }
}
