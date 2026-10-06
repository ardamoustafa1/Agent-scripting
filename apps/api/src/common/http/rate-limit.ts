import { createHash } from 'node:crypto';

import rateLimit from '@fastify/rate-limit';

import { cookieValue } from '../../modules/identity/session/session-cookie.js';

import {
  DEFAULT_AUTH_SESSION_LIMITS,
  MemoryCounterStore,
  RedisCounterStore,
  SessionRateLimiter,
  type AuthSessionLimits,
  type Clock,
} from './session-rate-limit.js';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';

export interface RateLimitSettings {
  readonly max: number;
  readonly windowMs: number;
  /** Absent in unit tests: the in-memory store is used. */
  readonly redis?: Redis;
  /** Name of the BFF session cookie (used to key `GET /auth/session` per session). */
  readonly sessionCookieName?: string;
  readonly authSession?: AuthSessionLimits;
  readonly clock?: Clock;
}

const AUTH_SESSION_URL = /^\/auth\/session(?:\/status)?\/?$/;

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
  const authSession = settings.authSession ?? DEFAULT_AUTH_SESSION_LIMITS;
  const limiter = new SessionRateLimiter({
    ...authSession,
    store:
      settings.redis === undefined
        ? new MemoryCounterStore(settings.clock?.now.bind(settings.clock))
        : new RedisCounterStore(settings.redis),
    ...(settings.clock === undefined ? {} : { clock: settings.clock }),
  });
  const cookieName = settings.sessionCookieName ?? 'verbis_session';
  app.addHook('onRoute', (route) => {
    // The SPA probes the session on every page load: it must not share the login/token budget
    // (audit P-18). It has its own per-session + generous per-IP limiter and is exempt below.
    if (AUTH_SESSION_URL.test(route.url)) {
      route.config = { ...route.config, rateLimit: false };
      const guard = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        const token = cookieValue(request.headers.cookie, cookieName);
        const decision = await limiter.check({
          ip: request.ip,
          ...(token === undefined
            ? {}
            : { session: createHash('sha256').update(token).digest('hex').slice(0, 32) }),
        });
        void reply
          .header('ratelimit-limit', String(decision.limit))
          .header('ratelimit-remaining', String(Math.max(0, decision.remaining)));
        if (decision.allowed) return;
        void reply.header('retry-after', String(decision.retryAfterSeconds));
        const error = new Error('Rate limit exceeded') as Error & { statusCode: number };
        error.statusCode = 429;
        throw error;
      };
      const existing = route.onRequest;
      route.onRequest = [
        ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
        guard,
      ];
      return;
    }
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
