import { AckPolicy, DeliverPolicy, type ConsumerMessages, type JsMsg } from '@nats-io/jetstream';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  SetMetadata,
} from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';

import { type ApiEnv, API_ENV } from '../../env.js';
import { TenantDb } from '../database/tenant-db.js';
import { NatsService } from '../nats/nats.service.js';

import { type Delivery, type EventHandler, IdempotentProcessor } from './event-consumer.js';

const EVENT_HANDLER = 'verbis:event-handler';

/** Marks a provider implementing EventHandler; started by EventConsumersService. */
export const DomainEventHandler = (): ClassDecorator => SetMetadata(EVENT_HANDLER, true);

function isEventHandler(value: unknown): value is EventHandler {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { handle?: unknown }).handle === 'function'
  );
}

/** JetStream answers `consumer already exists` (error code 10148) when `add` meets another config. */
export function isConsumerExists(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    message?: unknown;
    code?: unknown;
    apiError?: () => { err_code?: number };
  };
  const code = typeof candidate.apiError === 'function' ? candidate.apiError().err_code : undefined;
  return (
    code === 10148 ||
    (typeof candidate.message === 'string' && /consumer already exists/i.test(candidate.message))
  );
}

export function toDelivery(msg: JsMsg): Delivery {
  const headers: Record<string, string> = {};
  if (msg.headers !== undefined)
    for (const [key, values] of msg.headers) headers[key] = values[0] ?? '';
  return {
    subject: msg.subject,
    data: msg.data,
    deliveryCount: msg.info.deliveryCount,
    headers,
    ack: () => {
      msg.ack();
    },
    nak: (delay) => {
      msg.nak(delay);
    },
    term: (reason) => {
      msg.term(reason);
    },
  };
}

/** Starts one durable pull consumer per registered handler (EVENT_CONSUMERS_ENABLED). */
@Injectable()
export class EventConsumersService implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly processor: IdempotentProcessor;
  readonly #logger = new Logger(EventConsumersService.name);
  readonly #subscriptions: ConsumerMessages[] = [];
  #stopped = false;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(NatsService) private readonly nats: NatsService,
    @Inject(TenantDb) tenantDb: TenantDb,
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
  ) {
    this.processor = new IdempotentProcessor(
      (tenantId, fn) => tenantDb.run(tenantId, fn),
      async (consumer, delivery, reason) => {
        await this.nats.publish(`verbis.dlq.${consumer}`, delivery.data, {
          msgId: `${consumer}:${delivery.headers['Nats-Msg-Id'] ?? delivery.subject}:${String(delivery.deliveryCount)}`,
          headers: {
            ...delivery.headers,
            'verbis-dlq-reason': reason.slice(0, 200),
            'verbis-original-subject': delivery.subject,
          },
        });
      },
    );
  }

  /** Providers decorated with @DomainEventHandler(). */
  handlers(): EventHandler[] {
    return this.discovery
      .getProviders()
      .filter(
        (wrapper) =>
          typeof wrapper.metatype === 'function' &&
          Reflect.getMetadata(EVENT_HANDLER, wrapper.metatype) === true,
      )
      .map((wrapper) => wrapper.instance as unknown)
      .filter(isEventHandler);
  }

  onApplicationBootstrap(): void {
    if (!this.env.EVENT_CONSUMERS_ENABLED) return;
    for (const handler of this.handlers()) {
      if (handler.enabled === false) continue;
      this.run(handler);
    }
  }

  /**
   * Starts a handler and, when it ends or cannot start, retries every 5 s until shutdown. A failed
   * attempt must never escape as an unhandled rejection: that would take the whole API down.
   */
  private run(handler: EventHandler): void {
    void this.start(handler).catch((error: unknown) => {
      this.#logger.warn(
        `Consumer ${handler.name} could not start (${error instanceof Error ? error.message : 'unknown error'}); retrying in 5s`,
      );
      if (!this.#stopped)
        setTimeout(() => {
          this.run(handler);
        }, 5_000).unref();
    });
  }

  /** Ensures the durable consumer and processes messages until shutdown. */
  async start(handler: EventHandler): Promise<void> {
    await this.nats.ensureStreams();
    const jsm = await this.nats.manager();
    const config = {
      durable_name: handler.name,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      filter_subjects: [...handler.filterSubjects],
      ack_wait: 30_000_000_000,
      max_deliver: (handler.maxDeliver ?? 5) + 1,
    };
    try {
      await jsm.consumers.add(handler.stream, config);
    } catch (error) {
      // A durable consumer left behind by an earlier version with another configuration: bring it
      // up to date instead of failing forever.
      if (!isConsumerExists(error)) throw error;
      await jsm.consumers.update(handler.stream, handler.name, config);
    }
    const js = await this.nats.jetstream();
    const consumer = await js.consumers.get(handler.stream, handler.name);
    const messages = await consumer.consume({ max_messages: 50 });
    this.#subscriptions.push(messages);
    for await (const msg of messages) {
      if (this.isStopped()) break;
      await this.processor.process(handler, toDelivery(msg));
    }
  }

  private isStopped(): boolean {
    return this.#stopped;
  }

  async onApplicationShutdown(): Promise<void> {
    this.#stopped = true;
    await Promise.all(
      this.#subscriptions.map((messages) => messages.close().catch(() => undefined)),
    );
  }
}
