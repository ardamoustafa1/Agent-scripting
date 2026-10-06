import type { ChannelType } from '@verbis/sdk-connector';

/** Bounded advisory load; platform routing remains authoritative. */
export class AgentWorkload {
  readonly #active = new Map<string, Map<string, ChannelType>>();
  readonly #interactions = new Map<
    string,
    { tenantId: string; interactionId: string; owners: Set<string>; expiresAt: number }
  >();
  #nextSweep = 0;
  constructor(
    private readonly options: { capacity?: number; ttlMs?: number; now?: () => number } = {},
  ) {}
  #now() {
    return this.options.now?.() ?? Date.now();
  }
  #prune() {
    const now = this.#now();
    if (now >= this.#nextSweep) {
      this.#nextSweep = now + 60_000;
      for (const entry of this.#interactions.values())
        if (entry.expiresAt <= now) this.close(entry.tenantId, entry.interactionId);
    }
    while (this.#interactions.size >= (this.options.capacity ?? 50_000)) {
      const oldest = this.#interactions.values().next().value;
      if (!oldest) break;
      this.close(oldest.tenantId, oldest.interactionId);
    }
  }
  open(
    tenantId: string,
    agentId: string,
    interactionId: string,
    channel: ChannelType,
    limit: number,
  ): { count: number; overLimit: boolean } {
    const interactionKey = `${tenantId}:${interactionId}`;
    if (!this.#interactions.has(interactionKey)) this.#prune();
    const key = `${tenantId}:${agentId}`;
    const entry = this.#interactions.get(interactionKey) ?? {
      tenantId,
      interactionId,
      owners: new Set<string>(),
      expiresAt: 0,
    };
    // A transfer replaces the platform's previous active owner.
    for (const owner of entry.owners)
      if (owner !== key) {
        const prior = this.#active.get(owner);
        prior?.delete(interactionId);
        if (!prior?.size) this.#active.delete(owner);
        entry.owners.delete(owner);
      }
    entry.owners.add(key);
    entry.expiresAt = this.#now() + (this.options.ttlMs ?? 2 * 60 * 60_000);
    this.#interactions.delete(interactionKey);
    this.#interactions.set(interactionKey, entry);
    const map = this.#active.get(key) ?? new Map<string, ChannelType>();
    map.set(interactionId, channel);
    this.#active.set(key, map);
    const count = [...map.values()].filter((c) => c === channel).length;
    return { count, overLimit: count > limit };
  }
  close(tenantId: string, interactionId: string): void {
    const interactionKey = `${tenantId}:${interactionId}`;
    const entry = this.#interactions.get(interactionKey);
    if (!entry) return;
    for (const owner of entry.owners) {
      const map = this.#active.get(owner);
      map?.delete(interactionId);
      if (!map?.size) this.#active.delete(owner);
    }
    this.#interactions.delete(interactionKey);
  }
  snapshot(tenantId: string, agentId: string): Partial<Record<ChannelType, number>> {
    if (this.#now() >= this.#nextSweep) {
      this.#nextSweep = this.#now() + 60_000;
      for (const entry of this.#interactions.values())
        if (entry.expiresAt <= this.#now()) this.close(entry.tenantId, entry.interactionId);
    }
    const out: Partial<Record<ChannelType, number>> = {};
    for (const channel of this.#active.get(`${tenantId}:${agentId}`)?.values() ?? [])
      out[channel] = (out[channel] ?? 0) + 1;
    return out;
  }
}
