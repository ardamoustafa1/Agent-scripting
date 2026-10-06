import type { ChannelType } from '@verbis/sdk-connector';

/**
 * Concurrent interactions per agent (e.g. 3 chats + 1 email). Every interaction gets its own launch
 * intent and therefore its own script session; this tracker only reports load and limit breaches
 * (routing stays the platform's job).
 */
export class AgentWorkload {
  readonly #active = new Map<string, Map<string, ChannelType>>();

  #key(tenantId: string, agentId: string) {
    return `${tenantId}:${agentId}`;
  }

  /** Records an interaction as active; returns whether it exceeds the channel limit. */
  open(
    tenantId: string,
    agentId: string,
    interactionId: string,
    channel: ChannelType,
    limit: number,
  ): { count: number; overLimit: boolean } {
    const key = this.#key(tenantId, agentId);
    const map = this.#active.get(key) ?? new Map<string, ChannelType>();
    map.set(interactionId, channel);
    this.#active.set(key, map);
    const count = [...map.values()].filter((c) => c === channel).length;
    return { count, overLimit: count > limit };
  }

  close(tenantId: string, interactionId: string): void {
    for (const [key, map] of this.#active) {
      if (!key.startsWith(`${tenantId}:`)) continue;
      map.delete(interactionId);
      if (map.size === 0) this.#active.delete(key);
    }
  }

  snapshot(tenantId: string, agentId: string): Partial<Record<ChannelType, number>> {
    const out: Partial<Record<ChannelType, number>> = {};
    for (const channel of this.#active.get(this.#key(tenantId, agentId))?.values() ?? [])
      out[channel] = (out[channel] ?? 0) + 1;
    return out;
  }
}
