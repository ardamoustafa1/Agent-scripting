import { describe, expect, it } from 'vitest';

import {
  DomainSchema,
  OidcConfigSchema,
  oidcAuthParams,
  oidcClaimNames,
  oidcScopes,
  SamlConfigSchema,
  samlAttributeNames,
  samlNameIdFormat,
} from './idp-config.js';
import { IDP_VENDORS } from './idp-presets.js';
import { claimStrings, claimValue, mapRoles } from './role-mapping.js';

const CERT = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

describe('OIDC config', () => {
  it('fills vendor presets and keeps overrides', () => {
    for (const vendor of IDP_VENDORS) {
      const config = OidcConfigSchema.parse({
        vendor,
        issuer: 'https://idp.example.com',
        clientId: 'c',
      });
      expect(oidcScopes(config)).toContain('openid');
      expect(oidcClaimNames(config).email.length).toBeGreaterThan(0);
    }
    const google = OidcConfigSchema.parse({
      vendor: 'google',
      issuer: 'https://accounts.google.com',
      clientId: 'c',
      scopes: ['email'],
      authParams: { hd: 'acme.test' },
      claims: { groups: 'custom_groups' },
    });
    expect(oidcScopes(google)).toEqual(['openid', 'email']);
    expect(oidcAuthParams(google)).toEqual({
      access_type: 'offline',
      prompt: 'consent',
      hd: 'acme.test',
    });
    expect(oidcClaimNames(google).groups).toBe('custom_groups');
  });

  it('refuses protocol parameter overrides, unknown keys and non-http issuers', () => {
    const base = { vendor: 'okta', issuer: 'https://idp.example.com', clientId: 'c' };
    expect(
      OidcConfigSchema.safeParse({ ...base, authParams: { redirect_uri: 'https://evil' } }).success,
    ).toBe(false);
    expect(OidcConfigSchema.safeParse({ ...base, clientSecret: 'x' }).success).toBe(false);
    expect(OidcConfigSchema.safeParse({ ...base, issuer: 'javascript:alert(1)' }).success).toBe(
      false,
    );
  });
});

describe('SAML config', () => {
  it('requires at least one IdP certificate and fills presets', () => {
    const config = SamlConfigSchema.parse({
      vendor: 'entra',
      idpEntityId: 'https://sts.windows.net/x/',
      ssoUrl: 'https://login.microsoftonline.com/x/saml2',
      idpCertificates: [CERT],
    });
    expect(config.allowIdpInitiated).toBe(false);
    expect(samlAttributeNames(config).groups).toMatch(/claims\/groups$/);
    expect(samlNameIdFormat(config)).toMatch(/persistent$/);
    expect(SamlConfigSchema.safeParse({ ...config, idpCertificates: [] }).success).toBe(false);
    expect(SamlConfigSchema.safeParse({ ...config, idpCertificates: ['not a cert'] }).success).toBe(
      false,
    );
  });
});

describe('DomainSchema', () => {
  it('normalizes and validates domains', () => {
    expect(DomainSchema.parse(' Acme.COM.tr ')).toBe('acme.com.tr');
    expect(DomainSchema.safeParse('acme').success).toBe(false);
    expect(DomainSchema.safeParse('-acme.com').success).toBe(false);
    expect(DomainSchema.safeParse('acme.com/x').success).toBe(false);
  });
});

describe('role mapping', () => {
  const mapping = {
    defaultRoles: ['agent'],
    rules: [
      { claim: 'groups', equals: 'verbis-admins', roles: ['tenant_admin'] },
      { claim: 'realm_access.roles', equals: 'designer', roles: ['designer', 'reviewer'] },
      {
        claim: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups',
        equals: 'g-1',
        roles: ['auditor'],
      },
      { claim: 'department', equals: 'qa', roles: ['supervisor'] },
    ],
  };

  it('maps multi-valued, nested, URI-named and scalar claims', () => {
    expect(
      mapRoles(mapping, {
        groups: ['verbis-admins', 'other'],
        realm_access: { roles: ['designer'] },
        'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups': 'g-1',
        department: 'qa',
      }),
    ).toEqual(['agent', 'auditor', 'designer', 'reviewer', 'supervisor', 'tenant_admin']);
  });

  it('grants only defaults when nothing matches and ignores prototype paths', () => {
    expect(mapRoles(mapping, { groups: 'verbis-admin' })).toEqual(['agent']);
    expect(claimValue({}, '__proto__.polluted')).toBeUndefined();
    expect(claimValue({ a: [1] }, 'a.0')).toBeUndefined();
    expect(claimStrings([1, true, 'x', { y: 1 }])).toEqual(['1', 'true', 'x']);
    expect(claimStrings(null)).toEqual([]);
  });
});
