import cors from '@fastify/cors';

import type { FastifyInstance } from 'fastify';

/** Decides whether a browser origin may call the API (no wildcards, credentials allowed). */
export interface OriginPolicy {
  isAllowed(origin: string): Promise<boolean>;
}

/** Static allow-list from env plus per-tenant `settings.allowedOrigins` (cached lookups). */
export class TenantOriginPolicy implements OriginPolicy {
  readonly #cache = new Map<string, { allowed: boolean; expires: number }>();

  constructor(
    private readonly staticOrigins: readonly string[],
    private readonly lookup: (origin: string) => Promise<boolean>,
    private readonly ttlMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  async isAllowed(origin: string): Promise<boolean> {
    if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(origin)) return false;
    if (this.staticOrigins.includes(origin)) return true;
    const hit = this.#cache.get(origin);
    if (hit !== undefined && hit.expires > this.now()) return hit.allowed;
    let allowed = false;
    try {
      allowed = await this.lookup(origin);
    } catch {
      allowed = false;
    }
    if (this.#cache.size > 10_000) this.#cache.clear();
    this.#cache.set(origin, { allowed, expires: this.now() + this.ttlMs });
    return allowed;
  }
}

export async function registerCors(app: FastifyInstance, policy: OriginPolicy): Promise<void> {
  await app.register(cors, {
    // Requests without Origin (server-to-server, curl) are not CORS requests.
    origin: (origin, callback) => {
      if (origin === undefined) {
        callback(null, true);
        return;
      }
      policy.isAllowed(origin).then(
        (allowed) => {
          callback(null, allowed);
        },
        () => {
          callback(null, false);
        },
      );
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'content-type',
      'authorization',
      'idempotency-key',
      'if-match',
      'x-correlation-id',
      'accept-language',
      'x-csrf-token',
      'traceparent',
      'tracestate',
    ],
    exposedHeaders: [
      'x-correlation-id',
      'x-request-id',
      'etag',
      'location',
      'idempotent-replayed',
      'retry-after',
      'ratelimit-limit',
      'ratelimit-remaining',
      'ratelimit-reset',
    ],
    maxAge: 600,
    strictPreflight: true,
  });
}
