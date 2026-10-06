/* Test doubles use asynchronous signatures and Vitest asymmetric matchers. */
/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it, vi } from 'vitest';

import { DraftLeaseService } from './draft-lease.service.js';

import type { RedisService } from '../../infra/redis/redis.service.js';

describe('draft collaboration lease', () => {
  const fixture = (value: string | null) => {
    const client = {
      get: vi.fn(async () => value),
      set: vi.fn(async () => 'OK'),
      eval: vi.fn(async () => 1),
    };
    return { client, service: new DraftLeaseService({ client } as unknown as RedisService) };
  };
  it('blocks ordinary saves/transitions during collaboration, allowing only the server owner', async () => {
    const f = fixture('server-owner');
    await expect(f.service.assertWritable('tenant', 'script', 1)).rejects.toMatchObject({
      code: 'VERBIS_SCRIPT_INVALID_TRANSITION',
    });
    await expect(
      f.service.assertWritable('tenant', 'script', 1, 'server-owner'),
    ).resolves.toBeUndefined();
  });
  it('refuses a stale owner after the lease expires', async () => {
    await expect(
      fixture(null).service.assertWritable('tenant', 'script', 1, 'lost-owner'),
    ).rejects.toMatchObject({ code: 'VERBIS_SCRIPT_INVALID_TRANSITION' });
  });
  it('renews/deletes only a matching owner with one atomic Redis operation', async () => {
    const f = fixture('owner');
    await f.service.release('lease', 'owner');
    expect(f.client.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('get'"),
      1,
      'lease',
      'owner',
    );
    f.client.eval.mockResolvedValue(0);
    await expect(f.service.renew('lease', 'owner')).rejects.toMatchObject({
      code: 'VERBIS_SCRIPT_INVALID_TRANSITION',
    });
  });
});
