import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { DomainEventHandler } from '../../infra/events/event-consumers.service.js';
import { RedisService } from '../../infra/redis/redis.service.js';

import { LaunchGateway } from './launch.gateway.js';
import { LAUNCH_OFFER_SUBJECT, offerKey } from './launch.service.js';

import type { EventHandler } from '../../infra/events/event-consumer.js';
import type { EventEnvelope } from '../../infra/outbox/outbox.types.js';

const OfferSchema = z.object({
  intentId: z.uuid(),
  userId: z.uuid(),
  interactionId: z.uuid(),
  expiresAt: z.iso.datetime({ offset: true }),
});

/** After commit: pushes the code (held ≤ TTL in Redis, consumed once) to the bound user's sockets. */
@Injectable()
@DomainEventHandler()
export class LaunchEventsHandler implements EventHandler {
  readonly name = 'launch-offer-delivery';
  readonly stream = 'SESSION';
  readonly filterSubjects = [LAUNCH_OFFER_SUBJECT];

  constructor(
    @Inject(LaunchGateway) private readonly gateway: LaunchGateway,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  async handle(event: EventEnvelope): Promise<void> {
    const offer = OfferSchema.parse(event.payload);
    if (Date.parse(offer.expiresAt) <= Date.now()) return;
    const code = await this.redis.client.getdel(offerKey(offer.intentId));
    if (code === null) return; // already delivered or expired: idempotent
    this.gateway.offer(event.tenantId, offer.userId, {
      code,
      intentId: offer.intentId,
      interactionId: offer.interactionId,
      expiresAt: offer.expiresAt,
    });
  }
}
