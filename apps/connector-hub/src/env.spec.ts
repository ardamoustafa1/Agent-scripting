import { describe, expect, it } from 'vitest';

import { loadHubEnv } from './env.js';

describe('hub AXP env (M-25)', () => {
  it('has safe defaults', () => {
    const env = loadHubEnv({ NODE_ENV: 'test' });
    expect(env.HUB_AXP_TOKEN_PATH).toBe('/auth/realms/{accountId}/protocol/openid-connect/token');
    expect(env.HUB_AXP_WRAPUP_MODE).toBe('disabled');
  });
  it('rejects absolute URLs as token path and rest mode without a path', () => {
    expect(() =>
      loadHubEnv({ NODE_ENV: 'test', HUB_AXP_TOKEN_PATH: 'https://evil.example/t' }),
    ).toThrow();
    expect(() => loadHubEnv({ NODE_ENV: 'test', HUB_AXP_WRAPUP_MODE: 'rest' })).toThrow();
    expect(
      loadHubEnv({
        NODE_ENV: 'test',
        HUB_AXP_WRAPUP_MODE: 'rest',
        HUB_AXP_WRAPUP_PATH: '/w/{accountId}/{interactionId}',
      }).HUB_AXP_WRAPUP_MODE,
    ).toBe('rest');
  });
});
