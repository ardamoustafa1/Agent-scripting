import { z } from 'zod';

import {
  CtiIdentityInputSchema,
  AdminTenantInputSchema,
  AdminTenantViewSchema,
  AdminPrivacyInputSchema,
  AdminPrivacyViewSchema,
  AdminPublicJwksSchema,
} from '@verbis/shared-types';

import { ConnectorAdapterSchema } from '../connectors/connectors.dto.js';

export {
  AdminTenantInputSchema,
  AdminTenantViewSchema,
  AdminPrivacyInputSchema,
  AdminPrivacyViewSchema,
};
export const ConnectorConfigSchema = z.record(z.string(), z.json()).superRefine((value, ctx) => {
  let nodes = 0;
  function walk(entry: unknown, depth: number) {
    if (++nodes > 1000 || depth > 16) {
      ctx.addIssue({ code: 'custom', message: 'configuration exceeds limits' });
      return;
    }
    if (typeof entry === 'string' && entry.length > 2048)
      ctx.addIssue({ code: 'custom', message: 'configuration value too large' });
    if (typeof entry === 'string' && /^https?:\/\//.test(entry)) {
      try {
        const url = new URL(entry);
        if (
          url.username ||
          url.password ||
          [...url.searchParams.keys()].some((key) => /password|secret|token|api.?key/i.test(key))
        )
          ctx.addIssue({ code: 'custom', message: 'URL credentials must be vault references' });
      } catch {
        ctx.addIssue({ code: 'custom', message: 'invalid configuration URL' });
      }
    }
    if (Array.isArray(entry)) {
      if (entry.length > 100)
        ctx.addIssue({ code: 'custom', message: 'configuration array too large' });
      for (const item of entry) walk(item, depth + 1);
    } else if (entry !== null && typeof entry === 'object') {
      for (const [key, item] of Object.entries(entry)) {
        if (
          /password|secret|token|privatekey|authorization|apikey|credential|bearer/i.test(key) &&
          !/(endpoint|url)$/i.test(key)
        )
          ctx.addIssue({
            code: 'custom',
            message: 'credentials must use config.secrets UUID references',
          });
        walk(item, depth + 1);
      }
    }
  }
  const { secrets, ...configuration } = value;
  if (
    secrets !== undefined &&
    !z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), z.uuid()).safeParse(secrets).success
  )
    ctx.addIssue({ code: 'custom', message: 'config.secrets requires UUID references' });
  walk(configuration, 0);
  if (JSON.stringify(value).length > 32000)
    ctx.addIssue({ code: 'custom', message: 'configuration too large' });
});
export const AdminConnectorInputSchema = z
  .strictObject({
    adapterType: ConnectorAdapterSchema,
    platform: z.string().min(1).max(100),
    status: z.enum(['draft', 'active', 'disabled']),
    config: ConnectorConfigSchema,
    secretRefs: z.array(z.uuid()).max(20),
  })
  .refine(
    (value) =>
      (() => {
        const parsed = z.record(z.string(), z.string()).safeParse(value.config['secrets'] ?? {});
        return (
          parsed.success &&
          Object.values(parsed.data).every((ref) => value.secretRefs.includes(ref))
        );
      })(),
    'all config.secrets references must be bound',
  );
export const IssuerInputSchema = z.strictObject({
  issuer: z.string().min(1).max(256),
  jwks: AdminPublicJwksSchema,
  status: z.enum(['active', 'disabled']),
});
export const IdpDiscoverInputSchema = z.strictObject({ url: z.url().max(2048) });
export const SamlImportInputSchema = z.strictObject({ xml: z.string().min(1).max(256000) });
export const IdpDiscoveryViewSchema = z.object({
  issuer: z.string(),
  authorizationEndpoint: z.string(),
  tokenEndpoint: z.string(),
  jwksUri: z.string(),
});
export const SamlImportViewSchema = z.object({
  idpEntityId: z.string(),
  ssoUrl: z.string(),
  idpCertificates: z.array(z.string()),
});
export const UserMappingSchema = CtiIdentityInputSchema;
export const JsonObjectSchema = z.record(z.string(), z.unknown());
