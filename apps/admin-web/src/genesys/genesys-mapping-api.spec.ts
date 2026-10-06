import { describe, expect, it } from 'vitest';

import { genesysMappings, nextMappings, type CampaignSummary } from './genesys-mapping-api.js';

const QUEUE = '0f0c2a1e-0000-4000-8000-000000000201';
const campaign: CampaignSummary = {
  id: 'c1',
  name: 'Retention',
  version: 3,
  externalMappings: [
    { platform: 'avaya-aes', kind: 'vdn', externalId: '4711' },
    { platform: 'genesys-cloud', kind: 'queue', externalId: QUEUE },
  ],
};

describe('genesys mapping helpers', () => {
  it('lists only Genesys Cloud bindings', () => {
    expect(genesysMappings(campaign)).toEqual([
      { platform: 'genesys-cloud', kind: 'queue', externalId: QUEUE },
    ]);
  });

  it('adds a normalized binding once and keeps other platforms', () => {
    const next = nextMappings(campaign, {
      add: { kind: 'campaign', externalId: ' 0F0C2A1E-0000-4000-8000-000000000301 ' },
    });
    expect(next).toHaveLength(3);
    expect(next.at(-1)).toEqual({
      platform: 'genesys-cloud',
      kind: 'campaign',
      externalId: '0f0c2a1e-0000-4000-8000-000000000301',
    });
    expect(nextMappings(campaign, { add: { kind: 'queue', externalId: QUEUE } })).toHaveLength(2);
    expect(() =>
      nextMappings(campaign, { add: { kind: 'queue', externalId: 'not-a-uuid' } }),
    ).toThrow();
  });

  it('removes exactly one binding', () => {
    expect(
      nextMappings(campaign, {
        remove: { platform: 'genesys-cloud', kind: 'queue', externalId: QUEUE },
      }),
    ).toEqual([{ platform: 'avaya-aes', kind: 'vdn', externalId: '4711' }]);
  });
});
