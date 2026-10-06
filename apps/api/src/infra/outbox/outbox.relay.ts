import {
  context as otelContext,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

import { envelopeFromRow, type OutboxRow } from './outbox.types.js';

/** Storage operations of the relay (SQL functions in the tenant_isolation migration). */
export interface OutboxStore {
  claim(limit: number, leaseSeconds: number): Promise<OutboxRow[]>;
  markPublished(ids: readonly string[]): Promise<number>;
  markFailed(id: string, error: string, retryAt: Date, dead: boolean): Promise<void>;
}

export interface EventPublisher {
  publish(
    subject: string,
    data: Uint8Array,
    options: { msgId: string; headers: Record<string, string> },
  ): Promise<{ duplicate: boolean }>;
}

export interface RelayOptions {
  readonly batchSize: number;
  readonly leaseSeconds: number;
  readonly maxAttempts: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly now?: () => Date;
  readonly random?: () => number;
}

export interface RelayResult {
  readonly claimed: number;
  readonly published: number;
  readonly retried: number;
  readonly dead: number;
}

const tracer = trace.getTracer('verbis-api.outbox');
const encoder = new TextEncoder();

/** Exponential backoff with full jitter, capped. */
export function backoffMs(
  attempt: number,
  options: Pick<RelayOptions, 'baseBackoffMs' | 'maxBackoffMs'>,
  random: () => number,
): number {
  const ceiling = Math.min(
    options.maxBackoffMs,
    options.baseBackoffMs * 2 ** Math.max(0, attempt - 1),
  );
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

/** Error text stored on the row: type and short message only, never payload data. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 500);
  return 'Unknown error';
}

/**
 * Moves committed outbox rows to JetStream. At-least-once: a crash after publish but before
 * markPublished re-publishes the event; JetStream drops it as a duplicate within the
 * duplicate window (Nats-Msg-Id = event id) and consumers are idempotent beyond it.
 */
export class OutboxRelay {
  constructor(
    private readonly store: OutboxStore,
    private readonly publisher: EventPublisher,
    private readonly options: RelayOptions,
  ) {}

  async runOnce(): Promise<RelayResult> {
    const rows = await this.store.claim(this.options.batchSize, this.options.leaseSeconds);
    const published: string[] = [];
    let retried = 0;
    let dead = 0;
    const now = this.options.now ?? (() => new Date());
    const random = this.options.random ?? Math.random;

    for (const row of rows) {
      try {
        await this.publishRow(row);
        published.push(row.id);
      } catch (error) {
        const isDead = row.attempts >= this.options.maxAttempts;
        const retryAt = new Date(now().getTime() + backoffMs(row.attempts, this.options, random));
        await this.store.markFailed(row.id, describeError(error), retryAt, isDead);
        if (isDead) dead += 1;
        else retried += 1;
      }
    }
    if (published.length > 0) await this.store.markPublished(published);
    return { claimed: rows.length, published: published.length, retried, dead };
  }

  private async publishRow(row: OutboxRow): Promise<void> {
    const parent = propagation.extract(otelContext.active(), row.headers);
    await tracer.startActiveSpan(
      `${row.event_type} publish`,
      {
        kind: SpanKind.PRODUCER,
        attributes: {
          'messaging.system': 'nats',
          'messaging.destination.name': row.event_type,
          'messaging.message.id': row.id,
          'verbis.tenant_id': row.tenant_id,
        },
      },
      parent,
      async (span) => {
        try {
          const headers: Record<string, string> = {
            'verbis-tenant-id': row.tenant_id,
            'verbis-event-type': row.event_type,
            'verbis-correlation-id': row.headers['correlationId'] ?? row.id,
          };
          propagation.inject(trace.setSpan(otelContext.active(), span), headers);
          const result = await this.publisher.publish(
            row.event_type,
            encoder.encode(JSON.stringify(envelopeFromRow(row))),
            {
              msgId: row.id,
              headers,
            },
          );
          span.setAttribute('messaging.nats.duplicate', result.duplicate);
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: describeError(error) });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }
}
