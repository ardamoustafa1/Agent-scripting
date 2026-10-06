import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { context, type Context } from '@opentelemetry/api';

import { instruments, inSpan } from '@verbis/observability';
import { ConnectorError, type ChannelType, type InteractionEvent } from '@verbis/sdk-connector';

import { AgentWorkload } from './agent-workload.js';
import {
  MemoryDeadLetterStore,
  type DeadLetterReason,
  type DeadLetterStore,
} from './dead-letter-store.js';
import { DeliveryQueue, type QueueStats } from './delivery-queue.js';

import type { VerbisApi } from '../api/verbis-api.js';

export interface DeadLetterStats {
  readonly durable: boolean;
  readonly persisted: number;
  readonly persistFailures: number;
}

export interface PipelineItem {
  readonly slug: string;
  readonly tenantId: string;
  readonly connectorId: string;
  readonly event: InteractionEvent;
  readonly maxConcurrent: Partial<Record<ChannelType, number>>;
}

/**
 * Normalized event → API (interaction upsert + user mapping) → launch intent for the mapped agent
 * when the interaction becomes connected. Each (interaction, agent) pair launches once, so an
 * agent working 3 chats + 1 email gets four independent script sessions; a transfer launches a
 * fresh session for the receiving agent.
 */
export class EventPipeline {
  readonly #logger = new Logger(EventPipeline.name);
  readonly #queue: DeliveryQueue<PipelineItem>;
  readonly #contexts = new WeakMap<PipelineItem, Context>();
  readonly sampleDepth = (result: { observe(value: number): void }) => {
    result.observe(this.#queue.stats().depth);
  };
  readonly #launched = new Map<string, { agents: Set<string>; expiresAt: number }>();
  #nextSweep = 0;
  readonly workload = new AgentWorkload();
  readonly #deadLetters: DeadLetterStore;
  readonly #now: () => Date;
  #persisted = 0;
  #persistFailures = 0;
  readonly #pendingWrites = new Set<Promise<void>>();

  constructor(
    private readonly api: VerbisApi,
    options: {
      capacity: number;
      concurrency: number;
      sleep?: (ms: number) => Promise<void>;
      /** Durable store in production (JetStream); defaults to a non-durable in-memory store. */
      deadLetters?: DeadLetterStore;
      now?: () => Date;
    },
  ) {
    this.#deadLetters = options.deadLetters ?? new MemoryDeadLetterStore();
    this.#now = options.now ?? (() => new Date());
    instruments.connectorQueue.addCallback(this.sampleDepth);
    this.#queue = new DeliveryQueue<PipelineItem>({
      capacity: options.capacity,
      concurrency: options.concurrency,
      key: (item) => `${item.connectorId}:${item.event.platformInteractionId}`,
      handle: (item) =>
        context.with(this.#contexts.get(item) ?? context.active(), () => this.#deliver(item)),
      onDeadLetter: (item, error, reason) => {
        this.#deadLetter(item, reason, error);
      },
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    });
  }

  /** Throws BackpressureError when full; the connector must push back on its platform. */
  offer(item: PipelineItem): void {
    this.#contexts.set(item, context.active());
    this.#queue.offer(item);
  }

  stats(): QueueStats {
    return this.#queue.stats();
  }

  deadLetterStats(): DeadLetterStats {
    return {
      durable: this.#deadLetters.durable,
      persisted: this.#persisted,
      persistFailures: this.#persistFailures,
    };
  }

  drain(): Promise<void> {
    return this.#queue.drain();
  }

  close(): void {
    instruments.connectorQueue.removeCallback(this.sampleDepth);
    this.#queue.close();
  }

  /** Re-offers a tenant's dead letters (bounded by `limit` and by queue backpressure). */
  replayDeadLetters(tenantId: string, limit: number): Promise<number> {
    return this.#deadLetters.replay(tenantId, limit, (item) => {
      this.offer(item);
    });
  }

  /**
   * Shutdown after `close` + bounded `drain`: events that never started delivery are written to
   * the dead-letter store instead of being lost with the process, then the store is closed.
   */
  async persistPendingAndClose(): Promise<void> {
    for (const item of this.#queue.takePending()) this.#deadLetter(item, 'shutdown', undefined);
    await Promise.allSettled([...this.#pendingWrites]);
    await this.#deadLetters.close();
  }

  #deadLetter(item: PipelineItem, reason: DeadLetterReason, error: unknown): void {
    const errorName =
      error instanceof ConnectorError ? error.code : error instanceof Error ? error.name : 'none';
    const deadLetteredAt = this.#now().toISOString();
    const id = createHash('sha256')
      .update(`${item.connectorId}\n${item.event.eventId}\n${deadLetteredAt}\n${reason}`)
      .digest('hex');
    // Ids only in logs and metrics — payloads may contain PII.
    const summary = `${item.event.type} event ${item.event.eventId} (connector ${item.connectorId}, ${reason}: ${errorName})`;
    const write = this.#deadLetters
      .put({ id, reason, error: errorName.slice(0, 128), deadLetteredAt, item })
      .then(
        () => {
          this.#persisted += 1;
          instruments.connectorDeadLetters.add(1, { reason, outcome: 'persisted' });
          this.#logger.error(`Dead-lettered ${summary}`);
        },
        (persistError: unknown) => {
          this.#persistFailures += 1;
          instruments.connectorDeadLetters.add(1, { reason, outcome: 'lost' });
          this.#logger.error(
            `Dead letter NOT persisted for ${summary}: ${persistError instanceof Error ? persistError.name : 'error'}`,
          );
        },
      )
      .finally(() => this.#pendingWrites.delete(write));
    this.#pendingWrites.add(write);
  }

  async #deliver(item: PipelineItem): Promise<void> {
    const result = await inSpan('connector.event.deliver', () =>
      this.api.ingest(item.slug, item.connectorId, item.event),
    );
    const { event } = item;
    const occurred = Date.parse(event.occurredAt);
    if (Number.isFinite(occurred))
      instruments.connectorLag.record(Math.max(0, (Date.now() - occurred) / 1000), {
        type: event.type,
      });
    if (event.type === 'ended') {
      this.workload.close(item.tenantId, result.interactionId);
      this.#launched.delete(`${item.tenantId}:${result.interactionId}`);
      return;
    }
    if (result.agentId === null) return;
    if (event.type === 'interactionOffered' || event.type === 'connected') {
      const load = this.workload.open(
        item.tenantId,
        result.agentId,
        result.interactionId,
        event.channel,
        item.maxConcurrent[event.channel] ?? 1,
      );
      if (load.overLimit)
        this.#logger.warn(
          `Agent over ${event.channel} limit (${String(load.count)}) on connector ${item.connectorId}`,
        );
    }
    const key = `${item.tenantId}:${result.interactionId}`;
    const now = Date.now();
    if (now >= this.#nextSweep) {
      this.#nextSweep = now + 60_000;
      for (const [id, entry] of this.#launched)
        if (entry.expiresAt <= now) this.#launched.delete(id);
    }
    if (event.type === 'connected' && !this.#launched.get(key)?.agents.has(result.agentId)) {
      await this.api.createLaunchIntent(item.slug, {
        connectorId: item.connectorId,
        interactionId: result.interactionId,
        userId: result.agentId,
      });
      const entry = this.#launched.get(key) ?? { agents: new Set<string>(), expiresAt: 0 };
      entry.agents.add(result.agentId);
      if (entry.agents.size > 100) entry.agents.delete(entry.agents.values().next().value ?? '');
      entry.expiresAt = now + 2 * 60 * 60_000;
      this.#launched.delete(key);
      this.#launched.set(key, entry);
      if (this.#launched.size > 50_000)
        this.#launched.delete(this.#launched.keys().next().value ?? '');
    }
  }
}
