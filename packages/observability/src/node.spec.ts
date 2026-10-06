import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { afterEach, expect, it, vi } from 'vitest';

import { startTelemetry } from './node.js';

const fake = vi.hoisted(() => ({
  start: vi.fn(),
  shutdown: vi.fn().mockResolvedValue(undefined),
  options: undefined as Record<string, unknown> | undefined,
  register: vi.fn(),
  lag: { mean: NaN, enable: vi.fn(), disable: vi.fn(), reset: vi.fn() },
}));
vi.mock('node:module', async (original) => ({
  ...(await original<object>()),
  register: fake.register,
}));
vi.mock('node:perf_hooks', async (original) => ({
  ...(await original<object>()),
  monitorEventLoopDelay: () => fake.lag,
}));
vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: class {
    constructor(options: Record<string, unknown>) {
      fake.options = options;
    }
    start = fake.start;
    shutdown = fake.shutdown;
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});
it('does not create exporters, hooks or signal listeners when telemetry is disabled or unconfigured', () => {
  expect(startTelemetry('api', {})).toBeUndefined();
  expect(
    startTelemetry('api', {
      OTEL_SDK_DISABLED: 'true',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.test',
    }),
  ).toBeUndefined();
  expect(fake.register).not.toHaveBeenCalled();
  expect(fake.start).not.toHaveBeenCalled();
});
it.each([undefined, 'configured-service'])(
  'starts telemetry with bounded process metrics and cleans up each signal (%s)',
  async (name) => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60000 })],
    });
    metrics.setGlobalMeterProvider(provider);
    const oldTerm = new Set(process.listeners('SIGTERM')),
      oldInt = new Set(process.listeners('SIGINT'));
    try {
      const sdk = startTelemetry('api', {
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.test',
        ...(name ? { OTEL_SERVICE_NAME: name } : {}),
      });
      expect(sdk).toBeDefined();
      expect(fake.options?.['serviceName']).toBe(name ?? 'api');
      expect(fake.register).toHaveBeenCalledOnce();
      expect(fake.start).toHaveBeenCalledOnce();
      expect(fake.lag.enable).toHaveBeenCalledOnce();
      const instrumentation = fake.options?.['instrumentations'] as {
        getConfig: () => Record<string, unknown>;
      }[];
      const http = instrumentation[0]?.getConfig()['ignoreIncomingRequestHook'] as (req: {
        url?: string;
      }) => boolean;
      expect(http({ url: '/health/live' })).toBe(true);
      expect(http({ url: '/v1/scripts' })).toBe(false);
      expect(http({})).toBe(false);
      const redis = instrumentation[3]?.getConfig()['dbStatementSerializer'] as (
        command: string,
      ) => string;
      expect(redis('GET')).toBe('GET');
      expect(instrumentation[2]?.getConfig()['enhancedDatabaseReporting']).toBe(false);
      fake.lag.mean = NaN;
      await provider.forceFlush();
      let data = (exporter.getMetrics().at(-1)?.scopeMetrics ?? []).flatMap(
        (scope) => scope.metrics,
      );
      expect(data.map((metric) => metric.descriptor.name).sort()).toEqual([
        'verbis.process.cpu',
        'verbis.process.event_loop.delay',
        'verbis.process.memory',
      ]);
      expect(
        data.find((metric) => metric.descriptor.name === 'verbis.process.event_loop.delay')
          ?.dataPoints[0]?.value,
      ).toBe(0);
      fake.lag.mean = 10_000_000;
      await provider.forceFlush();
      data = (exporter.getMetrics().at(-1)?.scopeMetrics ?? []).flatMap((scope) => scope.metrics);
      expect(
        data.find((metric) => metric.descriptor.name === 'verbis.process.event_loop.delay')
          ?.dataPoints[0]?.value,
      ).toBe(0.01);
      for (const listener of process.listeners('SIGTERM'))
        if (!oldTerm.has(listener)) listener('SIGTERM');
      expect(fake.shutdown).toHaveBeenCalledOnce();
      expect(fake.lag.disable).toHaveBeenCalledOnce();
    } finally {
      for (const listener of process.listeners('SIGTERM'))
        if (!oldTerm.has(listener)) process.removeListener('SIGTERM', listener);
      for (const listener of process.listeners('SIGINT'))
        if (!oldInt.has(listener)) process.removeListener('SIGINT', listener);
      await provider.shutdown();
      metrics.disable();
    }
  },
);
