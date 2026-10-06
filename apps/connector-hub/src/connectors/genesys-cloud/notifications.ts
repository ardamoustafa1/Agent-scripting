import { z } from 'zod';

import {
  backoffDelay,
  ConnectorError,
  isGenesysStreamingUrl,
  type ConnectorLogger,
  type GenesysCloudRegion,
} from '@verbis/sdk-connector';

import type { GenesysCloudClient } from './genesys-client.js';

/** Minimal WebSocket surface (Node 24 global `WebSocket`; fakes in tests). */
export interface SocketLike {
  readonly readyState: number;
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
export type SocketFactory = (url: string) => SocketLike;

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const ChannelSchema = z.object({
  id: z.string().min(1).max(128),
  connectUri: z.string().max(2_048),
  expires: z.string().optional(),
});

/** Topics per channel (Genesys limit 1,000) and channels per user/app (limit 20). */
export const MAX_TOPICS_PER_CHANNEL = 1_000;
export const MAX_CHANNELS = 20;
/** Genesys sends a heartbeat every 30 s; silence beyond this ⇒ the socket is dead. */
export const HEARTBEAT_TIMEOUT_MS = 95_000;
/** Channels live 24 h; renew well before (make-before-break). */
export const DEFAULT_CHANNEL_TTL_MS = 24 * 60 * 60 * 1_000;
export const RENEW_BEFORE_MS = 30 * 60 * 1_000;
export const OPEN_TIMEOUT_MS = 15_000;

export interface NotificationChannelDeps {
  readonly client: GenesysCloudClient;
  readonly region: GenesysCloudRegion;
  readonly socket: SocketFactory;
  readonly scheduler: Scheduler;
  readonly now: () => Date;
  readonly logger: ConnectorLogger;
  readonly random?: () => number;
  /** Raw frame (already JSON-parsed) for a subscribed topic. */
  readonly onNotification: (frame: unknown) => void;
}

interface Live {
  readonly channelId: string;
  readonly socket: SocketLike;
  readonly expiresAt: number;
}

/**
 * One Notifications API channel: `POST /api/v2/notifications/channels` → open `connectUri` →
 * `PUT …/channels/{id}/subscriptions`. Handles heartbeats (`channel.metadata`), the
 * `v2.system.socket_closing` warning, unexpected closes (reconnect with jittered backoff) and
 * expiry (a new channel is created, subscribed and opened before the old one is closed, so no
 * events are lost; overlapping duplicates are deduplicated by the connector).
 */
export class NotificationChannel {
  #live: Live | undefined;
  #topics: string[] = [];
  #stopped = false;
  #attempt = 0;
  #lastFrameAt = 0;
  #timers = new Set<unknown>();
  #connecting: Promise<void> | undefined;

  constructor(private readonly deps: NotificationChannelDeps) {}

  get connected(): boolean {
    return this.#live !== undefined && this.#live.socket.readyState === 1;
  }

  get channelId(): string | undefined {
    return this.#live?.channelId;
  }

  async start(topics: readonly string[]): Promise<void> {
    if (topics.length > MAX_TOPICS_PER_CHANNEL)
      throw new ConnectorError('Too many topics for one channel', 'genesys_topic_limit', false);
    this.#topics = [...topics];
    this.#stopped = false;
    await this.#connect();
    this.#watchdog();
  }

  /** Replaces the subscription set on the live channel (agents added/removed). */
  async resubscribe(topics: readonly string[]): Promise<void> {
    if (topics.length > MAX_TOPICS_PER_CHANNEL)
      throw new ConnectorError('Too many topics for one channel', 'genesys_topic_limit', false);
    this.#topics = [...topics];
    if (this.#live !== undefined) await this.#subscribe(this.#live.channelId);
  }

  stop(): void {
    this.#stopped = true;
    for (const timer of this.#timers) this.deps.scheduler.clearTimeout(timer);
    this.#timers.clear();
    this.#live?.socket.close(1000, 'shutdown');
    this.#live = undefined;
  }

  #connect(): Promise<void> {
    this.#connecting ??= this.#open().finally(() => {
      this.#connecting = undefined;
    });
    return this.#connecting;
  }

  async #open(): Promise<void> {
    const created = await this.deps.client.request(
      'POST',
      '/api/v2/notifications/channels',
      ChannelSchema,
      { idempotent: false },
    );
    if (!isGenesysStreamingUrl(this.deps.region, created.connectUri))
      throw new ConnectorError(
        'Unexpected notification connectUri host',
        'genesys_bad_response',
        false,
      );
    await this.#subscribe(created.id);
    const socket = this.deps.socket(created.connectUri);
    await new Promise<void>((resolve, reject) => {
      const timer = this.deps.scheduler.setTimeout(() => {
        socket.close(4001, 'open timeout');
        reject(
          new ConnectorError('Notification socket open timed out', 'genesys_socket_failed', true),
        );
      }, OPEN_TIMEOUT_MS);
      socket.addEventListener('open', () => {
        this.deps.scheduler.clearTimeout(timer);
        resolve();
      });
      socket.addEventListener('error', () => {
        this.deps.scheduler.clearTimeout(timer);
        reject(new ConnectorError('Notification socket failed', 'genesys_socket_failed', true));
      });
    });
    const now = this.deps.now().getTime();
    const expires = created.expires === undefined ? Number.NaN : Date.parse(created.expires);
    const live: Live = {
      channelId: created.id,
      socket,
      expiresAt: Number.isNaN(expires) ? now + DEFAULT_CHANNEL_TTL_MS : expires,
    };
    socket.addEventListener('message', (event) => {
      this.#frame(live, event.data);
    });
    socket.addEventListener('close', () => {
      this.#closed(live);
    });
    const previous = this.#live;
    this.#live = live;
    this.#lastFrameAt = now;
    this.#attempt = 0;
    previous?.socket.close(1000, 'renewed');
    this.#schedule(
      () => void this.#renew('expiry'),
      Math.max(60_000, live.expiresAt - now - RENEW_BEFORE_MS),
    );
    this.deps.logger.info('genesys notifications channel open', {
      channelId: created.id,
      topics: this.#topics.length,
    });
  }

  async #subscribe(channelId: string): Promise<void> {
    await this.deps.client.request(
      'PUT',
      `/api/v2/notifications/channels/${encodeURIComponent(channelId)}/subscriptions`,
      z.unknown(),
      {
        body: this.#topics.map((id) => ({ id })),
      },
    );
  }

  #frame(live: Live, data: unknown): void {
    if (live !== this.#live) return;
    this.#lastFrameAt = this.deps.now().getTime();
    let frame: unknown;
    try {
      frame = JSON.parse(typeof data === 'string' ? data : String(data));
    } catch {
      this.deps.logger.warn('genesys notification frame is not JSON');
      return;
    }
    const topic = (frame as { topicName?: unknown } | null)?.topicName;
    if (topic === 'channel.metadata') return; // heartbeat / pong
    if (topic === 'v2.system.socket_closing') {
      void this.#renew('socket_closing');
      return;
    }
    this.deps.onNotification(frame);
  }

  #closed(live: Live): void {
    if (this.#stopped || live !== this.#live) return;
    this.#live = undefined;
    this.#reconnectLater('socket closed');
  }

  async #renew(reason: string): Promise<void> {
    if (this.#stopped) return;
    try {
      await this.#connect();
      this.deps.logger.info('genesys notifications channel renewed', { reason });
    } catch (error) {
      this.#reconnectLater(error instanceof Error ? error.message : 'renew failed');
    }
  }

  #reconnectLater(reason: string): void {
    if (this.#stopped) return;
    const delay = backoffDelay(this.#attempt, {
      baseMs: 1_000,
      maxMs: 60_000,
      ...(this.deps.random === undefined ? {} : { random: this.deps.random }),
    });
    this.#attempt += 1;
    this.deps.logger.warn('genesys notifications reconnecting', {
      reason,
      delayMs: delay,
      attempt: this.#attempt,
    });
    this.#schedule(() => {
      if (this.#stopped) return;
      this.#connect().catch((error: unknown) => {
        this.#reconnectLater(error instanceof Error ? error.message : 'connect failed');
      });
    }, delay);
  }

  #watchdog(): void {
    this.#schedule(() => {
      if (this.#stopped) return;
      const live = this.#live;
      if (
        live !== undefined &&
        this.deps.now().getTime() - this.#lastFrameAt > HEARTBEAT_TIMEOUT_MS
      ) {
        this.#live = undefined;
        live.socket.close(4000, 'heartbeat timeout');
        this.#reconnectLater('heartbeat timeout');
      }
      this.#watchdog();
    }, 30_000);
  }

  #schedule(fn: () => void, ms: number): void {
    const handle = this.deps.scheduler.setTimeout(() => {
      this.#timers.delete(handle);
      fn();
    }, ms);
    this.#timers.add(handle);
  }
}

/** Splits topics over channels (≤ 1,000 each, ≤ 20 channels). */
export function shardTopics(topics: readonly string[]): string[][] {
  const unique = [...new Set(topics)];
  if (unique.length > MAX_TOPICS_PER_CHANNEL * MAX_CHANNELS)
    throw new ConnectorError('Too many notification topics', 'genesys_topic_limit', false);
  const shards: string[][] = [];
  for (let i = 0; i < unique.length; i += MAX_TOPICS_PER_CHANNEL)
    shards.push(unique.slice(i, i + MAX_TOPICS_PER_CHANNEL));
  return shards;
}
