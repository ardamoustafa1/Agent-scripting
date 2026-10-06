import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createHub } from './bootstrap.js';
import { loadHubEnv } from './env.js';
import { EventPipeline } from './runtime/event-pipeline.js';
import { FakeVerbisApi } from './test/fake-api.js';

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createHub(
    loadHubEnv({ APP_VERSION: '9.9.9', LOG_LEVEL: 'fatal' }),
    { api: new FakeVerbisApi(), autoStart: false },
    false,
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

describe('connector-hub', () => {
  it('GET / says hello and lists supported adapters', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: 'verbis-connector-hub', message: 'hello' });
  });

  it.each([
    ['/health/live', {}],
    ['/health/ready', { queue: { status: 'up' } }],
  ])('GET %s is ok', async (url, checks) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      service: 'verbis-connector-hub',
      version: '9.9.9',
      checks,
    });
  });

  it('removes a full delivery queue from readiness without failing liveness', async () => {
    const pipeline = app.get(EventPipeline);
    const stats = pipeline.stats();
    const spy = vi.spyOn(pipeline, 'stats').mockReturnValue({ ...stats, depth: stats.capacity });
    try {
      const ready = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(ready.statusCode).toBe(503);
      expect(ready.json()).toMatchObject({ checks: { queue: { status: 'down' } } });
      const live = await app.inject({ method: 'GET', url: '/health/live' });
      expect(live.statusCode).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });

  it('errors are RFC 7807', async () => {
    const res = await app.inject({ method: 'POST', url: '/health/live' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('requires a durable dead-letter queue in production', () => {
    expect(() => loadHubEnv({ NODE_ENV: 'production' })).toThrow(/HUB_DLQ_NATS_URL/);
    expect(() =>
      loadHubEnv({ NODE_ENV: 'production', HUB_DLQ_NATS_URL: 'http://nats:4222' }),
    ).toThrow(/HUB_DLQ_NATS_URL/);
    const env = loadHubEnv({
      NODE_ENV: 'production',
      HUB_DLQ_NATS_URL: 'tls://nats-1:4222, tls://nats-2:4222',
    });
    expect(env.HUB_DLQ_NATS_URL).toEqual(['tls://nats-1:4222', 'tls://nats-2:4222']);
    expect(env.HUB_DLQ_STREAM).toBe('VERBIS_HUB_DLQ');
    expect(loadHubEnv({ HUB_DLQ_NATS_URL: '' }).HUB_DLQ_NATS_URL).toBeUndefined();
  });

  it('rejects an invalid port', () => {
    expect(() => loadHubEnv({ CONNECTOR_HUB_PORT: '70000' })).toThrow(/CONNECTOR_HUB_PORT/);
  });
});
