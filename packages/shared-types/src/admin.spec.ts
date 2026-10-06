import { describe, it, expect } from 'vitest';

import {
  AdminPublicJwksSchema,
  AdminPrivacyInputSchema,
  AdminSecuritySchema,
  AdminClassificationSchema,
  AdminBrandSchema,
} from './admin.js';

describe('admin input contracts', () => {
  const key = {
    kty: 'OKP',
    crv: 'Ed25519',
    kid: 'test-key',
    x: 'A'.repeat(43),
    alg: 'EdDSA',
    use: 'sig',
  };
  it('refuses private launch signing material and duplicate kids', () => {
    expect(AdminPublicJwksSchema.safeParse({ keys: [{ ...key, d: 'private' }] }).success).toBe(
      false,
    );
    expect(AdminPublicJwksSchema.safeParse({ keys: [key, key] }).success).toBe(false);
  });
  it('enforces curve and algorithm agreement', () => {
    expect(AdminPublicJwksSchema.safeParse({ keys: [key] }).success).toBe(true);
    expect(AdminPublicJwksSchema.safeParse({ keys: [{ ...key, alg: 'ES256' }] }).success).toBe(
      false,
    );
  });
  it('requires verified identity and a reason for every privacy request', () => {
    const input = {
      kind: 'anonymize',
      subject: 'fixture-subject',
      reason: 'Approved fixture request',
      verified: true,
    };
    expect(AdminPrivacyInputSchema.safeParse(input).success).toBe(true);
    expect(AdminPrivacyInputSchema.safeParse({ ...input, verified: false }).success).toBe(false);
  });
  it('validates IPv4 and IPv6 prefix boundaries', () => {
    expect(
      AdminSecuritySchema.safeParse({ ipAllowlist: ['192.0.2.0/24', '2001:db8::/32'] }).success,
    ).toBe(true);
    for (const value of ['192.0.2.0/33', '2001:db8::/129', '*', '192.0.2.0/-1'])
      expect(AdminSecuritySchema.safeParse({ ipAllowlist: [value] }).success).toBe(false);
  });
  it('refuses active content and URL credentials in tenant logos', () => {
    for (const logoUrl of ['javascript:alert(1)', 'https://user:pass@example.test/logo'])
      expect(
        AdminBrandSchema.safeParse({ name: 'Fixture', primaryColor: '#5145cd', logoUrl }).success,
      ).toBe(false);
  });
  it('rejects ambiguous classification entries', () => {
    const entry = { path: 'customer.ani', classification: 'pii', purpose: 'Verified routing' };
    expect(AdminClassificationSchema.safeParse([entry, entry]).success).toBe(false);
  });
});

it('checks EC public key curve, y coordinate and algorithm agreement', () => {
  const key = {
    kid: 'ec',
    kty: 'EC',
    crv: 'P-256',
    x: 'A'.repeat(43),
    y: 'B'.repeat(43),
    alg: 'ES256',
  };
  expect(AdminPublicJwksSchema.safeParse({ keys: [key] }).success).toBe(true);
  for (const bad of [{ y: undefined }, { crv: 'Ed25519' }, { alg: 'EdDSA' }])
    expect(AdminPublicJwksSchema.safeParse({ keys: [{ ...key, ...bad }] }).success).toBe(false);
  expect(
    AdminSecuritySchema.parse({ ipAllowlist: ['192.0.2.1', '2001:db8::1'] }).ipAllowlist,
  ).toHaveLength(2);
  expect(AdminSecuritySchema.safeParse({ ipAllowlist: ['192.0.2.0/24/extra'] }).success).toBe(
    false,
  );
  expect(
    AdminBrandSchema.parse({
      name: 'Synthetic',
      primaryColor: '#123456',
      logoUrl: 'https://example.test/logo.png',
    }).logoUrl,
  ).toBe('https://example.test/logo.png');
});
