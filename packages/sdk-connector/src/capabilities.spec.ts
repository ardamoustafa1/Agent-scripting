import { describe, expect, it } from 'vitest';

import { supportsChannel, supportsFeature, validateCapabilities } from './capabilities.js';

describe('capabilities', () => {
  const caps = {
    channels: ['voice', 'chat'] as const,
    features: ['writeBack'] as const,
    maxConcurrent: { chat: 3 },
  };
  it('answers channel and feature support', () => {
    expect(supportsChannel(caps, 'chat')).toBe(true);
    expect(supportsChannel(caps, 'email')).toBe(false);
    expect(supportsFeature(caps, 'writeBack')).toBe(true);
    expect(supportsFeature(caps, 'recordingControl')).toBe(false);
  });
  it('validates declarations', () => {
    expect(validateCapabilities(caps)).toEqual([]);
    expect(validateCapabilities({ channels: [], features: [] })).toContain(
      'at least one channel is required',
    );
    expect(
      validateCapabilities({ channels: ['voice'], features: [], maxConcurrent: { chat: 2 } }),
    ).toContain('maxConcurrent for unsupported chat');
    expect(
      validateCapabilities({ channels: ['chat'], features: [], maxConcurrent: { chat: 0 } }),
    ).toContain('maxConcurrent.chat out of range');
    expect(
      validateCapabilities({ channels: ['chat'], features: ['writeBack', 'writeBack'] }),
    ).toContain('duplicate features');
    expect(validateCapabilities({ channels: ['fax' as 'chat'], features: [] })).toContain(
      'unknown channel fax',
    );
  });
});
