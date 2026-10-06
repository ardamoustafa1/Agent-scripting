import { expect, it } from 'vitest';

import { IntegrationDefinitionSchema } from '@verbis/shared-types';

import { assertProductionEndpoints, reservedHost } from './reserved-hosts.js';

it.each([
  'https://example.com',
  'https://api.example.org./x',
  'https://auth.example.net',
  'https://customer.test',
  'https://fixture.invalid',
  'https://localhost',
])('rejects reserved production hosts: %s', (value) => {
  expect(reservedHost(value)).toBe(true);
  expect(() => {
    assertProductionEndpoints(IntegrationDefinitionSchema.parse({ baseUrl: value, endpoint: '/' }));
  }).toThrow();
});
it('preserves genuine hosts and checks OAuth endpoints and profiles', () => {
  const source = IntegrationDefinitionSchema.parse({
    baseUrl: 'https://customer.example.io',
    endpoint: '/',
  });
  expect(() => {
    assertProductionEndpoints(source);
  }).not.toThrow();
  source.profiles.dev = { baseUrl: 'https://api.example.com', auth: { type: 'none' } };
  expect(() => {
    assertProductionEndpoints(source);
  }).not.toThrow();
  source.profiles.prod = source.profiles.dev;
  expect(() => {
    assertProductionEndpoints(source);
  }).toThrow();
  source.profiles = {};
  source.auth = {
    type: 'oauth2-client-credentials',
    secretRef: '01990000-0000-7000-8000-000000000001',
    tokenUrl: 'https://auth.example.com/token',
  };
  expect(() => {
    assertProductionEndpoints(source);
  }).toThrow();
});

it('rejects saved documentation domains in any profile or OAuth token endpoint', async () => {
  const { assertConfiguredEndpoints } = await import('./reserved-hosts.js');
  const source = IntegrationDefinitionSchema.parse({
    baseUrl: 'https://customer.example.io',
    endpoint: '/',
  });
  expect(() => {
    assertConfiguredEndpoints(source);
  }).not.toThrow();
  source.profiles.dev = { baseUrl: 'https://api.example.com.', auth: { type: 'none' } };
  expect(() => {
    assertConfiguredEndpoints(source);
  }).toThrow();
  source.profiles.dev.baseUrl = 'https://dev.customer.example.io';
  source.profiles.dev.auth = {
    type: 'oauth2-client-credentials',
    secretRef: '01990000-0000-7000-8000-000000000001',
    tokenUrl: 'https://auth.example.net/token',
  };
  expect(() => {
    assertConfiguredEndpoints(source);
  }).toThrow();
  source.profiles = {};
  source.baseUrl = 'https://example.org';
  expect(() => {
    assertConfiguredEndpoints(source);
  }).toThrow();
});
