import { Inject, Injectable } from '@nestjs/common';

import { instruments } from '@verbis/observability';

import { RedisService } from '../../infra/redis/redis.service.js';

import {
  PaymentTokenSchema,
  SnapshotSchema,
  type RuntimeSnapshot,
  emptySnapshot,
} from './domain/runtime.js';
import { RuntimeCipher } from './runtime-cipher.js';

@Injectable()
export class RuntimeStateStore {
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
          return SnapshotSchema.parse(record.snapshot);
      }
    } catch {
      instruments.operationFailures.add(1, { operation: 'runtime.cache.read' });
      /* PostgreSQL is authoritative; an unavailable hot cache never prevents recovery. */
    }
    return this.open(tenantId, id, persisted);
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
    // Only verified hosted-capture token references are permitted for payment variables.
    for (const key of secureKeys) {
      const value = snapshot.variables[key];
      if (value !== undefined && !PaymentTokenSchema.safeParse(value).success)
        throw new Error('Invalid payment token reference');
    }
    await this.redis.client.set(
      slot,
      this.keys.seal(JSON.stringify({ sequence, generation, snapshot }), slot),
      'EX',
      3600,
    );
  }
}
