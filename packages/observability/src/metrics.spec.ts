import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  MeterProvider,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('operational HTTP metrics', () => {
  it('uses route templates and excludes health probes and sensitive query strings', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60000 });
    const provider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(provider);
    const { registerHttpMetrics } = await import('./metrics.js');
    const app = Fastify();
    registerHttpMetrics(app);
    app.get('/v1/sessions/:id', (_req, reply) => reply.code(503).send({}));
    app.get('/health/live', () => ({}));
    try {
      await app.inject('/v1/sessions/private-id?code=secret');
      await app.inject('/health/live');
      await provider.forceFlush();
      const data = JSON.stringify(exporter.getMetrics());
      expect(data).toContain('/v1/sessions/:id');
      expect(data).toContain('5xx');
      expect(data).not.toContain('private-id');
      expect(data).not.toContain('secret');
      expect(data).not.toContain('/health/live');
    } finally {
      await app.close();
      await provider.shutdown();
      metrics.disable();
    }
  });
});

it('all operational instruments emit bounded values; unknown paths use a fixed unmatched label', async () => {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const provider = new MeterProvider({
    readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60000 })],
  });
  metrics.setGlobalMeterProvider(provider);
  const { instruments, registerHttpMetrics } = await import('./metrics.js');
  const app = Fastify();
  registerHttpMetrics(app);
  try {
    for (const name of Object.getOwnPropertyNames(instruments) as (keyof typeof instruments)[]) {
      const instrument = instruments[name];
      if ('add' in instrument) instrument.add(1, { outcome: 'success' });
      else if ('record' in instrument) instrument.record(0.1, { outcome: 'success' });
      else
        instrument.addCallback((result) => {
          result.observe(1, { outcome: 'success' });
        });
    }
    await app.inject('/unknown/private-id?code=private-token');
    await provider.forceFlush();
    const data = JSON.stringify(exporter.getMetrics());
    expect(data).toContain('unmatched');
    expect(data).toContain('4xx');
    for (const name of [
      'verbis.launch.attempts',
      'verbis.runtime.sessions.active',
      'verbis.db.pool.waiting',
      'verbis.writeback.queue.failed',
    ])
      expect(data).toContain(name);
    expect(data).not.toContain('private-');
  } finally {
    await app.close();
    await provider.shutdown();
    metrics.disable();
  }
});
