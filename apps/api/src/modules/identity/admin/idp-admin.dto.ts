import { z } from 'zod';

import { ResourceMetaShape } from '../../../common/dto.js';
import { DomainSchema, OidcConfigSchema, SamlConfigSchema } from '../idp/idp-config.js';

/** OIDC config as written by admins: the client secret is write-only, never read back. */
const OidcConfigInput = OidcConfigSchema.omit({ clientSecretRef: true }).extend({
  clientSecret: z.string().min(1).max(1024).optional().meta({ description: '@secret write-only' }),
});
const SamlConfigInput = SamlConfigSchema.omit({ spCredentials: true });

const Common = {
  displayName: z.string().trim().min(1).max(128),
  domains: z.array(DomainSchema).max(50).default([]),
  jitProvisioning: z.boolean().default(false),
  scimEnabled: z.boolean().default(false),
  status: z.enum(['draft', 'active', 'disabled']).default('draft'),
};

export const CreateIdpSchema = z
  .discriminatedUnion('protocol', [
    z.strictObject({ protocol: z.literal('oidc'), ...Common, config: OidcConfigInput }),
    z.strictObject({ protocol: z.literal('saml'), ...Common, config: SamlConfigInput }),
  ])
  .meta({ id: 'CreateIdentityProvider' });
export type CreateIdpInput = z.output<typeof CreateIdpSchema>;

export const UpdateIdpSchema = z
  .strictObject({
    displayName: Common.displayName.optional(),
    domains: z.array(DomainSchema).max(50).optional(),
    jitProvisioning: z.boolean().optional(),
    scimEnabled: z.boolean().optional(),
    status: z.enum(['draft', 'active', 'disabled']).optional(),
    /** Full protocol config (same shape as on create, protocol cannot change). */
    config: z.union([OidcConfigInput, SamlConfigInput]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'at least one field is required')
  .meta({ id: 'UpdateIdentityProvider' });
export type UpdateIdpInput = z.output<typeof UpdateIdpSchema>;

export const SpCredentialViewSchema = z.object({
  id: z.uuid(),
  use: z.enum(['signing', 'encryption']),
  state: z.enum(['active', 'next', 'retired']),
  certificate: z.string(),
  notAfter: z.string(),
});

export const IdentityProviderDetailSchema = z
  .object({
    ...ResourceMetaShape,
    protocol: z.enum(['oidc', 'saml']),
    displayName: z.string(),
    domains: z.array(z.string()),
    jitProvisioning: z.boolean(),
    scimEnabled: z.boolean(),
    status: z.enum(['draft', 'active', 'disabled']),
    /** Protocol config without secrets (`clientSecretSet` instead of the secret). */
    config: z.record(z.string(), z.unknown()),
    /** URLs to register at the IdP. */
    endpoints: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  })
  .meta({ id: 'IdentityProviderDetail' });
export type IdentityProviderDetail = z.infer<typeof IdentityProviderDetailSchema>;

export const RotateSpCredentialSchema = z
  .strictObject({ use: z.enum(['signing', 'encryption']) })
  .meta({ id: 'RotateSpCredential' });

export const ScimTokenCreateSchema = z
  .strictObject({ expiresInDays: z.number().int().min(1).max(730).optional() })
  .meta({ id: 'CreateScimToken' });
export const ScimTokenSchema = z
  .object({
    id: z.uuid(),
    prefix: z.string(),
    createdAt: z.string(),
    expiresAt: z.string().nullable(),
    lastUsedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
  })
  .meta({ id: 'ScimToken' });
export const IssuedScimTokenSchema = ScimTokenSchema.extend({
  token: z.string().meta({ description: '@secret shown once' }),
  scimBaseUrl: z.string(),
}).meta({ id: 'IssuedScimToken' });
