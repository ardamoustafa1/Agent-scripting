import { describe, expect, it, vi } from 'vitest';

import { apiAgentTokens } from './api-agent-tokens.js';
import { WorkspaceSessionPool } from './workspace-pool.js';

const sessions: {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
  connected: boolean;
  deps: { onIdentity(agent: unknown): void; onMessage(message: unknown): Promise<void> };
}[] = [];
vi.mock('./workspace-session.js', () => ({
  WorkspaceSession: class {
    connected = true;
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    request = vi.fn().mockResolvedValue({ synthetic: true });
    constructor(
      readonly deps: {
        onIdentity(agent: unknown): void;
        onMessage(message: unknown): Promise<void>;
      },
    ) {
      sessions.push(this);
    }
  },
}));
function fixture(maxSessions?: number) {
  sessions.length = 0;
  const linkedAgents = vi.fn().mockResolvedValue(['one', 'two', 'two']),
    onMessage = vi.fn().mockResolvedValue(undefined),
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const pool = new WorkspaceSessionPool({
    baseUrl: 'https://gws.example.test',
    channels: ['voice'],
    tokens: { linkedAgents, token: vi.fn() },
    fetch,
    logger,
    now: () => new Date(0),
    sleep: () => Promise.resolve(),
    onMessage,
    ...(maxSessions === undefined ? {} : { maxSessions, random: () => 0.5 }),
  });
  return { pool, linkedAgents, onMessage, logger };
}
describe('delegated agent session pool', () => {
  it('deduplicates linked identities, retains live sessions and closes revoked links', async () => {
    const f = fixture();
    await f.pool.sync();
    expect(f.pool.size).toBe(2);
    expect(f.pool.down).toBe(0);
    expect(f.pool.isConnected('one')).toBe(true);
    expect(f.pool.isConnected('missing')).toBe(false);
    sessions[1]!.connected = false;
    expect(f.pool.down).toBe(1);
    await expect(f.pool.request('one', 'POST', '/command', { safe: true })).resolves.toEqual({
      synthetic: true,
    });
    expect(sessions[0]!.request).toHaveBeenCalledWith('POST', '/command', { safe: true });
    await expect(f.pool.request('missing', 'GET', '/command', undefined)).rejects.toThrow(
      'no session',
    );
    await f.pool.sync();
    expect(sessions).toHaveLength(2);
    f.linkedAgents.mockResolvedValue(['two']);
    await f.pool.sync();
    expect(sessions[0]!.stop).toHaveBeenCalledOnce();
    expect(f.pool.size).toBe(1);
    await f.pool.stop();
    expect(f.pool.size).toBe(0);
    expect(sessions[1]!.stop).toHaveBeenCalledOnce();
  });
  it('bounds sessions and pairs notifications with initialized identity', async () => {
    const f = fixture(1);
    await f.pool.sync();
    expect(f.pool.size).toBe(1);
    sessions[0]!.deps.onIdentity({ employeeId: 'employee' });
    await sessions[0]!.deps.onMessage({ synthetic: true });
    expect(f.onMessage).toHaveBeenCalledWith(
      'one',
      { employeeId: 'employee' },
      { synthetic: true },
    );
    await f.pool.stop();
  });
  it.each([new Error('synthetic failure'), null])(
    'removes failed sessions and retries on the next sync',
    async (error) => {
      const f = fixture();
      await f.pool.sync();
      await f.pool.stop();
      // Arrange startup rejection on the actual created session before start is called.
      const originalPush = sessions.push.bind(sessions);
      vi.spyOn(sessions, 'push').mockImplementation((...entries) => {
        entries.forEach((entry) => entry.start.mockRejectedValueOnce(error));
        return originalPush(...entries);
      });
      try {
        await f.pool.sync();
        expect(f.pool.size).toBe(0);
        expect(f.logger.warn).toHaveBeenCalledWith('engage workspace session failed to start', {
          reason: error instanceof Error ? 'synthetic failure' : 'unknown',
        });
      } finally {
        vi.restoreAllMocks();
        await f.pool.stop();
      }
    },
  );
  it('routes token vending through the authenticated API with exact tenant and connector context', async () => {
    const api = {
      engageLinkedAgents: vi.fn().mockResolvedValue(['agent']),
      engageAgentToken: vi.fn().mockResolvedValue({ accessToken: 'synthetic', expiresAt: 1000 }),
    };
    const source = apiAgentTokens(api, 'tenant', 'connector');
    expect(await source.linkedAgents()).toEqual(['agent']);
    expect(await source.token('agent')).toEqual({ accessToken: 'synthetic', expiresAt: 1000 });
    expect(api.engageLinkedAgents).toHaveBeenCalledWith('tenant', 'connector');
    expect(api.engageAgentToken).toHaveBeenCalledWith('tenant', 'connector', 'agent');
  });
});
