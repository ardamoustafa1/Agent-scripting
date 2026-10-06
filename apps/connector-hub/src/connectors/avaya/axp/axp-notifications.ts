import { z } from 'zod';

import { backoffDelay, ConnectorError, type ConnectorLogger } from '@verbis/sdk-connector';

import type { AxpClient } from './axp-client.js';
import type { Scheduler, SocketFactory, SocketLike } from '../../genesys-cloud/notifications.js';

const SubscriptionSchema = z.looseObject({
  subscriptionId: z.string().min(1).max(128),
  transport: z
    .looseObject({
      endpoint: z.string().max(2_048).optional(),
      url: z.string().max(2_048).optional(),
    })
    .optional(),
});

export const PING_INTERVAL_MS = 30_000;

/**
 * AXP Notification API: `POST /api/notification/v1/accounts/{accountId}/subscriptions`
 * (`family: AGENT_ENGAGEMENT`, `transport: WEBSOCKET`) → open the returned endpoint (must be
 * `wss://*.avayacloud.com`) → send `{subscriptionId, token}` → stream. `ping` every 30 s;
 * reconnect with jittered backoff and a fresh token; a 404 on resubscribe creates a new one.
 */
export class AxpNotificationStream {
  #socket: SocketLike | undefined;
  #subscriptionId: string | undefined;
  #endpoint: string | undefined;
  #stopped = false;
  #attempt = 0;
  readonly #timers = new Set<unknown>();

  constructor(
    private readonly deps: {
      readonly client: AxpClient;
      readonly accountId: string;
      readonly socket: SocketFactory;
      readonly scheduler: Scheduler;
      readonly logger: ConnectorLogger;
      readonly random?: () => number;
      readonly onNotification: (frame: unknown) => void;
    },
  ) {}

  get connected(): boolean {
    return this.#socket?.readyState === 1;
  }

  async start(): Promise<void> {
    this.#stopped = false;
    await this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    for (const timer of this.#timers) this.deps.scheduler.clearTimeout(timer);
    this.#timers.clear();
    this.#socket?.close(1000, 'shutdown');
    this.#socket = undefined;
  }

  #isStopped(): boolean {
    return this.#stopped;
  }

  async #connect(): Promise<void> {
    if (this.#subscriptionId === undefined || this.#endpoint === undefined) {
      const created = await this.deps.client.request(
        'POST',
        `/api/notification/v1/accounts/${encodeURIComponent(this.deps.accountId)}/subscriptions`,
        SubscriptionSchema,
        { family: 'AGENT_ENGAGEMENT', transport: { type: 'WEBSOCKET' } },
        false,
      );
      const endpoint = created.transport?.endpoint ?? created.transport?.url;
      if (endpoint === undefined || !isAvayaWss(endpoint))
        throw new ConnectorError('Unexpected AXP notification endpoint', 'axp_bad_response', false);
      this.#subscriptionId = created.subscriptionId;
      this.#endpoint = endpoint;
    }
    if (this.#isStopped()) return;
    const token = await this.deps.client.token();
    if (this.#isStopped()) return;
    const socket = this.deps.socket(this.#endpoint);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => {
        resolve();
      });
      socket.addEventListener('error', () => {
        reject(new ConnectorError('AXP socket failed', 'axp_socket_failed', true));
      });
    });
    if (this.#isStopped()) {
      socket.close(1000, 'shutdown');
      return;
    }
    socket.send(JSON.stringify({ subscriptionId: this.#subscriptionId, token }));
    socket.addEventListener('message', (event) => {
      this.#frame(socket, event.data);
    });
    socket.addEventListener('close', () => {
      this.#closed(socket);
    });
    this.#socket = socket;
    this.#attempt = 0;
    this.#ping(socket);
  }

  #frame(socket: SocketLike, data: unknown): void {
    if (socket !== this.#socket) return;
    const text = typeof data === 'string' ? data : String(data);
    if (text === 'pong' || text === 'ping') return;
    let frame: unknown;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    const error = (frame as { error?: unknown; code?: unknown } | null)?.error;
    if (error !== undefined) {
      // Expired/unknown subscription ⇒ recreate on reconnect.
      this.#subscriptionId = undefined;
      socket.close(4000, 'subscription error');
      return;
    }
    this.deps.onNotification(frame);
  }

  #ping(socket: SocketLike): void {
    const handle = this.deps.scheduler.setTimeout(() => {
      this.#timers.delete(handle);
      if (this.#stopped || socket !== this.#socket) return;
      socket.send('ping');
      this.#ping(socket);
    }, PING_INTERVAL_MS);
    this.#timers.add(handle);
  }

  #closed(socket: SocketLike): void {
    if (this.#stopped || socket !== this.#socket) return;
    this.#socket = undefined;
    this.#reconnectLater();
  }

  #reconnectLater(): void {
    const delay = backoffDelay(this.#attempt, {
      baseMs: 1_000,
      maxMs: 60_000,
      ...(this.deps.random === undefined ? {} : { random: this.deps.random }),
    });
    this.#attempt += 1;
    this.deps.logger.warn('axp notifications reconnecting', { delayMs: delay });
    const handle = this.deps.scheduler.setTimeout(() => {
      this.#timers.delete(handle);
      if (this.#stopped) return;
      this.#connect().catch(() => {
        this.#subscriptionId = undefined;
        this.#reconnectLater();
      });
    }, delay);
    this.#timers.add(handle);
  }
}

export function isAvayaWss(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'wss:' && /(^|\.)avayacloud\.com$/.test(parsed.hostname);
  } catch {
    return false;
  }
}
