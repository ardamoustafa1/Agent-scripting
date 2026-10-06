import { type DynamicModule, Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { type ApiEnv, API_ENV } from '../env.js';

import { DatabaseProbe, PrismaService } from './database/prisma.service.js';
import { TenantDb } from './database/tenant-db.js';
import { EventConsumersService } from './events/event-consumers.service.js';
import { MessagingProbe, NatsService } from './nats/nats.service.js';
import { OutboxRelayService } from './outbox/outbox-relay.service.js';
import { OutboxWriter } from './outbox/outbox.writer.js';
import { CacheProbe, RedisService } from './redis/redis.service.js';

/** Process-wide infrastructure: database, Redis, NATS, outbox relay and event consumers. */
@Global()
@Module({})
export class InfraModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: InfraModule,
      imports: [DiscoveryModule],
      providers: [
        { provide: API_ENV, useValue: env },
        PrismaService,
        { provide: DatabaseProbe, useExisting: PrismaService },
        TenantDb,
        RedisService,
        { provide: CacheProbe, useExisting: RedisService },
        NatsService,
        { provide: MessagingProbe, useExisting: NatsService },
        OutboxWriter,
        OutboxRelayService,
        EventConsumersService,
      ],
      exports: [
        API_ENV,
        PrismaService,
        DatabaseProbe,
        TenantDb,
        RedisService,
        CacheProbe,
        NatsService,
        MessagingProbe,
        OutboxWriter,
        OutboxRelayService,
        EventConsumersService,
      ],
    };
  }
}
