import { z } from 'zod';

import { envSchemas, parseEnv } from '@verbis/shared-types';

const TenantsSchema = z
  .string()
  .default('[]')
  .transform((raw, ctx) => {
    try {
      return z
        .array(
          z.strictObject({
            slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
            clientId: z.string().min(1).max(128),
          }),
        )
        .max(500)
        .parse(JSON.parse(raw));
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be JSON [{"slug":"…","clientId":"…"}]' });
      return z.NEVER;
    }
  });

export const HubEnvSchema = z.object({
  NODE_ENV: envSchemas.nodeEnv,
  LOG_LEVEL: envSchemas.logLevel,
  CONNECTOR_HUB_HOST: z.string().min(1).default('127.0.0.1'),
  CONNECTOR_HUB_PORT: envSchemas.port.default(4100),
  APP_VERSION: z.string().default('0.0.0-dev'),
  /** API base URL (mTLS in production). */
  HUB_API_URL: z.url().default('http://127.0.0.1:4000'),
  /** Tenants served by this hub, each with its own mTLS service client. */
  HUB_TENANTS: TenantsSchema,
  HUB_CLIENT_CERT_FILE: z.string().default(''),
  HUB_CLIENT_KEY_FILE: z.string().default(''),
  HUB_CA_FILE: z.string().default(''),
  /** Public JWKS trusted for API → hub calls (EdDSA, audience verbis-connector-hub). */
  HUB_TRUSTED_JWKS: z.string().default('{"keys":[]}'),
  HUB_QUEUE_CAPACITY: z.coerce.number().int().min(10).max(100_000).default(1_000),
  HUB_DELIVERY_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
  /** How often connector configs are re-read from the API (new/disabled connectors). */
  HUB_CONFIG_REFRESH_SECONDS: z.coerce.number().int().min(5).max(3_600).default(60),
  HUB_HEALTH_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(600).default(30),
  SIMULATOR_ENABLED: envSchemas.boolean.default(false),
});

export type HubEnv = z.infer<typeof HubEnvSchema>;

export const HUB_ENV = Symbol('HUB_ENV');

export function loadHubEnv(source?: Record<string, string | undefined>): HubEnv {
  return parseEnv(HubEnvSchema, source);
}
