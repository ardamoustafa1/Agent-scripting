import { describe, expect, it } from 'vitest';

import { testEnv } from '../../../../test/support/env.js';
import { uuidv7 } from '../../../common/crypto/uuid.js';
import { buildSpMetadata } from '../saml/sp-metadata.js';
import { cookieValue } from '../session/session-cookie.js';
import { breakGlassSessionPolicy, ssoSessionPolicy } from '../session/session-policy.js';
import { summarize } from '../session/session.types.js';

import { AppOrigins, safeReturnPath } from './app-origins.js';

const env = testEnv('{"keys":[{"kty":"OKP"}]}');

describe('AppOrigins', () => {
  const origins = new AppOrigins(
    { admin: 'https://{tenant}.admin.example.com', agent: 'http://localhost:5174' },
    '/api',
  );

  it('builds public URLs from the allow-list and resolves templated tenants', () => {
    expect(origins.apps()).toEqual(['admin', 'agent']);
    expect(origins.publicUrl('admin', 'acme', '/auth/oidc/callback')).toBe(
      'https://acme.admin.example.com/api/auth/oidc/callback',
    );
    expect(origins.publicUrl('nope', 'acme', '/x')).toBeUndefined();
    expect(origins.match('https://acme.admin.example.com')).toEqual({
      app: 'admin',
      tenantSlug: 'acme',
    });
    expect(origins.match('http://localhost:5174')).toEqual({ app: 'agent' });
    expect(origins.match('https://evil.example')).toBeUndefined();
    expect(origins.match('https://a.b.admin.example.com')).toBeUndefined();
    expect(origins.tenantFromHost('acme.admin.example.com', 'https')).toBe('acme');
    expect(origins.has('__proto__')).toBe(false);
  });

  it.each([
    ['/scripts?x=1', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example', '/'],
    ['javascript:alert(1)', '/'],
    ['/a b', '/'],
    [42, '/'],
  ])('safeReturnPath(%j) = %j', (input, expected) => {
    expect(safeReturnPath(input)).toBe(expected);
  });
});

describe('session policy', () => {
  it('uses tenant settings over env defaults and caps idle by absolute', () => {
    expect(ssoSessionPolicy({}, env)).toEqual({
      idleTimeoutSeconds: 1800,
      absoluteTimeoutSeconds: 43_200,
      maxConcurrent: 5,
      onLimit: 'evict_oldest',
    });
    expect(
      ssoSessionPolicy(
        {
          session: {
            idleTimeoutMinutes: 120,
            absoluteTimeoutHours: 1,
            maxConcurrentSessions: 1,
            onLimit: 'deny',
          },
        },
        env,
      ),
    ).toEqual({
      idleTimeoutSeconds: 3600,
      absoluteTimeoutSeconds: 3600,
      maxConcurrent: 1,
      onLimit: 'deny',
    });
    expect(ssoSessionPolicy({ sessionTimeoutMinutes: 15 }, env).idleTimeoutSeconds).toBe(900);
    expect(ssoSessionPolicy({ session: { idleTimeoutMinutes: 'x' } }, env).idleTimeoutSeconds).toBe(
      1800,
    );
    expect(breakGlassSessionPolicy(env)).toEqual({
      idleTimeoutSeconds: 600,
      absoluteTimeoutSeconds: 3600,
      maxConcurrent: 1,
      onLimit: 'evict_oldest',
    });
  });

  it('summarizes without tokens or CSRF token', () => {
    const summary = summarize({
      v: 1,
      id: uuidv7(),
      tenantId: uuidv7(),
      userId: uuidv7(),
      kind: 'sso',
      protocol: 'oidc',
      app: 'admin',
      createdAt: 0,
      lastSeenAt: 1000,
      absoluteExpiresAt: 3_600_000,
      idleTimeoutSeconds: 600,
      csrfToken: 'c'.repeat(43),
      ip: '1.2.3.4',
      userAgent: 'ua',
      oidc: { sub: 's', refreshToken: 'secret-refresh' },
    });
    expect(JSON.stringify(summary)).not.toMatch(/secret-refresh|ccccc/);
    expect(summary.expiresAt).toBe(new Date(601_000).toISOString());
  });
});

describe('cookieValue', () => {
  it('reads a single cookie and ignores malformed values', () => {
    expect(cookieValue('a=1; __Host-s=abc_DEF-1; b=2', '__Host-s')).toBe('abc_DEF-1');
    expect(cookieValue('__Host-s=a"b', '__Host-s')).toBeUndefined();
    expect(cookieValue(undefined, 'x')).toBeUndefined();
    expect(cookieValue('x', 'x')).toBeUndefined();
  });
});

describe('SP metadata', () => {
  it('escapes values and publishes every ACS and certificate', () => {
    const xml = buildSpMetadata({
      entityId: 'https://sp.example/"<x>',
      acsUrls: ['https://a.example/acs', 'https://b.example/acs'],
      sloUrls: ['https://a.example/slo'],
      nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
      signingCertificates: ['-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----'],
      encryptionCertificates: ['-----BEGIN CERTIFICATE-----\nBBBB\n-----END CERTIFICATE-----'],
      authnRequestsSigned: true,
      validUntil: new Date('2027-01-01T00:00:00Z'),
    });
    expect(xml).toContain('entityID="https://sp.example/&quot;&lt;x&gt;"');
    expect(xml.match(/AssertionConsumerService/g)).toHaveLength(2);
    expect(xml).toContain('isDefault="true"');
    expect(xml).toContain('<ds:X509Certificate>AAAA</ds:X509Certificate>');
    expect(xml).toContain('use="encryption"');
  });
});

describe('uuidv7', () => {
  it('is version 7, variant 10 and time-ordered', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});
