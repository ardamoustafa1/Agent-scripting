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

it('requires named SQL queries and gateway targets while rejecting mixed protocols', () => {
  const gateway = { clientId: '01990000-0000-7000-8000-000000000001', target: 'crm-readonly' };
  const sql = { queryKey: 'customer-by-id', parameters: ['customerId'] };
  const good = {
    ...source,
    protocol: 'sql',
    definition: { ...source.definition, privateGateway: gateway, sql },
  };
  expect(IntegrationSaveSchema.safeParse(good).success).toBe(true);
  for (const definition of [
    source.definition,
    { ...source.definition, privateGateway: gateway },
    { ...source.definition, sql },
  ])
    expect(IntegrationSaveSchema.safeParse({ ...good, definition }).success).toBe(false);
  expect(IntegrationSaveSchema.safeParse({ ...good, protocol: 'rest' }).success).toBe(false);
});
it('keeps private gateway credentials local and prevents caching their results', () => {
  const privateGateway = {
    clientId: '01990000-0000-7000-8000-000000000001',
    target: 'crm-readonly',
  };
  const definition = { ...source.definition, privateGateway };
  expect(IntegrationSaveSchema.safeParse({ ...source, definition }).success).toBe(true);
  const bearer = { type: 'bearer', secretRef: '01990000-0000-7000-8000-000000000002' };
  for (const override of [
    { auth: bearer },
    { profiles: { dev: { baseUrl: 'https://customer.example.io', auth: bearer } } },
  ])
    expect(
      IntegrationSaveSchema.safeParse({ ...source, definition: { ...definition, ...override } })
        .success,
    ).toBe(false);
  expect(
    IntegrationSaveSchema.safeParse({ ...source, definition, policy: { cacheTtlSeconds: 1 } })
      .success,
  ).toBe(false);
  expect(
    IntegrationSaveSchema.safeParse({
      ...source,
      definition: {
        ...definition,
        profiles: {
          dev: { baseUrl: 'https://customer.example.io', auth: { type: 'none' } },
          test: undefined,
        },
      },
    }).success,
  ).toBe(true);
});
