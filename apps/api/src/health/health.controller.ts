import { Controller, Get, Inject, Res } from '@nestjs/common';
import { z } from 'zod';

import { aggregateHealth, type HealthCheckResult, type HealthStatus } from '@verbis/shared-types';

import { Public } from '../common/security/public.decorator.js';
import { type ApiEnv, API_ENV } from '../env.js';
import { DatabaseProbe } from '../infra/database/prisma.service.js';
import { MessagingProbe } from '../infra/nats/nats.service.js';
import { CacheProbe } from '../infra/redis/redis.service.js';
import { ApiOperation, ApiResponse, ApiTag } from '../openapi/metadata.js';

import type { FastifyReply } from 'fastify';

const SERVICE = 'verbis-api';

const HealthSchema = z
  .object({
    status: z.enum(['ok', 'degraded', 'error']),
    service: z.string(),
    version: z.string(),
    checks: z.record(
      z.string(),
      z.object({ status: z.enum(['up', 'down']), detail: z.string().optional() }),
    ),
  })
  .meta({ id: 'Health' });

async function probe(
  name: string,
  fn: () => Promise<void>,
  timeoutMs = 2_000,
): Promise<HealthCheckResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, timeoutMs);
  });
  try {
    await Promise.race([fn(), timeout]);
    return { status: 'up' };
  } catch {
    return { status: 'down', detail: `${name} unreachable` };
  } finally {
    clearTimeout(timer);
  }
}

@ApiTag('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(DatabaseProbe) private readonly db: DatabaseProbe,
    @Inject(CacheProbe) private readonly cache: CacheProbe,
    @Inject(MessagingProbe) private readonly messaging: MessagingProbe,
  ) {}

  /** Liveness: the process is running. No dependency checks. */
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiResponse(200, 'Process is alive', HealthSchema)
  @Get('live')
  live(): HealthStatus {
    return aggregateHealth(SERVICE, this.env.APP_VERSION, {});
  }

  /** Readiness: all dependencies reachable. 503 when not ready. */
  @ApiOperation({ summary: 'Readiness probe (database, Redis, NATS)' })
  @ApiResponse(200, 'Ready', HealthSchema)
  @ApiResponse(503, 'Not ready', HealthSchema)
  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthStatus> {
    return this.check(reply);
  }

  /** Overall status with per-dependency detail (same semantics as readiness). */
  @ApiOperation({ summary: 'Health summary' })
  @ApiResponse(200, 'Healthy', HealthSchema)
  @ApiResponse(503, 'Unhealthy', HealthSchema)
  @Get()
  async health(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthStatus> {
    return this.check(reply);
  }

  private async check(reply: FastifyReply): Promise<HealthStatus> {
    const [database, redis, nats] = await Promise.all([
      probe('database', () => this.db.ping()),
      probe('redis', () => this.cache.ping()),
      probe('nats', () => this.messaging.ping()),
    ]);
    const status = aggregateHealth(SERVICE, this.env.APP_VERSION, { database, redis, nats });
    if (status.status !== 'ok') void reply.status(503);
    return status;
  }
}
