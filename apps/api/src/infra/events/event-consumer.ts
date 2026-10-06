import {
  context as otelContext,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

import { requestContext, systemContext } from '../../common/context/request-context.js';
import { describeError } from '../outbox/outbox.relay.js';
import { EventEnvelopeSchema, type EventEnvelope } from '../outbox/outbox.types.js';

import type { TransactionClient } from '../database/prisma.service.js';

/** A domain-event handler. Side effects must go through `tx` so they commit with the dedupe row. */
export interface EventHandler {
  /** Durable consumer name (kebab-case), unique per handler. */
  readonly name: string;
  readonly stream: string;
  readonly filterSubjects: readonly string[];
  readonly maxDeliver?: number;
  /** Disabled optional projections must not acknowledge and discard retained events. */
  readonly enabled?: boolean;
  handle(event: EventEnvelope, tx: TransactionClient): Promise<void>;
}

/** Runs a function in a tenant transaction (TenantDb.run). */
export type TenantRunner = <T>(
  tenantId: string,
  fn: (tx: TransactionClient) => Promise<T>,
) => Promise<T>;

/** The parts of a JetStream message the processor needs (keeps it testable). */
export interface Delivery {
  readonly subject: string;
  readonly data: Uint8Array;
  readonly deliveryCount: number;
  readonly headers: Readonly<Record<string, string>>;
  ack(): void;
  nak(delayMs: number): void;
  term(reason: string): void;
}

export type DeadLetterPublisher = (
  consumer: string,
  delivery: Delivery,
  reason: string,
) => Promise<void>;

export type Outcome = 'processed' | 'duplicate' | 'retry' | 'dead' | 'rejected';

const tracer = trace.getTracer('verbis-api.events');
const decoder = new TextDecoder();

/**
 * Idempotent processing: the `processed_events` row and the handler's effects commit in one
 * transaction, so redeliveries (at-least-once) are applied exactly once.
 */
export class IdempotentProcessor {
  constructor(
    private readonly runInTenant: TenantRunner,
    private readonly deadLetter: DeadLetterPublisher,
    private readonly retryDelayMs: (deliveryCount: number) => number = (n) =>
      Math.min(60_000, 1_000 * 2 ** (n - 1)),
  ) {}

  async process(handler: EventHandler, delivery: Delivery): Promise<Outcome> {
    let event: EventEnvelope;
    try {
      event = EventEnvelopeSchema.parse(JSON.parse(decoder.decode(delivery.data)));
    } catch {
      // Poison message: never retry; keep a copy for inspection.
      await this.deadLetter(handler.name, delivery, 'invalid envelope');
      delivery.term('invalid envelope');
      return 'rejected';
    }

    const parent = propagation.extract(otelContext.active(), delivery.headers);
    return tracer.startActiveSpan(
      `${event.type} process`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          'messaging.system': 'nats',
          'messaging.consumer.group.name': handler.name,
          'messaging.message.id': event.id,
        },
      },
      parent,
      async (span) => {
        try {
          const context = {
            ...systemContext(event.correlationId, `consumer:${handler.name}`),
            principal: {
              type: 'service' as const,
              id: `consumer:${handler.name}`,
              tenantId: event.tenantId,
              scopes: [],
            },
          };
          const fresh = await requestContext.run(context, () =>
            this.runInTenant(event.tenantId, async (tx) => {
              const inserted = await tx.$executeRaw`
                INSERT INTO processed_events (consumer, event_id, tenant_id)
                VALUES (${handler.name}, ${event.id}::uuid, ${event.tenantId}::uuid)
                ON CONFLICT DO NOTHING`;
              if (inserted === 0) return false;
              await handler.handle(event, tx);
              return true;
            }),
          );
          delivery.ack();
          return fresh ? 'processed' : 'duplicate';
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: describeError(error) });
          const maxDeliver = handler.maxDeliver ?? 5;
          if (delivery.deliveryCount >= maxDeliver) {
            await this.deadLetter(handler.name, delivery, describeError(error));
            delivery.term('max deliveries reached');
            return 'dead';
          }
          delivery.nak(this.retryDelayMs(delivery.deliveryCount));
          return 'retry';
        } finally {
          span.end();
        }
      },
    );
  }
}
