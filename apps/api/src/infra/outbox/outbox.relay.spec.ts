import { context, propagation, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  backoffMs,
  describeError,
  OutboxRelay,
  type EventPublisher,
  type OutboxStore,
} from './outbox.relay.js';
import { EventEnvelopeSchema, type OutboxRow } from './outbox.types.js';

const exporter = new InMemorySpanExporter();
beforeAll(() => {
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
});
afterAll(() => {
  trace.disable();
  propagation.disable();
  context.disable();
});

const TRACEPARENT = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: '01928f3a-0000-7000-8000-0000000000e1',
    tenant_id: '01928f3a-0000-7000-8000-000000000001',
    aggregate_type: 'Campaign',
    aggregate_id: 'c-1',
    event_type: 'verbis.campaigns.campaign.created.v1',
    payload: { campaign: { id: 'c-1' } },
    headers: { correlationId: 'corr-1', traceparent: TRACEPARENT },
    attempts: 1,
    created_at: new Date('2026-10-01T10:00:00Z'),
    created_by: 'user:u-1',
    ...overrides,
  };
}

function fakes(rows: OutboxRow[], publish: EventPublisher['publish']) {
  const store: OutboxStore & { failed: unknown[][]; published: string[][] } = {
    failed: [],
    published: [],
    claim: vi.fn(() => Promise.resolve(rows)),
    markPublished: vi.fn((ids: readonly string[]) => {
      store.published.push([...ids]);
      return Promise.resolve(ids.length);
    }),
    markFailed: vi.fn((...args: unknown[]) => {
      store.failed.push(args);
      return Promise.resolve();
    }),
  };
  return { store, publisher: { publish: vi.fn(publish) } };
}

const options = {
  batchSize: 10,
  leaseSeconds: 30,
  maxAttempts: 3,
  baseBackoffMs: 1_000,
  maxBackoffMs: 60_000,
  now: () => new Date('2026-10-01T10:00:00Z'),
  random: () => 1,
};

describe('OutboxRelay', () => {
  it('publishes the envelope with dedupe id, tenant headers and trace context', async () => {
    const { store, publisher } = fakes([row()], () => Promise.resolve({ duplicate: false }));
    const result = await new OutboxRelay(store, publisher, options).runOnce();
    expect(result).toEqual({ claimed: 1, published: 1, retried: 0, dead: 0 });
    expect(store.published).toEqual([['01928f3a-0000-7000-8000-0000000000e1']]);

    const [subject, data, publishOptions] = publisher.publish.mock.calls[0] ?? [];
    expect(subject).toBe('verbis.campaigns.campaign.created.v1');
    const envelope = EventEnvelopeSchema.parse(JSON.parse(new TextDecoder().decode(data)));
    expect(envelope).toMatchObject({
      id: row().id,
      tenantId: row().tenant_id,
      correlationId: 'corr-1',
      actor: 'user:u-1',
      occurredAt: '2026-10-01T10:00:00.000Z',
    });
    expect(publishOptions?.msgId).toBe(row().id);
    expect(publishOptions?.headers).toMatchObject({
      'verbis-tenant-id': row().tenant_id,
      'verbis-correlation-id': 'corr-1',
    });

    // The producer span continues the trace of the request that wrote the event.
    const span = exporter.getFinishedSpans().at(-1);
    expect(span?.spanContext().traceId).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(publishOptions?.headers['traceparent']).toContain(span?.spanContext().spanId);
  });

  it('schedules retries with backoff and dead-letters after max attempts', async () => {
    const rows = [
      row({ id: 'a', attempts: 1 }),
      row({ id: 'b', attempts: 3 }),
      row({ id: 'c', attempts: 1, headers: {} }),
    ];
    const { store, publisher } = fakes(rows, (subject, _data, opts) =>
      opts.msgId === 'c'
        ? Promise.resolve({ duplicate: true })
        : Promise.reject(new Error(`nats down for ${subject}`)),
    );
    const result = await new OutboxRelay(store, publisher, options).runOnce();
    expect(result).toEqual({ claimed: 3, published: 1, retried: 1, dead: 1 });
    expect(store.failed).toEqual([
      [
        'a',
        'Error: nats down for verbis.campaigns.campaign.created.v1',
        new Date('2026-10-01T10:00:01.000Z'),
        false,
      ],
      [
        'b',
        'Error: nats down for verbis.campaigns.campaign.created.v1',
        new Date('2026-10-01T10:00:04.000Z'),
        true,
      ],
    ]);
    expect(store.published).toEqual([['c']]);
  });

  it('does nothing on an empty batch', async () => {
    const { store, publisher } = fakes([], () => Promise.resolve({ duplicate: false }));
    expect(
      await new OutboxRelay(store, publisher, {
        ...options,
        now: undefined,
        random: undefined,
      } as never).runOnce(),
    ).toEqual({ claimed: 0, published: 0, retried: 0, dead: 0 });
    expect(store.published).toEqual([]);
  });
});

describe('backoffMs / describeError', () => {
  it('grows exponentially with jitter and caps', () => {
    const settings = { baseBackoffMs: 1_000, maxBackoffMs: 10_000 };
    expect(backoffMs(1, settings, () => 0)).toBe(500);
    expect(backoffMs(3, settings, () => 1)).toBe(4_000);
    expect(backoffMs(20, settings, () => 1)).toBe(10_000);
  });

  it('keeps error text short and payload-free', () => {
    expect(describeError(new TypeError('x'.repeat(1_000))).length).toBe(500);
    expect(describeError({ secret: 'v' })).toBe('Unknown error');
  });
});
