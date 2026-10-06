import { describe, expect, it, vi } from 'vitest';

import { DeadLettersService } from './dead-letters.service.js';

import type { HubClient } from './hub-client.js';

function fixture(hubStats = { durable: true, persisted: 7, persistFailures: 1 }) {
  const call = vi.fn((_t: string, method: string) =>
    Promise.resolve(
      method === 'GET'
        ? { queue: { pending: 3 }, connectors: [], deadLetters: hubStats }
        : { replayed: 4 },
    ),
  );
  const record = vi.fn().mockResolvedValue(undefined);
  const tx = {};
  const service = new DeadLettersService(
    { call } as unknown as HubClient,
    { record } as never,
    { current: () => tx, tenantId: () => 'tenant-1' } as never,
  );
  return { service, call, record, tx };
}

describe('DeadLettersService', () => {
  it('reads dead-letter stats from the hub for the caller tenant only', async () => {
    const f = fixture();
    await expect(f.service.stats()).resolves.toEqual({
      durable: true,
      persisted: 7,
      persistFailures: 1,
    });
    expect(f.call).toHaveBeenCalledWith(
      'tenant-1',
      'GET',
      '/internal/v1/connectors',
      expect.anything(),
    );
  });

  it('replays through the hub with the tenant and audits redacted before/after in the same tx', async () => {
    const f = fixture();
    await expect(f.service.replay(50)).resolves.toEqual({ replayed: 4 });
    expect(f.call).toHaveBeenCalledWith(
      'tenant-1',
      'POST',
      '/internal/v1/dead-letters/replay',
      expect.anything(),
      { limit: 50 },
    );
    expect(f.record).toHaveBeenCalledTimes(1);
    const [tx, event] = f.record.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(tx).toBe(f.tx);
    expect(event).toMatchObject({
      action: 'connector.deadletter.replayed',
      target: { type: 'Connector', id: 'tenant-1' },
      before: { persisted: 7 },
      after: { persisted: 7 },
      metadata: { requested: 50, replayed: 4 },
    });
    expect(JSON.stringify(event)).not.toMatch(/payload|secret|token/i);
  });

  it('does not audit a replay the hub refused', async () => {
    const f = fixture();
    f.call.mockRejectedValueOnce(new Error('hub down')); // stats
    await expect(f.service.replay(10)).rejects.toThrow('hub down');
    expect(f.record).not.toHaveBeenCalled();
  });
});
