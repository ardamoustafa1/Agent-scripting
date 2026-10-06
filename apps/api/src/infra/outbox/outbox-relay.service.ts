import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { instruments } from '@verbis/observability';

import { type ApiEnv, API_ENV } from '../../env.js';
import { PrismaService } from '../database/prisma.service.js';
import { NatsService } from '../nats/nats.service.js';

import { OutboxRelay, type OutboxStore, type RelayResult } from './outbox.relay.js';

import type { OutboxRow } from './outbox.types.js';

/** SQL-function backed store (SECURITY DEFINER; the app role cannot read other tenants' rows). */
export class SqlOutboxStore implements OutboxStore {
  constructor(private readonly prisma: PrismaService) {}

  claim(limit: number, leaseSeconds: number): Promise<OutboxRow[]> {
    return this.prisma.client.$queryRaw<
      OutboxRow[]
    >`SELECT * FROM outbox_claim(${limit}::integer, ${leaseSeconds}::integer)`;
  }

  async markPublished(ids: readonly string[]): Promise<number> {
    const rows = await this.prisma.client.$queryRaw<
      { count: number }[]
    >`SELECT outbox_mark_published(${[...ids]}::uuid[]) AS count`;
    return rows[0]?.count ?? 0;
  }

  async markFailed(id: string, error: string, retryAt: Date, dead: boolean): Promise<void> {
    // The function returns void: $executeRaw (not $queryRaw, which cannot deserialize void).
    await this.prisma.client
      .$executeRaw`SELECT outbox_mark_failed(${id}::uuid, ${error}, ${retryAt}::timestamptz, ${dead})`;
  }
}

/** Runs the relay loop in-process (OUTBOX_RELAY_ENABLED); multiple replicas are safe (SKIP LOCKED). */
@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly relay: OutboxRelay;
  readonly #logger = new Logger(OutboxRelayService.name);
  #timer: NodeJS.Timeout | undefined;
  #running: Promise<unknown> | undefined;
  #stopped = true;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(NatsService) nats: NatsService,
  ) {
    this.relay = new OutboxRelay(
      new SqlOutboxStore(prisma),
      {
        publish: async (subject, data, options) => {
          const ack = await nats.publish(subject, data, options);
          return { duplicate: ack.duplicate };
        },
      },
      {
        batchSize: env.OUTBOX_BATCH_SIZE,
        leaseSeconds: 30,
        maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
        baseBackoffMs: 1_000,
        maxBackoffMs: 5 * 60_000,
      },
    );
  }

  onApplicationBootstrap(): void {
    if (this.env.OUTBOX_RELAY_ENABLED) this.start();
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.schedule(0);
  }

  /** One relay pass (also used by tests and the admin "flush" path). */
  runOnce(): Promise<RelayResult> {
    return this.relay.runOnce();
  }

  private schedule(delayMs: number): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#running = this.relay
        .runOnce()
        .then((result) => {
          instruments.outbox.add(result.published, { outcome: 'published' });
          instruments.outbox.add(result.retried, { outcome: 'retry' });
          instruments.outbox.add(result.dead, { outcome: 'dead' });
          if (result.dead > 0)
            this.#logger.error(`Outbox: ${result.dead} event(s) moved to dead letter`);
          // Drain quickly while there is backlog.
          this.schedule(
            result.claimed >= this.env.OUTBOX_BATCH_SIZE ? 0 : this.env.OUTBOX_POLL_INTERVAL_MS,
          );
        })
        .catch(() => {
          this.#logger.warn('Outbox relay pass failed; retrying');
          this.schedule(Math.max(this.env.OUTBOX_POLL_INTERVAL_MS, 2_000));
        });
    }, delayMs);
    this.#timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    this.#stopped = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    await this.#running?.catch(() => undefined);
  }
}
