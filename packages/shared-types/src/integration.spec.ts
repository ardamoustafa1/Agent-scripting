import { describe, expect, it } from 'vitest';

import {
  IntegrationSaveSchema,
  IntegrationDefinitionSchema,
  IntegrationPolicySchema,
} from './integration.js';

const source = {
  key: 'customer',
  protocol: 'rest',
  definition: { baseUrl: 'https://api.example.com', endpoint: '/' },
  policy: {},
};
describe('integration authoring contract', () => {
  it('defaults to conservative PII masking and preserves old definitions', () => {
    const parsed = IntegrationSaveSchema.parse(source);
    expect(parsed.policy.containsPii).toBe(true);
    expect(parsed.definition.mockScenarios).toEqual([]);
  });
  it('refuses pending approvals written through the generic definition endpoint', () => {
    expect(
      IntegrationSaveSchema.safeParse({
        ...source,
        definition: {
          ...source.definition,
          pendingPromotion: {
            requestedBy: 'someone',
            from: 'dev',
            profile: { baseUrl: 'https://api.example.com', auth: { type: 'none' } },
            requestedAt: '2026-10-02T00:00:00Z',
            reason: 'Synthetic review',
          },
        },
      }).success,
    ).toBe(false);
  });
  it('bounds mock delay, timeout and retry values', () => {
    expect(
      IntegrationDefinitionSchema.safeParse({
        ...source.definition,
        mockScenarios: [{ key: 'delay', kind: 'delay', response: {}, delayMs: 10001 }],
      }).success,
    ).toBe(false);
    expect(IntegrationPolicySchema.safeParse({ retries: 4 }).success).toBe(false);
  });
  it('rejects credential-bearing URLs and reserved headers', () => {
    expect(
      IntegrationDefinitionSchema.safeParse({
        ...source.definition,
        baseUrl: 'https://fixture:synthetic@api.example.com',
      }).success,
    ).toBe(false);
    expect(
      IntegrationDefinitionSchema.safeParse({
        ...source.definition,
        headers: { Authorization: 'synthetic' },
      }).success,
    ).toBe(false);
  });
});
