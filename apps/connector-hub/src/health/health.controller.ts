import { Controller, Get, Inject, Res } from '@nestjs/common';

import { aggregateHealth, type HealthStatus } from '@verbis/shared-types';

import { type HubEnv, HUB_ENV } from '../env.js';
import { EventPipeline } from '../runtime/event-pipeline.js';

import type { FastifyReply } from 'fastify';

const SERVICE = 'verbis-connector-hub';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(HUB_ENV) private readonly env: HubEnv,
    @Inject(EventPipeline) private readonly pipeline: EventPipeline,
  ) {}

  @Get()
  health(): HealthStatus {
    return this.live();
  }

  @Get('live')
  live(): HealthStatus {
    return aggregateHealth(SERVICE, this.env.APP_VERSION, {});
  }

  /**
   * Ready while the delivery queue has room. Individual connector outages do not make the hub
   * unready (they reconnect on their own; see GET /internal/v1/connectors).
   */
  @Get('ready')
  ready(@Res({ passthrough: true }) reply: FastifyReply): HealthStatus {
    const stats = this.pipeline.stats();
    const full = stats.depth >= stats.capacity;
    if (full) void reply.status(503);
    return aggregateHealth(SERVICE, this.env.APP_VERSION, {
      queue: full ? { status: 'down', detail: 'delivery queue full' } : { status: 'up' },
    });
  }
}
