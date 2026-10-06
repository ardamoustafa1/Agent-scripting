import { describe, expect, it, vi } from 'vitest';

import { Keyring } from '../identity/crypto/keyring.js';

import { tokenHash } from './runtime-engine.service.js';
import {
  RuntimeRealtimeService,
  reconnectPlan,
  room,
  type RuntimeGrant,
} from './runtime-realtime.service.js';

import type { RuntimeEngineService } from './runtime-engine.service.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { RedisService } from '../../infra/redis/redis.service.js';
import type { AbilityFactory } from '../authz/ability.factory.js';
import type { SessionStore } from '../identity/session/session-store.js';

const id = '01900000-0000-7000-8000-000000000001';
describe('WebSocket recovery', () => {
  it('replays a contiguous sequence and resets on a gap, excessive backlog or future cursor', () => {
    expect(reconnectPlan(4, 2, [3, 4])).toEqual({ reset: false, sequence: 4 });
    expect(reconnectPlan(4, 2, [4]).reset).toBe(true);
    expect(reconnectPlan(4, 2, [4, 3]).reset).toBe(true);
    expect(reconnectPlan(4, 5, []).reset).toBe(true);
    expect(
      reconnectPlan(
        201,
        0,
        Array.from({ length: 201 }, (_, i) => i + 1),
      ).reset,
    ).toBe(true);
    expect(reconnectPlan(4, 4, []).reset).toBe(false);
  });
  it('separates tenant rooms even with the same session handle', () => {
    expect(room('tenant-a', id)).not.toBe(room('tenant-b', id));
  });
  function harness(origin = 'https://agent.example', expiresAt = Date.now() + 30_000) {
    const keys = new Keyring(`test:${Buffer.alloc(32, 1).toString('base64')}`),
      ticket = 'a'.repeat(43),
      slot = `runtime:ticket:${tokenHash(ticket)}`;
    const grant: RuntimeGrant = {
      tenantId: id,
      userId: id,
      bffId: id,
      bffHash: 'b'.repeat(64),
      sessionId: id,
      origin,
      afterSequence: 0,
      expiresAt,
      supervisor: false,
    };
    let value: string | null = keys.seal(JSON.stringify(grant), slot);
    const redis = {
      client: {
        getdel: vi.fn(() => {
          const result = value;
          value = null;
          return Promise.resolve(result);
        }),
      },
    } as unknown as RedisService;
    const realtime = new RuntimeRealtimeService(
      redis,
      keys,
      {} as SessionStore,
      {} as TenantDb,
      {} as AbilityFactory,
      {} as RuntimeEngineService,
    );
    const validate = vi.spyOn(realtime, 'validate').mockResolvedValue();
    return { realtime, ticket, validate };
  }
  it('consumes a ticket exactly once; reconnect requires a fresh ticket', async () => {
    const { realtime, ticket, validate } = harness();
    await expect(realtime.consume(ticket, 'https://agent.example')).resolves.toMatchObject({
      sessionId: id,
    });
    expect(validate).toHaveBeenCalledOnce();
    await expect(realtime.consume(ticket, 'https://agent.example')).rejects.toThrow();
  });
  it('rejects different origins, expired grants and query-shaped credentials', async () => {
    await expect(
      harness().realtime.consume('a'.repeat(43), 'https://attacker.example'),
    ).rejects.toThrow();
    await expect(
      harness('https://agent.example', 0).realtime.consume('a'.repeat(43), 'https://agent.example'),
    ).rejects.toThrow();
    await expect(
      harness().realtime.consume('Bearer token', 'https://agent.example'),
    ).rejects.toThrow();
  });
  it('disconnects admission when BFF revocation validation fails', async () => {
    const { realtime, ticket, validate } = harness();
    validate.mockRejectedValue(new Error('revoked'));
    await expect(realtime.consume(ticket, 'https://agent.example')).rejects.toThrow('revoked');
  });
});
