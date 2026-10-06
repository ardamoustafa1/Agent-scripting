import { Logger } from '@nestjs/common';
import { context, type Context } from '@opentelemetry/api';

import { instruments, inSpan } from '@verbis/observability';
import type { ChannelType, InteractionEvent } from '@verbis/sdk-connector';

import { AgentWorkload } from './agent-workload.js';
import { DeliveryQueue, type QueueStats } from './delivery-queue.js';

import type { VerbisApi } from '../api/verbis-api.js';

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

  constructor(
    private readonly api: VerbisApi,
    options: { capacity: number; concurrency: number; sleep?: (ms: number) => Promise<void> },
  ) {
    instruments.connectorQueue.addCallback(this.sampleDepth);
    this.#queue = new DeliveryQueue<PipelineItem>({
      capacity: options.capacity,
      concurrency: options.concurrency,
      key: (item) => `${item.connectorId}:${item.event.platformInteractionId}`,
      handle: (item) =>
        context.with(this.#contexts.get(item) ?? context.active(), () => this.#deliver(item)),
      onDeadLetter: (item, error) => {
        // Event ids only — payloads may contain PII.
        this.#logger.error(
          `Dead-lettered ${item.event.type} event ${item.event.eventId} (connector ${item.connectorId}): ${error instanceof Error ? error.name : 'error'}`,
        );
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

  drain(): Promise<void> {
    return this.#queue.drain();
  }

  close(): void {
    instruments.connectorQueue.removeCallback(this.sampleDepth);
    this.#queue.close();
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
