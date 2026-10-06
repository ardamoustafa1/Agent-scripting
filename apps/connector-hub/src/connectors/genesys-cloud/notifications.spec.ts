import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeGenesys, FakeSocket } from '../../test/fake-genesys.js';

import { GenesysCloudClient } from './genesys-client.js';
import {
  HEARTBEAT_TIMEOUT_MS,
  MAX_TOPICS_PER_CHANNEL,
  NotificationChannel,
  shardTopics,
} from './notifications.js';

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

function setup(connectUriDomain?: string) {
  const fake = new FakeGenesys(undefined, 'mypurecloud.de');
  const sockets: FakeSocket[] = [];
  const frames: unknown[] = [];
  const client = new GenesysCloudClient(
    'eu-central-1',
    () => Promise.resolve({ clientId: 'id', clientSecret: 's' }),
    { fetch: fake.fetch, sleep: () => Promise.resolve() },
  );
  const channel = new NotificationChannel({
    client,
    region: 'eu-central-1',
    socket: (url) => {
      const socket = new FakeSocket(
        connectUriDomain === undefined ? url : url.replace('mypurecloud.de', connectUriDomain),
      );
      sockets.push(socket);
      void Promise.resolve().then(() => {
        socket.open();
      });
      return socket;
    },
    scheduler: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => {
        clearTimeout(h as NodeJS.Timeout);
      },
    },
    now: () => new Date(),
    logger,
    random: () => 0.5,
    onNotification: (frame) => frames.push(frame),
  });
  return { fake, sockets, frames, channel };
}

describe('genesys notifications channel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-10-01T10:00:00.000Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a channel, subscribes topics, then forwards frames (heartbeats are swallowed)', async () => {
    const { fake, sockets, frames, channel } = setup();
    await channel.start(['v2.users.u1.conversations', 'v2.routing.queues.q1.conversations']);
    expect(fake.requests('PUT', /subscriptions$/)[0]?.body).toEqual([
      { id: 'v2.users.u1.conversations' },
      { id: 'v2.routing.queues.q1.conversations' },
    ]);
    expect(sockets[0]?.url).toBe('wss://streaming.mypurecloud.de/channels/channel-1');
    sockets[0]?.frame({
      topicName: 'channel.metadata',
      eventBody: { message: 'WebSocket Heartbeat' },
    });
    sockets[0]?.frame({
      topicName: 'v2.users.u1.conversations',
      eventBody: { id: 'c1', participants: [] },
    });
    expect(frames).toEqual([
      { topicName: 'v2.users.u1.conversations', eventBody: { id: 'c1', participants: [] } },
    ]);
    expect(channel.connected).toBe(true);
    channel.stop();
  });

  it('refuses a connectUri outside the region streaming host', async () => {
    const { fake, channel } = setup();
    const original = fake.fetch;
    // Rewrite the channel response to an attacker host.
    const evil = (async (input: string | URL, init?: RequestInit) => {
      const response = await original(input, init);
      if (String(input).endsWith('/api/v2/notifications/channels'))
        return Response.json({ id: 'x', connectUri: 'wss://evil.example/channels/x' });
      return response;
    }) as typeof fetch;
    const client = new GenesysCloudClient(
      'eu-central-1',
      () => Promise.resolve({ clientId: 'id', clientSecret: 's' }),
      { fetch: evil },
    );
    const bad = new NotificationChannel({
      client,
      region: 'eu-central-1',
      socket: () => new FakeSocket('x'),
      scheduler: {
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (h) => {
          clearTimeout(h as NodeJS.Timeout);
        },
      },
      now: () => new Date(),
      logger,
      onNotification: () => undefined,
    });
    await expect(bad.start(['v2.users.u1.conversations'])).rejects.toMatchObject({
      code: 'genesys_bad_response',
    });
    channel.stop();
  });

  it('renews on v2.system.socket_closing: new channel + resubscribe before closing the old socket', async () => {
    const { fake, sockets, channel } = setup();
    await channel.start(['v2.users.u1.conversations']);
    sockets[0]?.frame({ topicName: 'v2.system.socket_closing', eventBody: { message: 'closing' } });
    await vi.waitFor(() => {
      expect(sockets).toHaveLength(2);
    });
    await vi.waitFor(() => {
      expect(sockets[0]?.closedWith).toBe(1000);
    });
    expect(fake.requests('PUT', /subscriptions$/)).toHaveLength(2);
    expect(channel.channelId).toBe('channel-2');
    channel.stop();
  });

  it('reconnects with backoff after an unexpected drop and resubscribes', async () => {
    const { fake, sockets, channel } = setup();
    await channel.start(['v2.users.u1.conversations']);
    sockets[0]?.drop();
    expect(channel.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => {
      expect(sockets).toHaveLength(2);
    });
    expect(fake.requests('PUT', /subscriptions$/)).toHaveLength(2);
    channel.stop();
  });

  it('treats heartbeat silence as a dead socket', async () => {
    const { sockets, channel } = setup();
    await channel.start(['v2.users.u1.conversations']);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_TIMEOUT_MS + 30_000);
    expect(sockets[0]?.closedWith).toBe(4000);
    await vi.waitFor(() => {
      expect(sockets.length).toBeGreaterThanOrEqual(2);
    });
    channel.stop();
  });

  it('renews before the 24 h channel expiry', async () => {
    const { sockets, channel } = setup();
    await channel.start(['v2.users.u1.conversations']);
    // expires 2026-10-02T10:00Z, renew 30 min before. Keep heartbeats flowing meanwhile.
    for (let t = 0; t < 24 * 60; t += 1) {
      sockets
        .at(-1)
        ?.frame({ topicName: 'channel.metadata', eventBody: { message: 'WebSocket Heartbeat' } });
      await vi.advanceTimersByTimeAsync(60_000);
      if (sockets.length > 1) break;
    }
    expect(sockets.length).toBe(2);
    expect(Date.now()).toBeLessThan(Date.parse('2026-10-02T10:00:00.000Z'));
    channel.stop();
  });

  it('shards topics at 1,000 per channel', () => {
    const topics = Array.from({ length: 2_500 }, (_, i) => `v2.users.u${String(i)}.conversations`);
    expect(shardTopics(topics).map((s) => s.length)).toEqual([
      MAX_TOPICS_PER_CHANNEL,
      MAX_TOPICS_PER_CHANNEL,
      500,
    ]);
    expect(() => shardTopics(Array.from({ length: 20_001 }, (_, i) => `t${String(i)}`))).toThrow();
  });
});
