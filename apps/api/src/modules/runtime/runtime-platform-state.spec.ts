import { describe, expect, it } from 'vitest';

import { platformSessionState } from './runtime-interactions.handler.js';

describe('platform lifecycle drives desktop editability', () => {
  it('pauses on hold and resumes without resurrecting wrap-up', () => {
    expect(platformSessionState('active', 'held', 'owner', 'owner')).toBe('paused');
    expect(platformSessionState('paused', 'connected', 'owner', 'owner')).toBe('active');
    expect(platformSessionState('wrapup', 'connected', 'owner', 'owner')).toBe('wrapup');
  });
  it('abandons and releases the old agent on transfer', () => {
    expect(platformSessionState('active', 'transferred', 'owner', 'next-agent')).toBe('abandoned');
    expect(platformSessionState('active', 'transferred', 'owner', 'owner')).toBe('active');
  });
  it('moves an established session to wrap-up when customer ends, but never opens a pending launch', () => {
    expect(platformSessionState('active', 'ended', 'owner')).toBe('wrapup');
    expect(platformSessionState('launching', 'ended', 'owner')).toBe('abandoned');
    expect(platformSessionState('completed', 'ended', 'owner')).toBe('completed');
  });
});
