import { afterEach, expect, it, vi } from 'vitest';

import { LaunchEventsHandler } from './launch-events.handler.js';
import { userRoom, type LaunchRealtime } from './launch-realtime.js';
import { LaunchGateway } from './launch.gateway.js';

import type { EventEnvelope } from '../../infra/outbox/outbox.types.js';
import type { RedisService } from '../../infra/redis/redis.service.js';
import type { Namespace, Socket } from 'socket.io';

const tenantId = '0199a000-0000-7000-8000-000000000001';
const userId = '0199a000-0000-7000-8000-000000000002';
const intentId = '0199a000-0000-7000-8000-000000000003';
const interactionId = '0199a000-0000-7000-8000-000000000004';
afterEach(() => {
  vi.useRealTimers();
});
function socket() {
  return {
    id: 'socket',
    handshake: {
      auth: { ticket: 'one-use-ticket' },
      headers: { origin: 'https://agent.example.com' },
    },
    join: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
}
it('joins only the bound user room and disconnects a revoked grant on periodic validation', async () => {
  vi.useFakeTimers();
  const grant = { tenantId, userId };
  const realtime = {
    consume: vi.fn().mockResolvedValue(grant),
    validate: vi.fn().mockRejectedValue(new Error('revoked')),
  };
  const gateway = new LaunchGateway(realtime as unknown as LaunchRealtime);
  const client = socket();
  await gateway.handleConnection(client as unknown as Socket);
  expect(realtime.consume).toHaveBeenCalledWith('one-use-ticket', 'https://agent.example.com');
  expect(client.join).toHaveBeenCalledWith(userRoom(tenantId, userId));
  expect(client.emit).toHaveBeenCalledWith('launch.ready', {});
  await vi.advanceTimersByTimeAsync(15_000);
  expect(client.disconnect).toHaveBeenCalledWith(true);
  gateway.handleDisconnect(client as unknown as Socket);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(realtime.validate).toHaveBeenCalledOnce();
});
it('keeps handshake failure generic and cleans all timers at shutdown', async () => {
  vi.useFakeTimers();
  const realtime = {
    consume: vi.fn().mockRejectedValue(new Error('sensitive underlying failure')),
    validate: vi.fn(),
  };
  const gateway = new LaunchGateway(realtime as unknown as LaunchRealtime);
  const client = socket();
  await gateway.handleConnection(client as unknown as Socket);
  expect(client.join).not.toHaveBeenCalled();
  expect(client.emit).toHaveBeenCalledWith('launch.error', { code: 'VERBIS_AUTHZ_FORBIDDEN' });
  expect(client.disconnect).toHaveBeenCalledWith(true);
  gateway.handleDisconnect(client as unknown as Socket);
  realtime.consume.mockResolvedValue({ tenantId, userId });
  await gateway.handleConnection(client as unknown as Socket);
  gateway.onModuleDestroy();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(realtime.validate).not.toHaveBeenCalled();
});
it('delivers offers only to the tenant and user room', () => {
  const gateway = new LaunchGateway({} as LaunchRealtime);
  const emit = vi.fn(),
    to = vi.fn().mockReturnValue({ emit });
  gateway.server = { to } as unknown as Namespace;
  const offer = {
    code: 'one-use-code',
    intentId,
    interactionId,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  gateway.offer(tenantId, userId, offer);
  expect(to).toHaveBeenCalledWith(userRoom(tenantId, userId));
  expect(emit).toHaveBeenCalledWith('launch.offer', offer);
});
it('consumes a code once, drops expired events and rejects invalid expiry timestamps', async () => {
  const getdel = vi.fn().mockResolvedValueOnce('single-code').mockResolvedValue(null);
  const offer = vi.fn();
  const handler = new LaunchEventsHandler(
    { offer } as unknown as LaunchGateway,
    { client: { getdel } } as unknown as RedisService,
  );
  const event: EventEnvelope = {
    id: intentId,
    tenantId,
    type: 'verbis.launch.intent.offered.v1',
    aggregate: { type: 'LaunchIntent', id: intentId },
    occurredAt: new Date().toISOString(),
    correlationId: 'c',
    actor: userId,
    payload: {
      intentId,
      userId,
      interactionId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  };
  await handler.handle(event);
  await handler.handle(event);
  expect(offer).toHaveBeenCalledOnce();
  expect(offer).toHaveBeenCalledWith(
    tenantId,
    userId,
    expect.objectContaining({ code: 'single-code' }),
  );
  await handler.handle({
    ...event,
    payload: { ...event.payload, expiresAt: new Date(Date.now() - 1).toISOString() },
  });
  expect(getdel).toHaveBeenCalledTimes(2);
  await expect(
    handler.handle({ ...event, payload: { ...event.payload, expiresAt: 'invalid' } }),
  ).rejects.toThrow();
  expect(getdel).toHaveBeenCalledTimes(2);
});
