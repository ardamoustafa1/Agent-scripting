/**
 * Vendor presets: sensible defaults for the IdPs Verbis supports out of the box. Every value can
 * be overridden in the IdP configuration; presets only fill what the admin left empty.
 */
export const IDP_VENDORS = [
  'entra',
  'okta',
  'keycloak',
  'google',
  'adfs',
  'ping',
  'generic',
] as const;
export type IdpVendor = (typeof IDP_VENDORS)[number];

export interface ClaimNames {
  readonly email: string;
  readonly emailVerified?: string;
  readonly displayName: string;
  readonly givenName?: string;
  readonly familyName?: string;
  readonly groups: string;
  readonly locale?: string;
}

export interface OidcPreset {
  readonly scopes: readonly string[];
  readonly claims: ClaimNames;
  /** Extra authorization request parameters (e.g. Google's `access_type=offline`). */
  readonly authParams: Readonly<Record<string, string>>;
  /** Whether the vendor sends `email_verified` reliably (email linking requires it). */
  readonly emailVerifiedClaim: boolean;
}

export interface SamlPreset {
  readonly attributes: ClaimNames;
  readonly nameIdFormat: string;
}

const NAMEID_UNSPECIFIED = 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified';
const NAMEID_EMAIL = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';
const NAMEID_PERSISTENT = 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent';

const STANDARD_CLAIMS: ClaimNames = {
  email: 'email',
  emailVerified: 'email_verified',
  displayName: 'name',
  givenName: 'given_name',
  familyName: 'family_name',
  groups: 'groups',
  locale: 'locale',
};

const MS_CLAIMS = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims';

export const OIDC_PRESETS: Readonly<Record<IdpVendor, OidcPreset>> = {
  // Entra ID: v2.0 endpoints, `groups` needs "groupMembershipClaims" in the app manifest.
  entra: {
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    claims: { ...STANDARD_CLAIMS, emailVerified: 'xms_edov', email: 'email' },
    authParams: {},
    emailVerifiedClaim: false,
  },
  okta: {
    scopes: ['openid', 'profile', 'email', 'groups', 'offline_access'],
    claims: STANDARD_CLAIMS,
    authParams: {},
    emailVerifiedClaim: true,
  },
  // Keycloak: plain refresh tokens (not offline_access) stay tied to the SSO session, so a refresh
  // fails once the user logs out at the IdP.
  keycloak: {
    scopes: ['openid', 'profile', 'email'],
    claims: STANDARD_CLAIMS,
    authParams: {},
    emailVerifiedClaim: true,
  },
  // Google Workspace: refresh tokens require access_type=offline; groups come from SCIM/Cloud Identity.
  google: {
    scopes: ['openid', 'profile', 'email'],
    claims: STANDARD_CLAIMS,
    authParams: { access_type: 'offline', prompt: 'consent' },
    emailVerifiedClaim: true,
  },
  // AD FS 2016+: `allatclaims` puts issuance-transform claims into the id_token.
  adfs: {
    scopes: ['openid', 'profile', 'email', 'allatclaims'],
    claims: { email: 'upn', displayName: 'unique_name', groups: 'group' },
    authParams: {},
    emailVerifiedClaim: false,
  },
  ping: {
    scopes: ['openid', 'profile', 'email'],
    claims: { ...STANDARD_CLAIMS, groups: 'memberOf' },
    authParams: {},
    emailVerifiedClaim: false,
  },
  generic: {
    scopes: ['openid', 'profile', 'email'],
    claims: STANDARD_CLAIMS,
    authParams: {},
    emailVerifiedClaim: true,
  },
};

export const SAML_PRESETS: Readonly<Record<IdpVendor, SamlPreset>> = {
  entra: {
    attributes: {
      email: `${MS_CLAIMS}/emailaddress`,
      displayName: 'http://schemas.microsoft.com/identity/claims/displayname',
      givenName: `${MS_CLAIMS}/givenname`,
      familyName: `${MS_CLAIMS}/surname`,
      groups: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups',
    },
    nameIdFormat: NAMEID_PERSISTENT,
  },
  adfs: {
    attributes: {
      email: `${MS_CLAIMS}/emailaddress`,
      displayName: `${MS_CLAIMS}/name`,
      givenName: `${MS_CLAIMS}/givenname`,
      familyName: `${MS_CLAIMS}/surname`,
      groups: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role',
    },
    nameIdFormat: NAMEID_UNSPECIFIED,
  },
  okta: {
    attributes: {
      email: 'email',
      displayName: 'displayName',
      givenName: 'firstName',
      familyName: 'lastName',
      groups: 'groups',
    },
    nameIdFormat: NAMEID_EMAIL,
  },
  keycloak: {
    attributes: {
      email: 'email',
      displayName: 'displayName',
      givenName: 'firstName',
      familyName: 'lastName',
      groups: 'groups',
    },
    nameIdFormat: NAMEID_UNSPECIFIED,
  },
  google: {
    attributes: {
      email: 'email',
      displayName: 'displayName',
      givenName: 'firstName',
      familyName: 'lastName',
      groups: 'groups',
    },
    nameIdFormat: NAMEID_EMAIL,
  },
  ping: {
    attributes: {
      email: 'mail',
      displayName: 'cn',
      givenName: 'givenName',
      familyName: 'sn',
      groups: 'memberOf',
    },
    nameIdFormat: NAMEID_UNSPECIFIED,
  },
  generic: {
    attributes: {
      email: 'email',
      displayName: 'displayName',
      givenName: 'givenName',
      familyName: 'surname',
      groups: 'groups',
    },
    nameIdFormat: NAMEID_UNSPECIFIED,
  },
};
