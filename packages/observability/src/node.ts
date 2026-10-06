import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import { monitorEventLoopDelay } from 'node:perf_hooks';

import { FastifyOtelInstrumentation } from '@fastify/otel';
import { metrics } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PrismaInstrumentation } from '@prisma/instrumentation';

import { SafeTraceExporter } from './privacy.js';

/**
 * OpenTelemetry tracing (OTLP/HTTP → collector → Jaeger). Enabled when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set and OTEL_SDK_DISABLED is not "true".
 * Standard OTEL_* variables (service name, sampler, headers) are honoured by the SDK.
 */
export function startTelemetry(
  serviceName: string,
  env: Record<string, string | undefined> = process.env,
): NodeSDK | undefined {
  if (env['OTEL_SDK_DISABLED'] === 'true' || env['OTEL_EXPORTER_OTLP_ENDPOINT'] === undefined)
    return undefined;
  // ESM hooks so instrumentations can patch modules imported after this point.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- OTel's ESM loader (import-in-the-middle) still requires module.register.
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ 'service.instance.id': randomUUID() }),
    serviceName: env['OTEL_SERVICE_NAME'] ?? serviceName,
    traceExporter: new SafeTraceExporter(new OTLPTraceExporter()),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: 15000,
      }),
    ],
    instrumentations: [
      new HttpInstrumentation({
        // Never record query strings (may contain PII) as span attributes.
        ignoreIncomingRequestHook: (request) => request.url?.startsWith('/health') === true,
      }),
      new FastifyOtelInstrumentation({ registerOnInitialization: true }),
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
      new IORedisInstrumentation({ dbStatementSerializer: (command) => command }),
      new PrismaInstrumentation(),
      new UndiciInstrumentation(),
    ],
  });
  sdk.start();
  const meter = metrics.getMeter('verbis.process');
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();
  meter.createObservableGauge('verbis.process.memory', { unit: 'By' }).addCallback((result) => {
    result.observe(process.memoryUsage().rss);
  });
  meter
    .createObservableGauge('verbis.process.event_loop.delay', { unit: 's' })
    .addCallback((result) => {
      result.observe(Number.isFinite(lag.mean) ? lag.mean / 1e9 : 0);
      lag.reset();
    });
  meter.createObservableCounter('verbis.process.cpu', { unit: 's' }).addCallback((result) => {
    const cpu = process.cpuUsage();
    result.observe((cpu.user + cpu.system) / 1e6);
  });
  const shutdown = (): void => {
    lag.disable();
    void sdk.shutdown().catch(() => undefined);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return sdk;
}
