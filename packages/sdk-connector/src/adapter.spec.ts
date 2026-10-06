import { describe, expect, it } from 'vitest';

import { ADAPTER_TYPES, isAdapterType } from './adapter.js';

describe('adapter types', () => {
  it('covers every required platform plus CTI-less', () => {
    expect(ADAPTER_TYPES).toContain('genesys-cloud');
    expect(ADAPTER_TYPES).toContain('genesys-engage');
    expect(ADAPTER_TYPES).toContain('avaya-aacc');
    expect(ADAPTER_TYPES).toContain('generic');
    expect(ADAPTER_TYPES).toHaveLength(10);
  });

  it('guards adapter type strings', () => {
    expect(isAdapterType('five9')).toBe(true);
    expect(isAdapterType('genesys-wde')).toBe(false);
  });
});

describe('platformOf / isChannelType', () => {
  it('maps adapter types to the API enum form', async () => {
    const { platformOf, isChannelType } = await import('./adapter.js');
    expect(platformOf('genesys-cloud')).toBe('genesys_cloud');
    expect(platformOf('generic')).toBe('generic');
    expect(isChannelType('whatsapp')).toBe(true);
    expect(isChannelType('fax')).toBe(false);
  });
});
