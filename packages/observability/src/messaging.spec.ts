import { propagation, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { expect, it, vi } from 'vitest';

import { messagingHeaders, consumeMessage } from './messaging.js';
import { inSpan } from './metrics.js';

it('injects trace headers and extracts remote context without passing payload values', async () => {
  const inject = vi.spyOn(propagation, 'inject').mockImplementation((_context, carrier) => {
    (carrier as Record<string, string>)['traceparent'] = 'synthetic-trace';
  });
  const extract = vi.spyOn(propagation, 'extract');
  try {
    const headers = messagingHeaders();
    expect(headers).toEqual({ traceparent: 'synthetic-trace' });
    await expect(consumeMessage(headers, () => Promise.resolve(42))).resolves.toBe(42);
    expect(extract).toHaveBeenCalledWith(expect.anything(), headers);
  } finally {
    inject.mockRestore();
    extract.mockRestore();
  }
});
it('ends successful and failed spans, preserving failure identity without recording customer content', async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  trace.setGlobalTracerProvider(provider);
  const failure = new Error('synthetic-private-customer');
  try {
    await expect(inSpan('integration.execute', () => Promise.resolve('done'))).resolves.toBe(
      'done',
    );
    await expect(
      inSpan('nats.consume', () => Promise.reject(failure), SpanKind.CONSUMER),
    ).rejects.toBe(failure);
    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();
    expect(
      spans.map((span) => ({
        name: span.name,
        kind: span.kind,
        ended: span.ended,
        status: span.status,
      })),
    ).toEqual([
      {
        name: 'integration.execute',
        kind: SpanKind.INTERNAL,
        ended: true,
        status: { code: SpanStatusCode.UNSET },
      },
      {
        name: 'nats.consume',
        kind: SpanKind.CONSUMER,
        ended: true,
        status: { code: SpanStatusCode.ERROR },
      },
    ]);
    expect(spans[1]?.events).toEqual([]);
    expect(spans[1]?.attributes).toEqual({});
  } finally {
    await provider.shutdown();
    trace.disable();
  }
});
