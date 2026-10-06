import { afterEach, describe, expect, it, vi } from 'vitest';

import { RuntimeGateway } from './runtime.gateway.js';

import type { RuntimeRealtimeService } from './runtime-realtime.service.js';
import type { RedisService } from '../../infra/redis/redis.service.js';
import type { Namespace, Socket } from 'socket.io';

afterEach(() => vi.useRealTimers());
describe('gateway lifecycle and reconnect', () => {
  async function harness() {
    const realtime = {
      consume: vi.fn().mockResolvedValue({ tenantId: 'tenant', sessionId: 'session' }),
      resume: vi.fn().mockResolvedValue({ sequence: 3, reset: false, events: [{ seq: 3 }] }),
      validate: vi.fn().mockResolvedValue(undefined),
    };
    const publisher = {
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      status: 'ready',
      disconnect: vi.fn(),
      duplicate: vi.fn(),
      psubscribe: vi.fn(),
      subscribe: vi.fn(),
    };
    publisher.duplicate.mockReturnValue(publisher);
    const redis = { client: { duplicate: vi.fn().mockReturnValue(publisher) } };
    const server = { server: { adapter: vi.fn() } };
    const gateway = new RuntimeGateway(
      realtime as unknown as RuntimeRealtimeService,
      redis as unknown as RedisService,
    );
    await gateway.afterInit(server as unknown as Namespace);
    return { gateway, realtime, publisher };
  }
  function client(id: string, ticket: string) {
    return {
      id,
      connected: true,
      handshake: { auth: { ticket }, headers: { origin: 'https://agent.example' } },
      join: vi.fn().mockResolvedValue(undefined),
      emit: vi.fn(),
      disconnect: vi.fn(),
    };
  }
  it('keeps Redis alive until Socket.IO has closed its adapter', async () => {
    const { gateway, publisher } = await harness();
    gateway.onModuleDestroy();
    expect(publisher.disconnect).not.toHaveBeenCalled();
    gateway.onApplicationShutdown();
    expect(publisher.disconnect).toHaveBeenCalledTimes(2);
  });
  it('joins a tenant-scoped room and resynchronizes after a fresh-ticket reconnect', async () => {
    vi.useFakeTimers();
    const { gateway, realtime } = await harness();
    const first = client('first', 'ticket-1');
    await gateway.handleConnection(first as unknown as Socket);
    expect(first.join).toHaveBeenCalledWith('runtime:tenant:session');
    expect(first.emit).toHaveBeenCalledWith(
      'runtime.resume',
      expect.objectContaining({ sequence: 3 }),
    );
    gateway.handleDisconnect(first as unknown as Socket);
    realtime.resume.mockResolvedValueOnce({ sequence: 4, reset: false, events: [{ seq: 4 }] });
    const second = client('second', 'ticket-2');
    await gateway.handleConnection(second as unknown as Socket);
    expect(realtime.consume).toHaveBeenLastCalledWith('ticket-2', 'https://agent.example');
    expect(second.emit).toHaveBeenCalledWith(
      'runtime.resume',
      expect.objectContaining({ sequence: 4 }),
    );
    gateway.onModuleDestroy();
  });
  it('disconnects revoked BFF sessions and rejects invalid handshake tickets', async () => {
    vi.useFakeTimers();
    const { gateway, realtime } = await harness();
    const connected = client('connected', 'ticket');
    await gateway.handleConnection(connected as unknown as Socket);
    realtime.validate.mockRejectedValueOnce(new Error('revoked'));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(connected.disconnect).toHaveBeenCalledWith(true);
    gateway.handleDisconnect(connected as unknown as Socket);
    realtime.consume.mockRejectedValueOnce(new Error('invalid'));
    const denied = client('denied', 'invalid');
    await gateway.handleConnection(denied as unknown as Socket);
    expect(denied.join).not.toHaveBeenCalled();
    expect(denied.disconnect).toHaveBeenCalledWith(true);
    gateway.onModuleDestroy();
  });
});
