import { describe, expect, it } from 'vitest';

import { asSubject, defineAbilityFor, SYSTEM_ROLES } from '@verbis/authz';

import {
  assertDemoTarget,
  demoCampaigns,
  demoFacts,
  demoOutcomeCodes,
  demoRoleScope,
  mockDefinition,
  DEMO_SHARED_ID,
} from '../prisma/demo/fixture.js';

describe('synthetic demo bundle', () => {
  it('rejects production, remote servers and unapproved databases', () => {
    const env = {
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://demo:demo@localhost:5432/verbis_demo',
    };
    expect(assertDemoTarget(env)).toBe(env.DATABASE_URL);
    for (const change of [
      { NODE_ENV: 'production' },
      { DATABASE_URL: 'postgresql://demo:demo@db.example/verbis_demo' },
      { DATABASE_URL: 'postgresql://demo:demo@localhost/customer' },
      { DATABASE_URL: undefined },
    ])
      expect(() => assertDemoTarget({ ...env, ...change })).toThrow();
  });
  it('creates four schema-valid stable campaigns with a shared welcome and nested wrap-up codes', () => {
    const campaigns = demoCampaigns();
    expect(campaigns).toEqual(demoCampaigns());
    expect(new Set(campaigns.map((item) => item.id)).size).toBe(4);
    for (const item of campaigns) {
      expect(item.document.pages[0]?.id).toBe('demo-intro');
      expect(item.document.flow.start).toBe('demo-intro-node');
      expect(item.id).not.toBe(DEMO_SHARED_ID);
      expect(demoOutcomeCodes(item.document)).toContain('demo-success');
    }
    expect(demoOutcomeCodes(campaigns[1]!.document)).toContain('OTP_FAILED');
    expect(demoOutcomeCodes(campaigns[0]!.document)).toContain('SALE_OK');
  });
  it('provides every pinned service output including selectable tariff offers', () => {
    for (const campaign of demoCampaigns())
      for (const source of campaign.document.dataSources) {
        const key = source.ref.replace('tenant-datasource:', '');
        const definition = mockDefinition(key);
        expect(definition.mock?.enabled).toBe(true);
        for (const mapping of Object.values(source.outputs)) {
          const segments = mapping.path.replace(/^\$\./, '').split('.');
          let value: unknown = definition.mock?.response;
          for (const segment of segments)
            value =
              typeof value === 'object' && value !== null
                ? (value as Record<string, unknown>)[segment]
                : undefined;
          expect(value, `${key}: ${mapping.path}`).not.toBeUndefined();
        }
      }
    const response = mockDefinition('tariff-catalog').mock?.response as {
      data: { offers: unknown[] };
    };
    expect(response.data.offers).toHaveLength(2);
  });
  it('generates seven days of deterministic facts without raw agent identifiers', () => {
    const campaigns = demoCampaigns();
    const bundles = Array.from({ length: 28 }, (_, index) =>
      demoFacts(campaigns[index % 4]!, '2026-10-03', index),
    );
    expect(bundles.flatMap((bundle) => bundle.facts)).toHaveLength(84);
    expect(new Set(bundles.map((bundle) => bundle.start.toISOString().slice(0, 10))).size).toBe(7);
    expect(
      new Set(bundles.flatMap((bundle) => bundle.facts.map((fact) => fact.eventId))).size,
    ).toBe(84);
    for (const bundle of bundles) expect(bundle.facts[0]?.agent).toMatch(/^[a-f0-9]{64}$/);
    expect(bundles[0]).toEqual(demoFacts(campaigns[0]!, '2026-10-03', 0));
  });
});

it('limits demo designer access to the four explicit campaign grants', () => {
  const scope = demoRoleScope('script_designer');
  const ability = defineAbilityFor({
    userId: 'synthetic-designer',
    grants: [{ rules: SYSTEM_ROLES.script_designer.rules, scope }],
  });
  expect(scope.campaignIds).toHaveLength(4);
  expect(ability.can('read', asSubject('Script', { campaignIds: [scope.campaignIds?.[0]] }))).toBe(
    true,
  );
  expect(ability.can('read', asSubject('Script', { campaignIds: ['foreign-campaign'] }))).toBe(
    false,
  );
});
