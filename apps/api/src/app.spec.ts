import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { testEnv } from '../test/support/env.js';
import { createTokenKit, type TokenKit } from '../test/support/tokens.js';

import { createApp } from './bootstrap.js';
import { createLogger } from './common/logging/logger.js';
import { DatabaseProbe } from './infra/database/prisma.service.js';
import { TenantDb } from './infra/database/tenant-db.js';
import { MessagingProbe } from './infra/nats/nats.service.js';
import { CacheProbe } from './infra/redis/redis.service.js';

import type { ApiEnv } from './env.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const TENANT = '01928f3a-0000-7000-8000-000000000001';
const USER = '01928f3a-0000-7000-8000-000000000101';

const probe = (healthy: boolean) => ({
  ping: () => (healthy ? Promise.resolve() : Promise.reject(new Error('down'))),
});

let kit: TokenKit;
let app: NestFastifyApplication | undefined;

beforeAll(async () => {
  kit = await createTokenKit();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(
  options: {
    healthy?: Partial<Record<'db' | 'redis' | 'nats', boolean>>;
    env?: Record<string, string>;
    origins?: string[];
  } = {},
) {
  const env: ApiEnv = testEnv(kit.jwks, { RATE_LIMIT_MAX: '5', ...options.env });
  app = await createApp(env, {
    logger: createLogger('fatal'),
    inMemoryRateLimit: true,
    originPolicy: {
      isAllowed: (origin) => Promise.resolve((options.origins ?? []).includes(origin)),
    },
    configure: (module) => {
      module.providers = [
        ...(module.providers ?? []),
        { provide: DatabaseProbe, useValue: probe(options.healthy?.db ?? true) },
        { provide: CacheProbe, useValue: probe(options.healthy?.redis ?? true) },
        { provide: MessagingProbe, useValue: probe(options.healthy?.nats ?? true) },
      ];
    },
  });
  if (options.env?.['API_DOCS'] === 'admin') {
    vi.spyOn(app.get(TenantDb), 'run').mockImplementation(async (_tenant, operation) =>
      operation({
        tenant: { findFirst: () => Promise.resolve({ settings: {} }) },
      } as unknown as Parameters<typeof operation>[0]),
    );
  }
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('health', () => {
  it('live is ok without dependency checks', async () => {
    const res = await (
      await start({ healthy: { db: false } })
    ).inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      service: 'verbis-api',
      version: '1.2.3',
      checks: {},
    });
  });

  it('ready reports every dependency', async () => {
    const res = await (await start()).inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'ok',
      checks: { database: { status: 'up' }, redis: { status: 'up' }, nats: { status: 'up' } },
    });
  });

  it.each(['db', 'redis', 'nats'] as const)('returns 503 when %s is down', async (dependency) => {
    const res = await (
      await start({ healthy: { [dependency]: false } })
    ).inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'error' });
  });
});

describe('cross-cutting HTTP behaviour', () => {
  it('requires a valid internal token (RFC 7807 401)', async () => {
    const api = await start();
    for (const authorization of [
      undefined,
      'Basic abc',
      'Bearer not.a.jwt',
      `Bearer ${await (await createTokenKit()).sign({ sub: USER, tnt: TENANT })}`,
    ]) {
      const res = await api.inject({
        method: 'GET',
        url: '/v1/campaigns',
        headers: authorization === undefined ? {} : { authorization },
      });
      expect(res.statusCode).toBe(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.headers['www-authenticate']).toBe('Bearer');
      expect(res.json()).toMatchObject({
        code: 'VERBIS_AUTH_UNAUTHENTICATED',
        instance: '/v1/campaigns',
      });
    }
  });

  it('echoes valid correlation ids, replaces unsafe ones, and always sets a request id', async () => {
    const api = await start();
    const ok = await api.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-correlation-id': 'corr-123' },
    });
    expect(ok.headers['x-correlation-id']).toBe('corr-123');
    expect(ok.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const forged = await api.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-correlation-id': 'a\nfake log line' },
    });
    expect(forged.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets security headers (helmet)', async () => {
    const res = await (await start()).inject({ method: 'GET', url: '/health/live' });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns RFC 7807 404s without echoing the query string', async () => {
    const res = await (
      await start()
    ).inject({
      method: 'GET',
      url: '/nope?token=secret',
      headers: { 'x-correlation-id': 'corr-1' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      code: 'VERBIS_HTTP_NOT_FOUND',
      instance: '/nope',
      correlationId: 'corr-1',
    });
    expect(res.body).not.toContain('secret');
  });

  it('maps body-parser errors to problems', async () => {
    const api = await start();
    const res = await api.inject({
      method: 'POST',
      url: '/v1/campaigns',
      headers: { 'content-type': 'application/json' },
      payload: '{bad',
    });
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect([400, 401]).toContain(res.statusCode);
  });

  it('allows only allow-listed CORS origins, with credentials', async () => {
    const api = await start({ origins: ['https://acme.example'] });
    const allowed = await api.inject({
      method: 'OPTIONS',
      url: '/v1/campaigns',
      headers: { origin: 'https://acme.example', 'access-control-request-method': 'POST' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://acme.example');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const denied = await api.inject({
      method: 'OPTIONS',
      url: '/v1/campaigns',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate limits per principal or IP with a problem response', async () => {
    const api = await start({ env: { RATE_LIMIT_MAX: '2' } });
    const statuses: number[] = [];
    let last;
    for (let i = 0; i < 3; i += 1) {
      last = await api.inject({ method: 'GET', url: '/v1/campaigns' });
      statuses.push(last.statusCode);
    }
    expect(statuses).toEqual([401, 401, 429]);
    expect(last?.headers['content-type']).toContain('application/problem+json');
    expect(last?.json()).toMatchObject({ code: 'VERBIS_HTTP_RATE_LIMITED' });
    expect(last?.headers['retry-after']).toBeDefined();
    // Health probes are never limited.
    expect((await api.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200);
  });
});

describe('API docs', () => {
  it('serves OpenAPI 3.1 publicly in development', async () => {
    const api = await start({ env: { NODE_ENV: 'development' } });
    const json = await api.inject({ method: 'GET', url: '/api/docs/json' });
    expect(json.statusCode).toBe(200);
    expect(json.json()).toMatchObject({ openapi: '3.1.0', info: { title: 'Verbis API' } });
    const ui = await api.inject({ method: 'GET', url: '/api/docs' });
    expect([200, 302]).toContain(ui.statusCode);
  });

  it('requires an authenticated principal in admin mode', async () => {
    const api = await start({ env: { API_DOCS: 'admin' } });
    const res = await api.inject({ method: 'GET', url: '/api/docs/json' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'VERBIS_AUTH_UNAUTHENTICATED' });
    const scoped = await kit.sign({
      sub: 'ops',
      tnt: TENANT,
      typ: 'service',
      scp: ['read:ApiDocs'],
    });
    expect(
      (
        await api.inject({
          method: 'GET',
          url: '/api/docs/json',
          headers: { authorization: `Bearer ${scoped}` },
        })
      ).statusCode,
    ).toBe(200);
    const unscoped = await kit.sign({ sub: 'ops', tnt: TENANT, typ: 'service', scp: [] });
    expect(
      (
        await api.inject({
          method: 'GET',
          url: '/api/docs/json',
          headers: { authorization: `Bearer ${unscoped}` },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('can be turned off', async () => {
    const res = await (
      await start({ env: { API_DOCS: 'off' } })
    ).inject({ method: 'GET', url: '/api/docs/json' });
    expect(res.statusCode).toBe(404);
  });
});
