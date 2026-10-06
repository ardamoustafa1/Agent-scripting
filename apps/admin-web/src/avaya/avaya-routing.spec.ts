import { describe, expect, it } from 'vitest';

import { avayaMappings, nextAvayaMappings } from './avaya-routing.js';

const campaign = {
  id: 'c1',
  name: 'Retention',
  version: 1,
  externalMappings: [
    {
      platform: 'genesys-cloud',
      kind: 'queue',
      externalId: '0f0c2a1e-0000-4000-8000-000000000201',
    },
    { platform: 'avaya-aes', kind: 'vdn', externalId: '7001' },
  ],
};

describe('avaya routing helpers', () => {
  it('lists only Avaya bindings and adds per platform kinds', () => {
    expect(avayaMappings(campaign)).toEqual([
      { platform: 'avaya-aes', kind: 'vdn', externalId: '7001' },
    ]);
    expect(
      nextAvayaMappings(campaign, 'avaya-aacc', {
        add: { kind: 'skillset', externalId: ' EM_Billing ' },
      }).at(-1),
    ).toEqual({ platform: 'avaya-aacc', kind: 'skillset', externalId: 'EM_Billing' });
    expect(
      nextAvayaMappings(campaign, 'avaya-aes', { add: { kind: 'vdn', externalId: '7001' } }),
    ).toHaveLength(2);
  });

  it('refuses kinds of another platform and invalid ids', () => {
    expect(() =>
      nextAvayaMappings(campaign, 'avaya-axp', { add: { kind: 'vdn', externalId: '7001' } }),
    ).toThrow();
    expect(() =>
      nextAvayaMappings(campaign, 'avaya-aes', { add: { kind: 'vdn', externalId: '70 01;drop' } }),
    ).toThrow();
  });
});
