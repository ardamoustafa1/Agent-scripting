import { z } from 'zod';

import { envSchemas, parseEnv } from '@verbis/shared-types';

import {
  AXP_DEFAULT_TOKEN_PATH,
  AxpEndpointsSchema,
  AxpPathTemplateSchema,
} from './connectors/avaya/axp/endpoints.js';

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

const blank = (value: unknown) => (value === '' ? undefined : value);

export const HubEnvSchema = z
  .object({
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
    /** Accept marketplace adapters; requires a separately deployed vendor bridge (MATRIX.md). */
    HUB_MARKETPLACE_BRIDGE_ENABLED: envSchemas.boolean.default(false),
    /** AXP token path on the pinned avayacloud host; {accountId} placeholder (audit M-25). */
    HUB_AXP_TOKEN_PATH: AxpPathTemplateSchema.default(AXP_DEFAULT_TOKEN_PATH),
    /** AXP REST wrap-up is unverified: off unless `rest` with HUB_AXP_WRAPUP_PATH. */
    HUB_AXP_WRAPUP_MODE: z.enum(['disabled', 'rest']).default('disabled'),
    HUB_AXP_WRAPUP_PATH: z.preprocess(blank, AxpPathTemplateSchema.optional()),
    /** Durable dead-letter queue (JetStream). Required in production; empty = in-memory (dev/test). */
    HUB_DLQ_NATS_URL: z.preprocess(
      blank,
      z
        .string()
        .regex(/^(nats|tls):\/\//, 'must be a nats:// or tls:// URL')
        .transform((value) => value.split(',').map((item) => item.trim()))
        .optional(),
    ),
    /** NATS user credentials file for the DLQ connection (mounted secret). */
    HUB_DLQ_NATS_CREDS_FILE: z.string().default(''),
    HUB_DLQ_STREAM: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
      .default('VERBIS_HUB_DLQ'),
    HUB_DLQ_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(2_160).default(168),
    NATS_STREAM_REPLICAS: z.coerce
      .number()
      .int()
      .refine((n) => [1, 3, 5].includes(n))
      .default(1),
  })
  .refine(
    (env) =>
      AxpEndpointsSchema.safeParse({
        tokenPath: env.HUB_AXP_TOKEN_PATH,
        wrapUpMode: env.HUB_AXP_WRAPUP_MODE,
        wrapUpPath: env.HUB_AXP_WRAPUP_PATH,
      }).success,
    {
      message: 'HUB_AXP_WRAPUP_PATH is required when HUB_AXP_WRAPUP_MODE=rest',
      path: ['HUB_AXP_WRAPUP_PATH'],
    },
  )
  .refine((env) => !(env.NODE_ENV === 'production' && env.HUB_DLQ_NATS_URL === undefined), {
    message: 'HUB_DLQ_NATS_URL is required in production (durable dead-letter queue)',
    path: ['HUB_DLQ_NATS_URL'],
  });

export type HubEnv = z.infer<typeof HubEnvSchema>;

export const HUB_ENV = Symbol('HUB_ENV');

export function loadHubEnv(source?: Record<string, string | undefined>): HubEnv {
  return parseEnv(HubEnvSchema, source);
}
