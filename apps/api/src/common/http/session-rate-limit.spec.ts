import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { registerRateLimit } from './rate-limit.js';
import {
  MemoryCounterStore,
  RedisCounterStore,
  SessionRateLimiter,
  type CounterStore,
} from './session-rate-limit.js';

import type { Redis } from 'ioredis';

const WINDOW = 60_000;
const limits = { ipMax: 5, sessionMax: 2, anonymousMax: 3, windowMs: WINDOW };
function make(now: { t: number }, store: CounterStore = new MemoryCounterStore()) {
  return new SessionRateLimiter({ ...limits, store, clock: { now: () => now.t } });
}

describe('SessionRateLimiter', () => {
  it('limits per session independently of other sessions on the same IP', async () => {
    const clock = { t: 0 };
    const limiter = make(clock);
    for (let i = 0; i < 2; i++)
      expect((await limiter.check({ ip: '10.0.0.1', session: 'aaa' })).allowed).toBe(true);
    const blocked = await limiter.check({ ip: '10.0.0.1', session: 'aaa' });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
    expect((await limiter.check({ ip: '10.0.0.1', session: 'bbb' })).allowed).toBe(true);
  });
  it('caps a shared IP across many sessions generously, not at 20', async () => {
    const clock = { t: 0 };
    const limiter = make(clock);
    for (let i = 0; i < 5; i++)
      expect((await limiter.check({ ip: '10.0.0.2', session: `s${i}` })).allowed).toBe(true);
    const blocked = await limiter.check({ ip: '10.0.0.2', session: 's9' });
    expect(blocked).toMatchObject({ allowed: false, scope: 'ip' });
  });
  it('limits cookie-less requests per IP with the anonymous budget', async () => {
    const limiter = make({ t: 0 });
    for (let i = 0; i < 3; i++)
      expect((await limiter.check({ ip: '10.0.0.3' })).allowed).toBe(true);
    expect(await limiter.check({ ip: '10.0.0.3' })).toMatchObject({
      allowed: false,
      scope: 'anonymous',
    });
  });
  it('resets exactly at the window boundary and reports remaining retry time', async () => {
    const clock = { t: 10_000 };
    const limiter = make(clock);
    for (let i = 0; i < 2; i++) await limiter.check({ ip: '1.1.1.1', session: 'x' });
    clock.t = WINDOW - 1;
    const blocked = await limiter.check({ ip: '1.1.1.1', session: 'x' });
    expect(blocked).toMatchObject({ allowed: false, retryAfterSeconds: 1 });
    clock.t = WINDOW;
    expect((await limiter.check({ ip: '1.1.1.1', session: 'x' })).allowed).toBe(true);
  });
  it('never exceeds the budget for any request interleaving (property)', async () => {
    for (let seed = 1; seed <= 50; seed++) {
      const clock = { t: 0 };
      const limiter = make(clock);
      let state = seed;
      const allowedBySession = new Map<string, number>();
      for (let i = 0; i < 60; i++) {
        state = (state * 1103515245 + 12345) % 2147483648;
        const session = `s${state % 3}`;
        const result = await limiter.check({ ip: `9.9.9.${seed}`, session });
        if (result.allowed) allowedBySession.set(session, (allowedBySession.get(session) ?? 0) + 1);
      }
      for (const count of allowedBySession.values()) expect(count).toBeLessThanOrEqual(2);
    }
  });
  it('propagates store failures (fail closed)', async () => {
    const limiter = make(
      { t: 0 },
      {
        increment: () => Promise.reject(new Error('redis down')),
      },
    );
    await expect(limiter.check({ ip: '1.1.1.1', session: 'x' })).rejects.toThrow('redis down');
  });
});

describe('counter stores', () => {
  it('memory store prunes expired buckets', async () => {
    const clock = { t: 0 };
    const store = new MemoryCounterStore(() => clock.t);
    expect(await store.increment('a', 100)).toBe(1);
    expect(await store.increment('a', 100)).toBe(2);
    clock.t = 101;
    expect(await store.increment('a', 100)).toBe(1);
  });
  it('redis store increments and sets the expiry on first hit only', async () => {
    const calls: string[] = [];
    let count = 0;
    const redis = {
      multi: () => ({
        incr: (k: string) => {
          calls.push(`incr ${k}`);
          count += 1;
          return {
            pexpire: (_k: string, ms: number) => ({
              exec: () => {
                calls.push(`pexpire ${ms}`);
                return Promise.resolve([
                  [null, count],
                  [null, 1],
                ]);
              },
            }),
          };
        },
      }),
    } as unknown as Redis;
    const store = new RedisCounterStore(redis);
    expect(await store.increment('k', 1000)).toBe(1);
    expect(await store.increment('k', 1000)).toBe(2);
    expect(calls).toContain('pexpire 1000');
  });
  it('redis store rejects malformed replies', async () => {
    const redis = {
      multi: () => ({ incr: () => ({ pexpire: () => ({ exec: () => Promise.resolve(null) }) }) }),
    } as unknown as Redis;
    await expect(new RedisCounterStore(redis).increment('k', 1)).rejects.toThrow();
  });
});

describe('GET /auth/session HTTP behaviour', () => {
  async function app(extra: { trustProxy?: string[] } = {}) {
    const fastify = Fastify({ trustProxy: extra.trustProxy ?? false });
    await registerRateLimit(fastify, {
      max: 1000,
      windowMs: WINDOW,
      sessionCookieName: 'verbis_session',
      authSession: limits,
      clock: { now: () => 0 },
    });
    fastify.get('/auth/session', () => Promise.resolve({ ok: true }));
    fastify.get('/auth/session/status', () => Promise.resolve({ ok: true }));
    fastify.post('/auth/logout', () => Promise.resolve({ ok: true }));
    return fastify;
  }
  const get = (
    a: Awaited<ReturnType<typeof app>>,
    cookie?: string,
    headers = {},
    remoteAddress = '203.0.113.9',
  ) =>
    a.inject({
      method: 'GET',
      url: '/auth/session',
      remoteAddress,
      headers: { ...(cookie ? { cookie: `verbis_session=${cookie}` } : {}), ...headers },
    });
  it('is no longer in the 20/min sensitive group: many sessions share an IP', async () => {
    const a = await app();
    try {
      for (let i = 0; i < 5; i++) expect((await get(a, `tok${i}`)).statusCode).toBe(200);
    } finally {
      await a.close();
    }
  });
  it('applies the same session budget to the non-401 probe /auth/session/status (U-01)', async () => {
    const a = await app();
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 3; i++)
        statuses.push(
          (
            await a.inject({
              method: 'GET',
              url: '/auth/session/status',
              remoteAddress: '203.0.113.9',
              headers: { cookie: 'verbis_session=same' },
            })
          ).statusCode,
        );
      expect(statuses).toEqual([200, 200, 429]);
    } finally {
      await a.close();
    }
  });
  it('returns 429 with Retry-After once a session exceeds its budget; other sessions are unaffected', async () => {
    const a = await app();
    try {
      await get(a, 'same');
      await get(a, 'same');
      const res = await get(a, 'same');
      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBe('60');
      expect((await get(a, 'other')).statusCode).toBe(200);
    } finally {
      await a.close();
    }
  });
  it('ignores X-Forwarded-For from untrusted peers (no limit evasion)', async () => {
    const a = await app();
    try {
      for (let i = 0; i < 3; i++) await get(a, undefined, { 'x-forwarded-for': `1.2.3.${i}` });
      const res = await get(a, undefined, { 'x-forwarded-for': '1.2.3.99' });
      expect(res.statusCode).toBe(429);
    } finally {
      await a.close();
    }
  });
  it('uses the real client behind a trusted proxy so one office NAT user does not block others', async () => {
    const a = await app({ trustProxy: ['10.0.0.0/8'] });
    try {
      for (let i = 0; i < 4; i++)
        await get(a, undefined, { 'x-forwarded-for': '198.51.100.1' }, '10.0.0.5');
      expect(
        (await get(a, undefined, { 'x-forwarded-for': '198.51.100.1' }, '10.0.0.5')).statusCode,
      ).toBe(429);
      expect(
        (await get(a, undefined, { 'x-forwarded-for': '198.51.100.2' }, '10.0.0.5')).statusCode,
      ).toBe(200);
    } finally {
      await a.close();
    }
  });
  it('keeps login/logout under the strict sensitive limit', async () => {
    const a = await app();
    try {
      for (let i = 0; i < 20; i++)
        expect((await a.inject({ method: 'POST', url: '/auth/logout' })).statusCode).toBe(200);
      expect((await a.inject({ method: 'POST', url: '/auth/logout' })).statusCode).toBe(429);
    } finally {
      await a.close();
    }
  });
});
