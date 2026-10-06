import {
  jetstream,
  jetstreamManager,
  type JetStreamClient,
  type JetStreamManager,
  type PubAck,
} from '@nats-io/jetstream';
import { connect, headers as natsHeaders, type NatsConnection } from '@nats-io/transport-node';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';

import { type ApiEnv, API_ENV } from '../../env.js';

import { streamDefinitions } from './streams.js';

export interface PublishOptions {
  /** JetStream dedupe id (Nats-Msg-Id); the outbox event id. */
  readonly msgId: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

/** Connection probe contract (health checks, tests). */
export abstract class MessagingProbe {
  abstract ping(): Promise<void>;
}

@Injectable()
export class NatsService extends MessagingProbe implements OnModuleDestroy {
  #connection: Promise<NatsConnection> | undefined;
  #js: JetStreamClient | undefined;
  #jsm: JetStreamManager | undefined;
  #streamsReady: Promise<void> | undefined;
  readonly #logger = new Logger(NatsService.name);

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {
    super();
  }

  /** Lazily connects (reconnecting forever); never blocks application start. */
  connection(): Promise<NatsConnection> {
    this.#connection ??= connect({
      servers: this.env.NATS_URL,
      name: 'verbis-api',
      reconnect: true,
      maxReconnectAttempts: -1,
      timeout: 5_000,
    }).catch((error: unknown) => {
      this.#connection = undefined;
      throw error;
    });
    return this.#connection;
  }

  async jetstream(): Promise<JetStreamClient> {
    if (this.#js === undefined) this.#js = jetstream(await this.connection());
    return this.#js;
  }

  async manager(): Promise<JetStreamManager> {
    if (this.#jsm === undefined) this.#jsm = await jetstreamManager(await this.connection());
    return this.#jsm;
  }

  /** Creates or updates the streams (idempotent). */
  ensureStreams(): Promise<void> {
    this.#streamsReady ??= (async () => {
      const jsm = await this.manager();
      for (const definition of streamDefinitions(this.env.NATS_STREAM_REPLICAS)) {
        try {
          await jsm.streams.info(definition.name);
          await jsm.streams.update(definition.name, definition);
        } catch {
          await jsm.streams.add(definition);
        }
      }
    })().catch((error: unknown) => {
      this.#streamsReady = undefined;
      throw error;
    });
    return this.#streamsReady;
  }

  async publish(subject: string, data: Uint8Array, options: PublishOptions): Promise<PubAck> {
    await this.ensureStreams();
    const js = await this.jetstream();
    const h = natsHeaders();
    for (const [key, value] of Object.entries(options.headers)) h.set(key, value);
    return js.publish(subject, data, {
      msgID: options.msgId,
      headers: h,
      timeout: options.timeoutMs ?? 5_000,
    });
  }

  async ping(): Promise<void> {
    const nc = await this.connection();
    if (nc.isClosed()) throw new Error('NATS connection closed');
    await nc.flush();
  }

  async onModuleDestroy(): Promise<void> {
    const pending = this.#connection;
    this.#connection = undefined;
    if (pending === undefined) return;
    try {
      const nc = await pending;
      await nc.drain();
    } catch {
      this.#logger.warn('NATS connection could not be drained');
    }
  }
}
