import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { FakeSocket } from '../../../test/fake-genesys.js';

import { AxpClient } from './axp-client.js';
import { AxpNotificationStream, isAvayaWss, PING_INTERVAL_MS } from './axp-notifications.js';

const streams: AxpNotificationStream[] = [];
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  streams.splice(0).forEach((stream) => {
    stream.stop();
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function setup(endpoint = 'wss://stream.avayacloud.com/notification', autoOpen = true) {
  const client = new AxpClient({ host: 'na.api.avayacloud.com', accountId: 'account' }, () =>
    Promise.resolve({ clientId: 'synthetic', clientSecret: 'synthetic', appKey: 'synthetic' }),
  );
  const request = vi
    .spyOn(client, 'request')
    .mockResolvedValue({ subscriptionId: 'subscription', transport: { endpoint } });
  const token = vi.spyOn(client, 'token').mockResolvedValue('synthetic-token');
  const sockets: FakeSocket[] = [],
    onNotification = vi.fn(),
    warn = vi.fn();
  const stream = new AxpNotificationStream({
    client,
    accountId: 'account/encoded',
    random: () => 0.5,
    logger: { info: vi.fn(), warn, error: vi.fn() },
    onNotification,
    scheduler: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => {
        clearTimeout(handle as NodeJS.Timeout);
      },
    },
    socket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      if (autoOpen)
        void Promise.resolve().then(() => {
          socket.open();
        });
      return socket;
    },
  });
  streams.push(stream);
  return { stream, request, token, sockets, onNotification, warn };
}
it('subscribes with the encoded account, authenticates, forwards JSON and ignores heartbeats and malformed frames', async () => {
  const f = setup();
  await f.stream.start();
  expect(f.request).toHaveBeenCalledWith(
    'POST',
    '/api/notification/v1/accounts/account%2Fencoded/subscriptions',
    expect.anything(),
    { family: 'AGENT_ENGAGEMENT', transport: { type: 'WEBSOCKET' } },
    false,
  );
  expect(f.stream.connected).toBe(true);
  expect(f.sockets[0]?.sent).toEqual([
    JSON.stringify({ subscriptionId: 'subscription', token: 'synthetic-token' }),
  ]);
  for (const data of ['ping', 'pong', '{invalid']) f.sockets[0]?.emit('message', { data });
  f.sockets[0]?.emit('message', { data: { toString: () => '{"event":"contact"}' } });
  f.sockets[0]?.frame(null);
  expect(f.onNotification.mock.calls).toEqual([[{ event: 'contact' }], [null]]);
  await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS * 2);
  expect(f.sockets[0]?.sent.slice(1)).toEqual(['ping', 'ping']);
  f.stream.stop();
  expect(f.sockets[0]?.closedWith).toBe(1000);
  expect(vi.getTimerCount()).toBe(0);
});
it('reuses a healthy subscription after a disconnect and ignores stale socket frames', async () => {
  const f = setup();
  await f.stream.start();
  f.sockets[0]?.drop();
  expect(f.stream.connected).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.sockets).toHaveLength(2);
  expect(f.request).toHaveBeenCalledOnce();
  expect(f.token).toHaveBeenCalledTimes(2);
  f.sockets[0]?.frame({ obsolete: true });
  f.sockets[1]?.frame({ current: true });
  expect(f.onNotification.mock.calls).toEqual([[{ current: true }]]);
  await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
  expect(f.sockets[0]?.sent).toHaveLength(1);
  expect(f.sockets[1]?.sent).toContain('ping');
});
it('recreates expired subscriptions and retries a failed reconnect with bounded backoff', async () => {
  const f = setup();
  await f.stream.start();
  f.sockets[0]?.frame({ error: 'subscription expired' });
  expect(f.sockets[0]?.closedWith).toBe(4000);
  f.request.mockRejectedValueOnce(new Error('synthetic unavailable'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.sockets).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.sockets).toHaveLength(2);
  expect(f.request).toHaveBeenCalledTimes(3);
  expect(f.onNotification).not.toHaveBeenCalled();
  expect(f.warn).toHaveBeenCalledTimes(2);
});
it.each([
  'http://stream.avayacloud.com/x',
  'wss://avayacloud.com.evil.test/x',
  'wss://evilavayacloud.com/x',
  'invalid',
])('rejects untrusted notification endpoint %s before sending a token', async (url) => {
  const f = setup(url);
  await expect(f.stream.start()).rejects.toMatchObject({
    code: 'axp_bad_response',
    retryable: false,
  });
  expect(f.token).not.toHaveBeenCalled();
  expect(f.sockets).toHaveLength(0);
});
it('accepts the alternate transport URL and rejects missing transport data', async () => {
  const f = setup();
  f.request.mockResolvedValueOnce({
    subscriptionId: 'subscription',
    transport: { url: 'wss://avayacloud.com/ws' },
  });
  await f.stream.start();
  expect(f.sockets[0]?.url).toBe('wss://avayacloud.com/ws');
  const missing = setup();
  missing.request.mockResolvedValueOnce({ subscriptionId: 'subscription' });
  await expect(missing.stream.start()).rejects.toMatchObject({ code: 'axp_bad_response' });
  expect(isAvayaWss('wss://avayacloud.com/ws')).toBe(true);
});
it('reports socket startup errors and cancels a scheduled reconnect on shutdown', async () => {
  const f = setup(undefined, false);
  const starting = f.stream.start();
  const failure = expect(starting).rejects.toMatchObject({ code: 'axp_socket_failed' });
  await vi.waitFor(() => {
    expect(f.sockets).toHaveLength(1);
  });
  f.sockets[0]?.emit('error');
  await failure;
  const active = setup();
  await active.stream.start();
  active.sockets[0]?.drop();
  active.stream.stop();
  await vi.advanceTimersByTimeAsync(60000);
  expect(active.sockets).toHaveLength(1);
});
it('does not reopen or authenticate a socket when shutdown interrupts startup', async () => {
  const f = setup();
  let release: ((token: string) => void) | undefined;
  f.token.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  const starting = f.stream.start();
  await vi.waitFor(() => {
    expect(release).toBeDefined();
  });
  f.stream.stop();
  release?.('synthetic');
  await starting;
  expect(f.sockets).toHaveLength(0);
  const pending = setup(undefined, false);
  const opening = pending.stream.start();
  await vi.waitFor(() => {
    expect(pending.sockets).toHaveLength(1);
  });
  pending.stream.stop();
  pending.sockets[0]?.open();
  await opening;
  expect(pending.sockets[0]?.sent).toEqual([]);
  expect(pending.sockets[0]?.closedWith).toBe(1000);
  expect(pending.stream.connected).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
