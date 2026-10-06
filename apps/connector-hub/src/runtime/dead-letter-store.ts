import {
  AckPolicy,
  DeliverPolicy,
  jetstream,
  jetstreamManager,
  RetentionPolicy,
  StorageType,
  type JetStreamManager,
} from '@nats-io/jetstream';
import { connect, credsAuthenticator, headers, type NatsConnection } from '@nats-io/transport-node';
import { z } from 'zod';

import { parseInteractionEvent } from '@verbis/sdk-connector';

import type { PipelineItem } from './event-pipeline.js';

/** Why an event left the delivery queue without reaching the API. */
export type DeadLetterReason = 'rejected' | 'exhausted' | 'shutdown';

export interface DeadLetterRecord {
  readonly id: string;
  readonly reason: DeadLetterReason;
  /** Error class/code only; never messages (they may echo payload values). */
  readonly error: string;
  readonly deadLetteredAt: string;
  readonly item: PipelineItem;
}

/**
 * Durable dead-letter store (audit T-10). Records are tenant-scoped; `replay` hands each record of
 * one tenant back to the caller and removes it only after the caller accepted it.
 */
export interface DeadLetterStore {
  readonly durable: boolean;
  put(record: DeadLetterRecord): Promise<void>;
  /** Re-offers up to `limit` records of the tenant; returns how many were accepted. */
  replay(tenantId: string, limit: number, accept: (item: PipelineItem) => void): Promise<number>;
  close(): Promise<void>;
}

const UUID = z.uuid();
const RecordSchema = z.strictObject({
  id: z.string().min(1).max(128),
  reason: z.enum(['rejected', 'exhausted', 'shutdown']),
  error: z.string().max(128),
  deadLetteredAt: z.iso.datetime({ offset: true }),
  item: z.strictObject({
    slug: z.string().min(1).max(63),
    tenantId: UUID,
    connectorId: UUID,
    event: z.unknown().transform((value, ctx) => {
      try {
        return parseInteractionEvent(value);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'invalid interaction event' });
        return z.NEVER;
      }
    }),
    maxConcurrent: z.record(z.string(), z.number().int().min(0).max(1_000)),
  }),
});

export function parseDeadLetterRecord(raw: unknown): DeadLetterRecord {
  return RecordSchema.parse(raw);
}

/** Not durable: development and tests only (production requires the JetStream store). */
export class MemoryDeadLetterStore implements DeadLetterStore {
  readonly durable = false;
  readonly records: DeadLetterRecord[] = [];

  constructor(private readonly max = 10_000) {}

  put(record: DeadLetterRecord): Promise<void> {
    this.records.push(record);
    if (this.records.length > this.max) this.records.shift();
    return Promise.resolve();
  }

  replay(tenantId: string, limit: number, accept: (item: PipelineItem) => void): Promise<number> {
    let count = 0;
    for (let i = 0; i < this.records.length && count < limit;) {
      const record = this.records[i];
      if (record?.item.tenantId !== tenantId) {
        i += 1;
        continue;
      }
      try {
        accept(record.item);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error('replay rejected'));
      }
      this.records.splice(i, 1);
      count += 1;
    }
    return Promise.resolve(count);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

export interface JetStreamDeadLetterOptions {
  readonly servers: readonly string[];
  readonly creds?: string;
  readonly stream: string;
  readonly maxAgeHours: number;
  readonly replicas: number;
}

export const DEAD_LETTER_SUBJECT = 'verbis.connector.event.deadlettered.v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * JetStream work-queue stream on file storage: a record survives hub restarts until it is
 * replayed (acked) or ages out. Subjects carry tenant and connector ids so replay is tenant-scoped.
 * Payloads may contain PII; the stream lives inside the platform's NATS (encryption at rest per
 * deployment) and is bounded by max age. Logs carry ids only.
 */
export class JetStreamDeadLetterStore implements DeadLetterStore {
  readonly durable = true;
  #nc: NatsConnection | undefined;
  #ready: Promise<NatsConnection> | undefined;

  constructor(private readonly options: JetStreamDeadLetterOptions) {}

  async put(record: DeadLetterRecord): Promise<void> {
    const nc = await this.#connect();
    const h = headers();
    h.set('Nats-Msg-Id', record.id);
    await jetstream(nc).publish(
      `${DEAD_LETTER_SUBJECT}.${record.item.tenantId}.${record.item.connectorId}`,
      encoder.encode(JSON.stringify(record)),
      { headers: h, expect: { streamName: this.options.stream } },
    );
  }

  async replay(
    tenantId: string,
    limit: number,
    accept: (item: PipelineItem) => void,
  ): Promise<number> {
    UUID.parse(tenantId);
    const nc = await this.#connect();
    const durable = `hub-dlq-replay-${tenantId}`;
    await (
      await jetstreamManager(nc)
    ).consumers
      .add(this.options.stream, {
        durable_name: durable,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
        filter_subject: `${DEAD_LETTER_SUBJECT}.${tenantId}.>`,
        ack_wait: 30_000_000_000,
      })
      .catch(() => undefined); // already exists
    const consumer = await jetstream(nc).consumers.get(this.options.stream, durable);
    let count = 0;
    while (count < limit) {
      const message = await consumer.next({ expires: 1_000 });
      if (message === null) break;
      let record: DeadLetterRecord;
      try {
        record = parseDeadLetterRecord(JSON.parse(decoder.decode(message.data)));
      } catch {
        message.term(); // unparseable records stay visible in the stream (term ≠ delete)
        continue;
      }
      if (record.item.tenantId !== tenantId) {
        message.term();
        continue;
      }
      try {
        accept(record.item);
      } catch (error) {
        message.nak(); // e.g. backpressure: keep it for the next replay
        throw error;
      }
      message.ack();
      count += 1;
    }
    return count;
  }

  async close(): Promise<void> {
    await this.#nc?.drain().catch(() => undefined);
    this.#nc = undefined;
    this.#ready = undefined;
  }

  #connect(): Promise<NatsConnection> {
    if (this.#nc !== undefined && !this.#nc.isClosed()) return Promise.resolve(this.#nc);
    this.#ready ??= (async () => {
      try {
        const nc = await connect({
          servers: [...this.options.servers],
          name: 'verbis-hub-dlq',
          maxReconnectAttempts: -1,
          ...(this.options.creds === undefined
            ? {}
            : { authenticator: credsAuthenticator(encoder.encode(this.options.creds)) }),
        });
        await ensureStream(await jetstreamManager(nc), this.options);
        this.#nc = nc;
        return nc;
      } finally {
        this.#ready = undefined;
      }
    })();
    return this.#ready;
  }
}

async function ensureStream(
  jsm: JetStreamManager,
  options: JetStreamDeadLetterOptions,
): Promise<void> {
  const config = {
    subjects: [`${DEAD_LETTER_SUBJECT}.>`],
    retention: RetentionPolicy.Workqueue,
    storage: StorageType.File,
    num_replicas: options.replicas,
    max_age: options.maxAgeHours * 3_600 * 1_000_000_000,
    duplicate_window: 120_000_000_000,
    deny_delete: true,
    deny_purge: true,
  };
  const exists = await jsm.streams.info(options.stream).then(
    () => true,
    () => false,
  );
  if (exists) await jsm.streams.update(options.stream, config);
  else await jsm.streams.add({ name: options.stream, ...config });
}
