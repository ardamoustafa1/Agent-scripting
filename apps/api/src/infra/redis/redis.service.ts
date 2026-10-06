import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';

import { type ApiEnv, API_ENV } from '../../env.js';

export abstract class CacheProbe {
  abstract ping(): Promise<void>;
}

@Injectable()
export class RedisService extends CacheProbe implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    super();
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      // Rate limiting must not stall requests when Redis is slow or down.
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      commandTimeout: 1_000,
      enableOfflineQueue: false,
      keyPrefix: 'verbis:api:',
    });
    this.client.on('error', () => {
      // Surfaced through readiness; avoid log floods while reconnecting.
    });
  }

  onModuleInit(): void {
    // Background connect; ioredis keeps reconnecting. Failures surface through readiness.
    this.client.connect().catch(() => undefined);
  }

  async ping(): Promise<void> {
    if (this.client.status === 'wait') await this.client.connect();
    await this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'end') this.client.disconnect();
    await Promise.resolve();
  }
}
