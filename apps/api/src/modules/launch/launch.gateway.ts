import { Inject, type OnModuleDestroy } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Namespace, type Socket } from 'socket.io';

import { LaunchRealtime, userRoom } from './launch-realtime.js';

/** Offer delivery only; launches are redeemed over HTTP (BFF + CSRF + RLS). */
@WebSocketGateway({
  namespace: '/launch',
  transports: ['websocket'],
  maxHttpBufferSize: 1_024,
  serveClient: false,
})
export class LaunchGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer() server!: Namespace;
  readonly #checks = new Map<string, ReturnType<typeof setInterval>>();

  constructor(@Inject(LaunchRealtime) private readonly realtime: LaunchRealtime) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const grant = await this.realtime.consume(
        (client.handshake.auth as Record<string, unknown>)['ticket'],
        client.handshake.headers.origin,
      );
      await client.join(userRoom(grant.tenantId, grant.userId));
      client.emit('launch.ready', {});
      const check = setInterval(() => {
        void this.realtime.validate(grant).catch(() => client.disconnect(true));
      }, 15_000);
      check.unref();
      this.#checks.set(client.id, check);
    } catch {
      client.emit('launch.error', { code: 'VERBIS_AUTHZ_FORBIDDEN' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const timer = this.#checks.get(client.id);
    if (timer !== undefined) clearInterval(timer);
    this.#checks.delete(client.id);
  }

  offer(
    tenantId: string,
    userId: string,
    offer: { code: string; intentId: string; interactionId: string; expiresAt: string },
  ): void {
    this.server.to(userRoom(tenantId, userId)).emit('launch.offer', offer);
  }

  onModuleDestroy(): void {
    for (const check of this.#checks.values()) clearInterval(check);
  }
}
