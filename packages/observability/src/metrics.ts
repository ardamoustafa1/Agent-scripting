import { metrics, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';

import type { FastifyInstance } from 'fastify';

const meter = () => metrics.getMeter('verbis.operations', '1.0.0');
// Only bounded labels: route templates, status classes, protocol, outcome. Never IDs or URLs.
const definitions = {
  requests: () => meter().createCounter('verbis.http.requests'),
  duration: () =>
    meter().createHistogram('verbis.http.duration', {
      unit: 's',
      advice: { explicitBucketBoundaries: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10] },
    }),
  inflight: () => meter().createUpDownCounter('verbis.http.inflight'),
  launch: () => meter().createCounter('verbis.launch.attempts'),
  anomaly: () => meter().createCounter('verbis.launch.anomalies'),
  outbox: () => meter().createCounter('verbis.outbox.events'),
  auditFailures: () => meter().createCounter('verbis.audit.verification.failures'),
  integrations: () => meter().createCounter('verbis.integration.calls'),
  integrationDuration: () => meter().createHistogram('verbis.integration.duration', { unit: 's' }),
  breakerOpen: () => meter().createObservableGauge('verbis.integration.breaker.open'),
  connectorLag: () => meter().createHistogram('verbis.connector.event.lag', { unit: 's' }),
  connectorQueue: () => meter().createObservableGauge('verbis.connector.queue.depth'),
  writebackQueue: () => meter().createObservableGauge('verbis.writeback.queue.depth'),
  writebackFailed: () => meter().createObservableGauge('verbis.writeback.queue.failed'),
  activeSessions: () => meter().createObservableGauge('verbis.runtime.sessions.active'),
  pool: () => meter().createObservableGauge('verbis.db.pool.connections'),
  poolWaiting: () => meter().createObservableGauge('verbis.db.pool.waiting'),
};

// Instantiate only after NodeSDK installs its provider. Module evaluation occurs before startup.
export const instruments = {} as {
  [K in keyof typeof definitions]: ReturnType<(typeof definitions)[K]>;
};
for (const [name, create] of Object.entries(definitions)) {
  let instrument: unknown;
  Object.defineProperty(instruments, name, { get: () => (instrument ??= create()) });
}

export function registerHttpMetrics(app: FastifyInstance): void {
  const starts = new WeakMap<object, number>();
  app.addHook('onRequest', (req, _reply, done) => {
    if (req.url.startsWith('/health')) {
      done();
      return;
    }
    starts.set(req, performance.now());
    instruments.inflight.add(1);
    done();
  });
  app.addHook('onResponse', (req, reply, done) => {
    const start = starts.get(req);
    if (start === undefined) {
      done();
      return;
    }
    starts.delete(req);
    instruments.inflight.add(-1);
    const attributes = {
      route: req.routeOptions.url ?? 'unmatched',
      method: req.method,
      status_class: `${Math.floor(reply.statusCode / 100)}xx`,
    };
    instruments.requests.add(1, attributes);
    instruments.duration.record((performance.now() - start) / 1000, attributes);
    done();
  });
}

/** Deliberately omit exception messages: third-party errors can contain customer data. */
export function inSpan<T>(
  name: string,
  fn: () => Promise<T>,
  kind = SpanKind.INTERNAL,
): Promise<T> {
  return trace.getTracer('verbis.operations').startActiveSpan(name, { kind }, async (span) => {
    try {
      return await fn();
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
