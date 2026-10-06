import { describe, expect, it } from 'vitest';

import { testEnv } from '../test/support/env.js';

import { loadApiEnv } from './env.js';

const JWKS = '{"keys":[{"kty":"OKP"}]}';

describe('loadApiEnv', () => {
  it('requires complete Vault settings and refuses HTTP outside a nonproduction loopback', () => {
    const transit = {
      INTEGRATION_KEY_PROVIDER: 'vault-transit',
      INTEGRATION_VAULT_TOKEN_FILE: '/run/verbis/token',
    };
    for (const INTEGRATION_VAULT_ADDRESS of [
      '',
      'http://vault.internal',
      'https://user:pass@vault.test',
      'https://vault.test/extra',
      'https://vault.test?x=1',
    ])
      expect(() => testEnv(JWKS, { ...transit, INTEGRATION_VAULT_ADDRESS })).toThrow(
        /INTEGRATION_VAULT_ADDRESS/,
      );
    expect(() =>
      testEnv(JWKS, {
        ...transit,
        NODE_ENV: 'production',
        INTEGRATION_VAULT_ADDRESS: 'http://127.0.0.1:8200',
      }),
    ).toThrow(/INTEGRATION_VAULT_ADDRESS/);
    expect(
      testEnv(JWKS, { ...transit, INTEGRATION_VAULT_ADDRESS: 'http://127.0.0.1:8200' })
        .INTEGRATION_KEY_PROVIDER,
    ).toBe('vault-transit');
    expect(
      testEnv(JWKS, {
        ...transit,
        NODE_ENV: 'production',
        INTEGRATION_VAULT_ADDRESS: 'https://vault.internal',
      }).INTEGRATION_VAULT_ADDRESS,
    ).toBe('https://vault.internal');
  });
  it('refuses incomplete legacy migration, path injection and unsupported providers', () => {
    const transit = {
      INTEGRATION_KEY_PROVIDER: 'vault-transit',
      INTEGRATION_VAULT_TOKEN_FILE: '/run/verbis/token',
      INTEGRATION_VAULT_ADDRESS: 'https://vault.test',
    };
    expect(() =>
      testEnv(JWKS, { ...transit, INTEGRATION_VAULT_ALLOW_LEGACY_DECRYPT: 'true' }),
    ).toThrow(/INTEGRATION_VAULT_ADDRESS/);
    expect(() => testEnv(JWKS, { ...transit, INTEGRATION_VAULT_TOKEN_FILE: 'relative' })).toThrow(
      /INTEGRATION_VAULT_ADDRESS/,
    );
    for (const key of [
      'INTEGRATION_VAULT_MOUNT',
      'INTEGRATION_VAULT_KEY',
      'INTEGRATION_VAULT_NAMESPACE',
    ])
      expect(() => testEnv(JWKS, { ...transit, [key]: '../escape' })).toThrow(key);
    expect(() => testEnv(JWKS, { INTEGRATION_KEY_PROVIDER: 'unknown' })).toThrow(
      /INTEGRATION_KEY_PROVIDER/,
    );
  });
  it('applies defaults and parses lists', () => {
    const env = testEnv(JWKS, {
      CORS_ALLOWED_ORIGINS: 'https://a.example, https://b.example',
      NATS_URL: 'nats://a:4222,nats://b:4222',
    });
    expect(env.CORS_ALLOWED_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
    expect(env.NATS_URL).toEqual(['nats://a:4222', 'nats://b:4222']);
    expect(env.API_DOCS).toBe('admin');
    expect(env.OUTBOX_RELAY_ENABLED).toBe(false);
  });

  it('opens docs publicly only in development, and never in production', () => {
    expect(testEnv(JWKS, { NODE_ENV: 'development' }).API_DOCS).toBe('public');
    expect(() => testEnv(JWKS, { NODE_ENV: 'production', API_DOCS: 'public' })).toThrow(/API_DOCS/);
  });

  it.each([
    [{ DATABASE_APP_URL: 'mysql://x' }, /DATABASE_APP_URL/],
    [{ REDIS_URL: 'http://x' }, /REDIS_URL/],
    [{ NATS_URL: 'http://x' }, /NATS_URL/],
    [{ RATE_LIMIT_MAX: '0' }, /RATE_LIMIT_MAX/],
  ])('rejects %j', (overrides, message) => {
    expect(() => testEnv(JWKS, overrides)).toThrow(message);
  });

  it('requires the database, Redis, NATS and JWKS settings', () => {
    expect(() => loadApiEnv({})).toThrow(
      /DATABASE_APP_URL[\s\S]*REDIS_URL[\s\S]*NATS_URL[\s\S]*INTERNAL_JWT_JWKS/,
    );
  });
});
