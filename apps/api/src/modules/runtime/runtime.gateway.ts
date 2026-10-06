import { Logger, Inject, type OnApplicationShutdown, type OnModuleDestroy } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import { Namespace, type Socket } from 'socket.io';

import { instruments } from '@verbis/observability';

import { RedisService } from '../../infra/redis/redis.service.js';

import { RuntimeRealtimeService, type RuntimeGrant, room } from './runtime-realtime.service.js';

import type { Redis } from 'ioredis';

@WebSocketGateway({
  namespace: '/runtime',
  transports: ['websocket'],
  maxHttpBufferSize: 16_384,
  serveClient: false,
})
export class RuntimeGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy,
    OnApplicationShutdown
{
  @WebSocketServer() server!: Namespace;
  readonly #checks = new Map<string, ReturnType<typeof setInterval>>();
  readonly #clients: Redis[] = [];
  #ready = false;
  readonly #observers = new Map<string, RuntimeGrant>();
  readonly #logger = new Logger(RuntimeGateway.name);
  constructor(
    @Inject(RuntimeRealtimeService) private readonly realtime: RuntimeRealtimeService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}
  async afterInit(server: Namespace): Promise<void> {
    const publisher = this.redis.client.duplicate({
      keyPrefix: '',
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    const subscriber = publisher.duplicate();
    this.#clients.push(publisher, subscriber);
    for (const client of this.#clients)
      client.on('error', () => {
        this.#ready = false;
      });
    try {
      await Promise.all(this.#clients.map((client) => client.connect()));
      server.server.adapter(createAdapter(publisher, subscriber));
      this.#ready = true;
      for (const client of this.#clients)
        client.on('ready', () => {
          this.#ready = this.#clients.every((c) => c.status === 'ready');
        });
    } catch {
      this.#ready = false;
    }
  }
  async handleConnection(client: Socket): Promise<void> {
    try {
      if (!this.#ready) throw new Error('Runtime channel unavailable');
      const grant = await this.realtime.consume(
        (client.handshake.auth as Record<string, unknown>)['ticket'],
        client.handshake.headers.origin,
      );
      if (grant.supervisor) {
        await this.realtime.observation(grant, 'started');
        this.#observers.set(client.id, grant);
      }
      await client.join(room(grant.tenantId, grant.sessionId));
      client.emit('runtime.resume', await this.realtime.resume(grant));
      if (!client.connected) return;
      // Commands stay on the HTTP BFF/CSRF/RLS pipeline. This socket is read-only.
      const check = setInterval(() => {
        void this.realtime.validate(grant).catch(() => client.disconnect(true));
      }, 15_000);
      check.unref();
      this.#checks.set(client.id, check);
    } catch {
      client.emit('runtime.error', { code: 'VERBIS_AUTHZ_FORBIDDEN' });
      client.disconnect(true);
    }
  }
  handleDisconnect(client: Socket): void {
    const timer = this.#checks.get(client.id);
    if (timer !== undefined) clearInterval(timer);
    this.#checks.delete(client.id);
    const grant = this.#observers.get(client.id);
    this.#observers.delete(client.id);
    if (grant)
      void this.realtime.observation(grant, 'stopped').catch(() => {
        instruments.operationFailures.add(1, { operation: 'runtime.observation.audit' });
        this.#logger.error('Observation stop audit unavailable');
      });
  }
  publish(tenantId: string, sessionId: string, payload: Record<string, unknown>): void {
    if (!this.#ready) throw new Error('Runtime channel unavailable');
    this.server.to(room(tenantId, sessionId)).emit('runtime.event', payload);
  }
  onModuleDestroy(): void {
    for (const check of this.#checks.values()) clearInterval(check);
    this.#checks.clear();
  }
  onApplicationShutdown(): void {
    for (const client of this.#clients) client.disconnect();
  }
}
