import rateLimit from '@fastify/rate-limit';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';

export interface RateLimitSettings {
  readonly max: number;
  readonly windowMs: number;
  /** Absent in unit tests: the in-memory store is used. */
  readonly redis?: Redis;
}

/** Limits per tenant+principal when authenticated, else per client IP (SECURITY D1). */
export function rateLimitKey(request: FastifyRequest): string {
  const principal = request.principal;
  return principal === undefined
    ? `ip:${request.ip}`
    : `t:${principal.tenantId}:${principal.type}:${principal.id}`;
}

export async function registerRateLimit(
  app: FastifyInstance,
  settings: RateLimitSettings,
): Promise<void> {
  app.addHook('onRoute', (route) => {
    const sensitive = /^\/(?:auth\/|v1\/launch(?:\/|$))/.test(route.url);
    if (sensitive)
      route.config = {
        ...route.config,
        rateLimit: {
          max: 20,
          timeWindow: 60_000,
          keyGenerator: (request: FastifyRequest) => `sensitive:ip:${request.ip}`,
        },
      };
  });
  await app.register(rateLimit, {
    global: true,
    max: settings.max,
    timeWindow: settings.windowMs,
    keyGenerator: rateLimitKey,
    nameSpace: 'rl:',
    ...(settings.redis === undefined ? {} : { redis: settings.redis }),
    // Distributed enforcement must fail closed when its store is unavailable.
    skipOnError: false,
    allowList: (request) =>
      ['/health/live', '/health/ready'].includes(request.url.split('?')[0] ?? ''),
    enableDraftSpec: true,
    errorResponseBuilder: (_request, context) => {
      const error = new Error(`Rate limit exceeded, retry in ${context.after}`) as Error & {
        statusCode: number;
      };
      error.statusCode = context.statusCode;
      return error;
    },
  });
}
