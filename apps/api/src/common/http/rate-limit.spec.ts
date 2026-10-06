import Fastify from 'fastify';
import { expect, it } from 'vitest';

import { registerRateLimit } from './rate-limit.js';

import type { Redis } from 'ioredis';

it('limits API requests without exempting health-prefixed API paths', async () => {
  const app = Fastify();
  try {
    await registerRateLimit(app, { max: 1, windowMs: 60_000 });
    app.get('/health-attacker', () => Promise.resolve({ ok: true }));
    expect((await app.inject('/health-attacker')).statusCode).toBe(200);
    expect((await app.inject('/health-attacker')).statusCode).toBe(429);
  } finally {
    await app.close();
  }
});
it('limits authenticated launch requests by IP independently of the API budget', async () => {
  const app = Fastify();
  try {
    await registerRateLimit(app, { max: 1000, windowMs: 60_000 });
    app.post('/v1/launch/redeem', () => Promise.resolve({ ok: true }));
    for (let i = 0; i < 20; i++)
      expect((await app.inject({ method: 'POST', url: '/v1/launch/redeem' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/v1/launch/redeem' })).statusCode).toBe(429);
  } finally {
    await app.close();
  }
});
it('denies traffic if distributed storage is unavailable', async () => {
  const app = Fastify();
  const unavailable = {
    rateLimit: (...args: unknown[]) => {
      const done = args.at(-1) as (error: Error) => void;
      done(new Error('Redis unavailable'));
    },
    rateLimitRead: () => undefined,
  };
  try {
    await registerRateLimit(app, {
      max: 100,
      windowMs: 60_000,
      redis: unavailable as unknown as Redis,
    });
    app.get('/v1/private', () => Promise.resolve({ accepted: true }));
    expect((await app.inject('/v1/private')).statusCode).toBe(500);
  } finally {
    await app.close();
  }
});
