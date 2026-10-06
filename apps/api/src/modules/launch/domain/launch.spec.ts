import { describe, expect, it } from 'vitest';

import {
  checkInteraction,
  checkRedemption,
  forbiddenParams,
  intentExpiry,
  LAUNCH_CODE,
  launchCodeHash,
  MAX_LAUNCH_TTL_SECONDS,
  newLaunchCode,
  safeEqualHex,
  type IntentView,
  type RedeemerView,
} from './launch.js';

const now = new Date('2026-10-01T10:00:00.000Z');
const intent: IntentView = {
  tenantId: 't1',
  userId: 'u1',
  state: 'pending',
  expiresAt: new Date(now.getTime() + 30_000),
};
const redeemer: RedeemerView = {
  tenantId: 't1',
  userId: 'u1',
  bffSessionId: 's1',
  authMethod: 'sso',
};

describe('launch codes', () => {
  it('are 256-bit, URL-safe and hashed for storage', () => {
    const code = newLaunchCode();
    expect(code).toMatch(LAUNCH_CODE);
    expect(newLaunchCode()).not.toBe(code);
    expect(launchCodeHash(code)).toMatch(/^[a-f0-9]{64}$/);
    expect(launchCodeHash(code)).not.toContain(code);
    expect(newLaunchCode(() => Buffer.alloc(32, 1))).toBe(
      Buffer.alloc(32, 1).toString('base64url'),
    );
  });

  it('compares hashes in constant time and rejects length mismatches', () => {
    expect(safeEqualHex('ab', 'ab')).toBe(true);
    expect(safeEqualHex('ab', 'ac')).toBe(false);
    expect(safeEqualHex('ab', 'abc')).toBe(false);
  });

  it('caps the lifetime at 60 seconds', () => {
    expect(intentExpiry(now).getTime() - now.getTime()).toBe(45_000);
    expect(intentExpiry(now, 3600).getTime() - now.getTime()).toBe(MAX_LAUNCH_TTL_SECONDS * 1000);
    expect(intentExpiry(now, 0).getTime() - now.getTime()).toBe(1000);
  });
});

describe('checkRedemption', () => {
  it('accepts the bound user with an SSO session before expiry', () => {
    expect(checkRedemption(intent, redeemer, now)).toBeUndefined();
  });

  it.each([
    ['tenant_mismatch', intent, { ...redeemer, tenantId: 't2' }],
    ['code_replayed', { ...intent, state: 'redeemed' as const }, redeemer],
    ['intent_revoked', { ...intent, state: 'revoked' as const }, redeemer],
    ['user_mismatch', intent, { ...redeemer, userId: 'u2' }],
    ['break_glass', intent, { ...redeemer, authMethod: 'break_glass' as const }],
    ['session_missing', intent, { ...redeemer, bffSessionId: undefined }],
    ['code_expired', { ...intent, expiresAt: now }, redeemer],
    ['code_expired', { ...intent, state: 'expired' as const }, redeemer],
  ])('denies %s', (reason, i, r) => {
    expect(checkRedemption(i, r, now)).toBe(reason);
  });

  it('reports replay before expiry (the more serious signal)', () => {
    expect(checkRedemption({ ...intent, state: 'redeemed', expiresAt: now }, redeemer, now)).toBe(
      'code_replayed',
    );
  });

  it('reports a foreign user before expiry', () => {
    expect(checkRedemption({ ...intent, expiresAt: now }, { ...redeemer, userId: 'x' }, now)).toBe(
      'user_mismatch',
    );
  });
});

describe('checkInteraction', () => {
  const live = { status: 'connected', endedAt: null, agentId: 'u1' };
  it('accepts live interactions assigned to the user', () => {
    for (const status of ['alerting', 'connected', 'held'])
      expect(checkInteraction({ ...live, status }, 'u1')).toBeUndefined();
  });
  it('denies missing, ended or foreign interactions', () => {
    expect(checkInteraction(null, 'u1')).toBe('interaction_inactive');
    expect(checkInteraction({ ...live, status: 'ended' }, 'u1')).toBe('interaction_inactive');
    expect(checkInteraction({ ...live, status: 'wrapup' }, 'u1')).toBe('interaction_inactive');
    expect(checkInteraction({ ...live, endedAt: now }, 'u1')).toBe('interaction_inactive');
    expect(checkInteraction(live, 'u2')).toBe('interaction_not_assigned');
    expect(checkInteraction({ ...live, agentId: null }, 'u1')).toBe('interaction_not_assigned');
  });
});

describe('forbiddenParams', () => {
  it('flags identifying parameters case-insensitively and ignores the rest', () => {
    expect(
      forbiddenParams({ scriptId: 's', CampaignID: 'c', interactionId: 'i', utm: 'x' }),
    ).toEqual(['CampaignID', 'interactionId', 'scriptId']);
    expect(forbiddenParams({})).toEqual([]);
  });
});
