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
      observation: vi.fn().mockResolvedValue(undefined),
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
    const emit = vi.fn();
    const server = { server: { adapter: vi.fn() }, to: vi.fn().mockReturnValue({ emit }) };
    const gateway = new RuntimeGateway(
      realtime as unknown as RuntimeRealtimeService,
      redis as unknown as RedisService,
    );
    await gateway.afterInit(server as unknown as Namespace);
    gateway.server = server as unknown as Namespace;
    return { gateway, realtime, publisher, server, emit };
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
    expect(first.join).toHaveBeenCalledWith([
      'runtime:tenant:session',
      'runtime:tenant:session:owner',
    ]);
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
  it('audits start and stop only once for a supervisor connection', async () => {
    const f = await harness();
    const grant = { tenantId: 'tenant', sessionId: 'session', supervisor: true };
    f.realtime.consume.mockResolvedValue(grant);
    const c = client('supervisor', 'ticket');
    await f.gateway.handleConnection(c as unknown as Socket);
    expect(f.realtime.observation).toHaveBeenCalledWith(grant, 'started');
    f.gateway.handleDisconnect(c as unknown as Socket);
    f.gateway.handleDisconnect(c as unknown as Socket);
    expect(f.realtime.observation).toHaveBeenCalledWith(grant, 'stopped');
    expect(f.realtime.observation).toHaveBeenCalledTimes(2);
  });
  it('keeps supervisors out of the owner room that carries transcript text', async () => {
    const f = await harness();
    f.realtime.consume.mockResolvedValue({
      tenantId: 'tenant',
      sessionId: 'session',
      supervisor: true,
    });
    const c = client('supervisor', 'ticket');
    await f.gateway.handleConnection(c as unknown as Socket);
    expect(c.join).toHaveBeenCalledWith('runtime:tenant:session');
    f.gateway.handleDisconnect(c as unknown as Socket);
  });
  it('sends transcript lines to the owner room only, and not while the channel is down', async () => {
    const f = await harness();
    expect(f.gateway.transcript('tenant', 'session', { segmentId: 's1' })).toBe(true);
    expect(f.server.to).toHaveBeenCalledWith('runtime:tenant:session:owner');
    expect(f.emit).toHaveBeenCalledWith('runtime.transcript', { segmentId: 's1' });
    const down = new RuntimeGateway(
      f.realtime as unknown as RuntimeRealtimeService,
      { client: { duplicate: vi.fn() } } as unknown as RedisService,
    );
    expect(down.transcript('tenant', 'session', { segmentId: 's2' })).toBe(false);
  });
});
