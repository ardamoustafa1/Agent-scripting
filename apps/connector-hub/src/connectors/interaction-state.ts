import {
  canTransition,
  STATUS_OF_EVENT,
  type InteractionEvent,
  type InteractionStatus,
} from '@verbis/sdk-connector';

interface Tracked {
  status: InteractionStatus;
  agentId: string | undefined;
}

/**
 * Connector-side authoritative view built from (authenticated) platform events: dedupes event ids,
 * drops out-of-order transitions, and answers `verifyParticipant` for connectors whose platform has
 * no participant API (generic webhook, simulator). Bounded to avoid unbounded memory.
 */
export class InteractionState {
  readonly #items = new Map<string, Tracked>();
  readonly #seen = new Set<string>();

  constructor(private readonly maxTracked = 50_000) {}

  /** Whether this event should be emitted (new and a valid transition). Does not record it. */
  accepts(event: InteractionEvent): boolean {
    if (this.#seen.has(event.eventId)) return false;
    return canTransition(
      this.#items.get(event.platformInteractionId)?.status,
      STATUS_OF_EVENT[event.type],
    );
  }

  /** Records an event after it was accepted downstream (so backpressure retries are not lost). */
  record(event: InteractionEvent): void {
    this.#seen.add(event.eventId);
    if (this.#seen.size > this.maxTracked * 4) {
      const oldest = this.#seen.values().next();
      if (!oldest.done) this.#seen.delete(oldest.value);
    }
    const status = STATUS_OF_EVENT[event.type];
    const current = this.#items.get(event.platformInteractionId);
    const agentId =
      event.type === 'transferred'
        ? (event.transferTo?.id ?? current?.agentId)
        : (event.agent?.id ?? current?.agentId);
    this.#items.set(event.platformInteractionId, { status, agentId });
    if (this.#items.size > this.maxTracked) {
      const oldest = this.#items.keys().next();
      if (!oldest.done) this.#items.delete(oldest.value);
    }
  }

  isParticipant(platformUserId: string, platformInteractionId: string): boolean {
    const item = this.#items.get(platformInteractionId);
    return item !== undefined && item.status !== 'ended' && item.agentId === platformUserId;
  }

  status(platformInteractionId: string): InteractionStatus | undefined {
    return this.#items.get(platformInteractionId)?.status;
  }

  clear(): void {
    this.#items.clear();
    this.#seen.clear();
  }
}
