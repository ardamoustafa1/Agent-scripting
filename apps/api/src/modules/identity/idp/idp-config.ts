import { z } from 'zod';

import { IDP_VENDORS, OIDC_PRESETS, SAML_PRESETS, type ClaimNames } from './idp-presets.js';

/** Role names follow the seeded/custom role naming (`tenant_admin`, `designer`, …). */
const RoleName = z.string().regex(/^[a-z][a-z0-9_]{1,62}$/);
/** Dot path into the claim set, e.g. `groups` or `realm_access.roles`; SAML attribute names too. */
const ClaimPath = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_:/.#-]+$/);
const Pem = z
  .string()
  .max(16_384)
  .regex(
    /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/,
    'must be a PEM certificate',
  );
const HttpUrl = z.url({ protocol: /^https?$/ }).max(2048);

/**
 * Claim/attribute → role rules (DOMAIN IdentityProvider). A rule matches when the claim value
 * equals `equals`, or, for multi-valued claims (groups), contains it. Matched roles are the
 * user's IdP-sourced roles; they are re-synchronized at every login and by SCIM group changes,
 * and never touch roles granted manually.
 */
export const RoleMappingRuleSchema = z.strictObject({
  claim: ClaimPath,
  equals: z.string().min(1).max(512),
  roles: z.array(RoleName).min(1).max(20),
});
export const RoleMappingSchema = z.strictObject({
  rules: z.array(RoleMappingRuleSchema).max(200).default([]),
  /** Granted to every user signing in through this IdP (e.g. `agent`). */
  defaultRoles: z.array(RoleName).max(20).default([]),
});
export type RoleMapping = z.output<typeof RoleMappingSchema>;

const ClaimOverrides = z
  .strictObject({
    email: ClaimPath,
    emailVerified: ClaimPath,
    displayName: ClaimPath,
    givenName: ClaimPath,
    familyName: ClaimPath,
    groups: ClaimPath,
    locale: ClaimPath,
  })
  .partial();

const RESERVED_AUTH_PARAMS = new Set([
  'client_id',
  'redirect_uri',
  'response_type',
  'response_mode',
  'scope',
  'state',
  'nonce',
  'code_challenge',
  'code_challenge_method',
  'request',
  'request_uri',
]);

export const OidcConfigSchema = z.strictObject({
  vendor: z.enum(IDP_VENDORS),
  /** Issuer URL; discovery is `<issuer>/.well-known/openid-configuration`. */
  issuer: HttpUrl,
  clientId: z.string().min(1).max(256),
  clientAuth: z.enum(['client_secret_basic', 'client_secret_post']).default('client_secret_basic'),
  /** Secret row holding the client secret (write-only through the API). */
  clientSecretRef: z.uuid().optional(),
  scopes: z
    .array(z.string().regex(/^[\x21\x23-\x5b\x5d-\x7e]+$/))
    .max(20)
    .optional(),
  authParams: z
    .record(z.string().regex(/^[a-z_]{1,64}$/), z.string().max(512))
    .refine((params) => Object.keys(params).every((k) => !RESERVED_AUTH_PARAMS.has(k)), {
      message: 'protocol parameters cannot be overridden',
    })
    .optional(),
  claims: ClaimOverrides.optional(),
  /** Request `acr_values` (step-up/MFA hints). */
  acrValues: z.string().max(256).optional(),
  /** Link an existing (e.g. SCIM-provisioned) user by email when the IdP marks it verified. */
  linkByVerifiedEmail: z.boolean().default(true),
  roleMapping: RoleMappingSchema.default({ rules: [], defaultRoles: [] }),
});
export type OidcConfig = z.output<typeof OidcConfigSchema>;

export const SpCredentialSchema = z.strictObject({
  id: z.uuid(),
  use: z.enum(['signing', 'encryption']),
  /** `next` is published in metadata ahead of activation; `retired` still decrypts. */
  state: z.enum(['active', 'next', 'retired']),
  certificate: Pem,
  privateKeyRef: z.uuid(),
  notAfter: z.iso.datetime(),
});
export type SpCredential = z.output<typeof SpCredentialSchema>;

export const SamlConfigSchema = z.strictObject({
  vendor: z.enum(IDP_VENDORS),
  idpEntityId: z.string().min(1).max(1024),
  ssoUrl: HttpUrl,
  sloUrl: HttpUrl.optional(),
  /** Trusted IdP signing certificates; several during IdP certificate rotation. */
  idpCertificates: z.array(Pem).min(1).max(5),
  nameIdFormat: z.string().max(256).optional(),
  /** Unsolicited responses (IdP-initiated SSO) are refused unless the tenant enables them. */
  allowIdpInitiated: z.boolean().default(false),
  /** Sign AuthnRequests and LogoutRequests with the SP signing key. */
  signRequests: z.boolean().default(true),
  /** Require the IdP to encrypt assertions (the SP encryption certificate is in the metadata). */
  requireEncryptedAssertions: z.boolean().default(false),
  authnContext: z.array(z.string().max(256)).max(10).optional(),
  attributes: ClaimOverrides.optional(),
  linkByVerifiedEmail: z.boolean().default(false),
  roleMapping: RoleMappingSchema.default({ rules: [], defaultRoles: [] }),
  /** Managed by Verbis (rotation endpoints); not writable through the config. */
  spCredentials: z.array(SpCredentialSchema).max(10).default([]),
});
export type SamlConfig = z.output<typeof SamlConfigSchema>;

export function oidcClaimNames(config: OidcConfig): ClaimNames {
  return {
    ...OIDC_PRESETS[config.vendor].claims,
    ...Object.fromEntries(
      Object.entries(config.claims ?? {}).filter(([, value]) => value !== undefined),
    ),
  };
}

export function oidcScopes(config: OidcConfig): string[] {
  const scopes = config.scopes ?? [...OIDC_PRESETS[config.vendor].scopes];
  return scopes.includes('openid') ? scopes : ['openid', ...scopes];
}

export function oidcAuthParams(config: OidcConfig): Record<string, string> {
  return { ...OIDC_PRESETS[config.vendor].authParams, ...config.authParams };
}

export function samlAttributeNames(config: SamlConfig): ClaimNames {
  return {
    ...SAML_PRESETS[config.vendor].attributes,
    ...Object.fromEntries(
      Object.entries(config.attributes ?? {}).filter(([, value]) => value !== undefined),
    ),
  };
}

export function samlNameIdFormat(config: SamlConfig): string {
  return config.nameIdFormat ?? SAML_PRESETS[config.vendor].nameIdFormat;
}

export const DomainSchema = z
  .string()
  .max(253)
  .transform((value) => value.trim().toLowerCase())
  .pipe(
    z
      .string()
      .regex(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'must be a DNS domain'),
  );
