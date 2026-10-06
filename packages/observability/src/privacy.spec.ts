import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { describe, it, expect } from 'vitest';

import { SafeTraceExporter } from './privacy.js';

describe('trace export boundary', () => {
  it('removes sensitive names, SQL, URLs, exception content and preserves correlation before export', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new SafeTraceExporter(exporter))],
    });
    const span = provider.getTracer('test').startSpan('GET /customer/private-id');
    span.setAttributes({
      'http.method': 'GET',
      'http.url': 'https://example.test/?token=private-token',
      'db.statement': "SELECT 'private-value'",
      'customer.email': 'private-email',
    });
    span.recordException(new Error('private-error'));
    const traceId = span.spanContext().traceId;
    span.end();
    await provider.forceFlush();
    const recorded = exporter.getFinishedSpans();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.name).toBe('http.request');
    expect(recorded[0]?.spanContext().traceId).toBe(traceId);
    expect(JSON.stringify(recorded)).not.toContain('private-');
    await provider.shutdown();
  });
});

it.each([
  [{ 'http.route': '/v1/sessions/:id', 'http.request.method': 'POST' }, 'POST /v1/sessions/:id'],
  [{ 'http.route': '/v1/scripts/:id', 'http.method': 'GET' }, 'GET /v1/scripts/:id'],
  [{ 'http.route': '/v1/health' }, 'HTTP /v1/health'],
  [{ 'db.system': 'postgresql' }, 'db.query'],
  [{ 'messaging.system': 'nats' }, 'operation'],
  [{}, 'operation'],
])(
  'keeps bounded attributes and hides unknown operation names: %j',
  async (attributes, expected) => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new SafeTraceExporter(exporter))],
    });
    const span = provider.getTracer('fixture', 'private-version').startSpan('private-name');
    span.setAttributes(attributes);
    span.end();
    await provider.forceFlush();
    expect(exporter.getFinishedSpans()[0]?.name).toBe(expected);
    expect(JSON.stringify(exporter.getFinishedSpans())).not.toContain('private-');
    await provider.shutdown();
  },
);
it('allows reviewed internal operation names and delegates exporter lifecycle including absent flush', async () => {
  const exporter = new InMemorySpanExporter();
  const safe = new SafeTraceExporter(exporter);
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(safe)] });
  provider.getTracer('fixture').startSpan('nats.consume').end();
  await safe.forceFlush();
  expect(exporter.getFinishedSpans()[0]?.name).toBe('nats.consume');
  await provider.shutdown();
  const adapter = new SafeTraceExporter({
    export: () => undefined,
    shutdown: () => Promise.resolve(),
  });
  await expect(adapter.forceFlush()).resolves.toBeUndefined();
  await expect(adapter.shutdown()).resolves.toBeUndefined();
});
