import type { Redis } from 'ioredis';

/** Time source; injected so windows are deterministic in tests. */
export interface Clock {
  now(): number;
}
export const systemClock: Clock = { now: () => Date.now() };

/** Atomic-enough fixed-window counter. */
export interface CounterStore {
  /** Increments `key` and returns the new count; the key expires after `ttlMs`. */
  increment(key: string, ttlMs: number): Promise<number>;
}

export class RedisCounterStore implements CounterStore {
  constructor(private readonly redis: Redis) {}
  async increment(key: string, ttlMs: number): Promise<number> {
    const replies = await this.redis.multi().incr(key).pexpire(key, ttlMs).exec();
    const count = replies?.[0]?.[1];
    if (
      (replies?.[0]?.[0] !== null && replies?.[0]?.[0] !== undefined) ||
      typeof count !== 'number'
    )
      throw new Error('Rate limit store returned an invalid reply');
    return count;
  }
}

/** Single-process fallback (unit tests, no Redis). */
export class MemoryCounterStore implements CounterStore {
  private readonly entries = new Map<string, { count: number; expiresAt: number }>();
  constructor(private readonly now: () => number = () => Date.now()) {}
  increment(key: string, ttlMs: number): Promise<number> {
    const now = this.now();
    for (const [k, v] of this.entries) if (v.expiresAt <= now) this.entries.delete(k);
    const entry = this.entries.get(key) ?? { count: 0, expiresAt: now + ttlMs };
    entry.count += 1;
    this.entries.set(key, entry);
    return Promise.resolve(entry.count);
  }
}

export interface AuthSessionLimits {
  /** Per client IP across all sessions (shared NAT / BFF): generous. */
  readonly ipMax: number;
  /** Per session cookie. */
  readonly sessionMax: number;
  /** Per IP when no session cookie is present (cannot be rotated to dodge the IP cap). */
  readonly anonymousMax: number;
  readonly windowMs: number;
}
export const DEFAULT_AUTH_SESSION_LIMITS: AuthSessionLimits = {
  ipMax: 600,
  sessionMax: 60,
  anonymousMax: 30,
  windowMs: 60_000,
};

export interface SessionLimitDecision {
  readonly allowed: boolean;
  readonly scope?: 'session' | 'anonymous' | 'ip';
  readonly retryAfterSeconds: number;
  readonly limit: number;
  readonly remaining: number;
}

export interface SessionRateLimiterOptions extends AuthSessionLimits {
  readonly store: CounterStore;
  readonly clock?: Clock;
}

/**
 * Rate limit for the SPA's session probe `GET /auth/session`: per session cookie (hash) plus a
 * generous per-IP cap. Fixed windows keyed by `floor(now / windowMs)`; fails closed on store errors.
 */
export class SessionRateLimiter {
  private readonly clock: Clock;
  constructor(private readonly options: SessionRateLimiterOptions) {
    this.clock = options.clock ?? systemClock;
  }

  async check(input: {
    readonly ip: string;
    /** Opaque, already-hashed session identifier (never the raw cookie). */
    readonly session?: string;
  }): Promise<SessionLimitDecision> {
    const { windowMs, store } = this.options;
    const now = this.clock.now();
    const bucket = Math.floor(now / windowMs);
    const retryAfterSeconds = Math.max(1, Math.ceil(((bucket + 1) * windowMs - now) / 1000));
    const ttl = windowMs * 2;
    const primary =
      input.session === undefined
        ? {
            scope: 'anonymous' as const,
            key: `rl:as:a:${input.ip}:${bucket}`,
            max: this.options.anonymousMax,
          }
        : {
            scope: 'session' as const,
            key: `rl:as:s:${input.session}:${bucket}`,
            max: this.options.sessionMax,
          };
    const ipKey = `rl:as:i:${input.ip}:${bucket}`;
    const [primaryCount, ipCount] = await Promise.all([
      store.increment(primary.key, ttl),
      store.increment(ipKey, ttl),
    ]);
    if (primaryCount > primary.max)
      return {
        allowed: false,
        scope: primary.scope,
        retryAfterSeconds,
        limit: primary.max,
        remaining: 0,
      };
    if (ipCount > this.options.ipMax)
      return {
        allowed: false,
        scope: 'ip',
        retryAfterSeconds,
        limit: this.options.ipMax,
        remaining: 0,
      };
    return {
      allowed: true,
      retryAfterSeconds,
      limit: primary.max,
      remaining: Math.min(primary.max - primaryCount, this.options.ipMax - ipCount),
    };
  }
}
