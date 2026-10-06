import { Inject, Injectable } from '@nestjs/common';

import { RedisService } from '../../infra/redis/redis.service.js';

import { SnapshotSchema, type RuntimeSnapshot, emptySnapshot } from './domain/runtime.js';
import { RuntimeCipher } from './runtime-cipher.js';

@Injectable()
export class RuntimeStateStore {
  readonly #secure = new Map<
    string,
    {
      sequence: number;
      generation: number;
      expiresAt: number;
      values: RuntimeSnapshot['variables'];
    }
  >();
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(RuntimeCipher) private readonly keys: RuntimeCipher,
  ) {}
  slot(tenantId: string, id: string): string {
    return `runtime:state:${tenantId}:${id}`;
  }
  seal(tenantId: string, id: string, snapshot: RuntimeSnapshot): { sealed: string } {
    return { sealed: this.keys.seal(JSON.stringify(snapshot), this.slot(tenantId, id)) };
  }
  open(tenantId: string, id: string, value: unknown): RuntimeSnapshot {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('sealed' in value) ||
      typeof value.sealed !== 'string'
    )
      return emptySnapshot();
    return SnapshotSchema.parse(
      JSON.parse(this.keys.openString(value.sealed, this.slot(tenantId, id))),
    );
  }
  async evict(tenantId: string, id: string): Promise<void> {
    const slot = this.slot(tenantId, id);
    this.#secure.delete(slot);
    await this.redis.client.del(slot);
  }
  async read(
    tenantId: string,
    id: string,
    sequence: number,
    persisted: unknown,
    generation = sequence,
  ): Promise<RuntimeSnapshot> {
    try {
      const cached = await this.redis.client.get(this.slot(tenantId, id));
      if (cached !== null) {
        const record = JSON.parse(this.keys.openString(cached, this.slot(tenantId, id))) as {
          sequence: number;
          generation?: number;
          snapshot: unknown;
        };
        if (record.sequence === sequence && (record.generation ?? record.sequence) === generation)
          return this.withSecure(
            this.slot(tenantId, id),
            sequence,
            SnapshotSchema.parse(record.snapshot),
            generation,
          );
      }
    } catch {
      /* PostgreSQL is authoritative; an unavailable hot cache never prevents recovery. */
    }
    return this.withSecure(
      this.slot(tenantId, id),
      sequence,
      this.open(tenantId, id, persisted),
      generation,
    );
  }
  withSecure(
    slot: string,
    sequence: number,
    snapshot: RuntimeSnapshot,
    generation = sequence,
  ): RuntimeSnapshot {
    const local = this.#secure.get(slot);
    if (
      local !== undefined &&
      local.expiresAt > Date.now() &&
      local.sequence === sequence &&
      local.generation === generation
    )
      snapshot.variables = { ...snapshot.variables, ...local.values };
    return snapshot;
  }
  async write(
    tenantId: string,
    id: string,
    sequence: number,
    snapshot: RuntimeSnapshot,
    secureKeys: readonly string[] = [],
    generation = sequence,
  ): Promise<void> {
    const slot = this.slot(tenantId, id);
    for (const [key, value] of this.#secure)
      if (value.expiresAt <= Date.now()) this.#secure.delete(key);
    const values = Object.fromEntries(
      Object.entries(snapshot.variables).filter(([key]) => secureKeys.includes(key)),
    );
    if (Object.keys(values).length > 0) {
      if (this.#secure.size >= 10_000 && !this.#secure.has(slot))
        throw new Error('Secure runtime memory capacity exceeded');
      this.#secure.set(slot, { sequence, generation, expiresAt: Date.now() + 60_000, values });
    } else this.#secure.delete(slot);
    const cacheSnapshot = {
      ...snapshot,
      variables: Object.fromEntries(
        Object.entries(snapshot.variables).filter(([key]) => !secureKeys.includes(key)),
      ),
    };
    await this.redis.client.set(
      slot,
      this.keys.seal(JSON.stringify({ sequence, generation, snapshot: cacheSnapshot }), slot),
      'EX',
      3600,
    );
  }
}
