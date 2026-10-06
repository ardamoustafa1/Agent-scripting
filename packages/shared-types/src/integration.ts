import { z } from 'zod';

const ref = z.uuid();
const serverUrl = z.url().refine((value) => {
  return (
    /^https?:\/\/[^/?#@]+(?:[/?][^#]*)?$/.test(value) &&
    !/[?&](?:access_token|token|api_?key|password|client_secret)=/i.test(value)
  );
}, 'Expected an HTTP(S) URL without credentials or fragment');
const text = z.string().max(8192);
const credentials = { secretRef: ref };
export const IntegrationAuthSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('none') }),
  z.strictObject({
    type: z.literal('apiKey'),
    ...credentials,
    placement: z.enum(['header', 'query']),
    name: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  }),
  z.strictObject({ type: z.literal('basic'), ...credentials }),
  z.strictObject({ type: z.literal('bearer'), ...credentials }),
  z.strictObject({
    type: z.literal('oauth2-client-credentials'),
    ...credentials,
    tokenUrl: serverUrl,
    scope: text.optional(),
  }),
  z.strictObject({
    type: z.literal('oauth2-password'),
    ...credentials,
    tokenUrl: serverUrl,
    scope: text.optional(),
  }),
  z.strictObject({ type: z.literal('mtls'), ...credentials }),
  z.strictObject({
    type: z.literal('hmac'),
    ...credentials,
    header: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .default('X-Signature'),
  }),
  z.strictObject({ type: z.literal('wsSecurity'), ...credentials }),
]);
export const IntegrationProfileSchema = z.strictObject({
  baseUrl: serverUrl,
  auth: IntegrationAuthSchema,
});
const jsonSchema = z.record(z.string(), z.unknown());
export const IntegrationDefinitionSchema = z
  .strictObject({
    schemaVersion: z.literal('1.1.0').default('1.1.0'),
    baseUrl: serverUrl,
    endpoint: z.string().startsWith('/').max(2048),
    method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
    headers: z.record(z.string(), text).default({}),
    query: z.record(z.string(), text).default({}),
    body: z.unknown().optional(),
    auth: IntegrationAuthSchema.default({ type: 'none' }),
    inputSchema: jsonSchema.default({}),
    outputSchema: jsonSchema.default({}),
    mapping: z.strictObject({ request: text.optional(), response: text.optional() }).default({}),
    profiles: z
      .strictObject({
        dev: IntegrationProfileSchema.optional(),
        test: IntegrationProfileSchema.optional(),
        prod: IntegrationProfileSchema.optional(),
      })
      .default({}),
    mock: z.strictObject({ enabled: z.boolean().default(false), response: z.unknown() }).optional(),
    mockScenarios: z
      .array(
        z.strictObject({
          key: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
          kind: z.enum(['success', 'empty', 'error', 'delay']),
          response: z.unknown(),
          delayMs: z.int().min(0).max(10000).default(0),
        }),
      )
      .max(20)
      .default([]),
    pendingPromotion: z
      .strictObject({
        requestedBy: z.string(),
        from: z.enum(['dev', 'test']),
        profile: IntegrationProfileSchema,
        requestedAt: z.iso.datetime(),
        reason: z.string().min(1).max(500),
      })
      .optional(),
    soap: z
      .strictObject({
        namespace: z.url(),
        operation: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/),
        action: text,
      })
      .optional(),
    graphql: z
      .strictObject({
        query: z.string().min(1).max(32768),
        operationName: z.string().max(128).optional(),
        maxDepth: z.number().int().min(1).max(20).default(8),
        maxComplexity: z.number().int().min(1).max(5000).default(200),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    for (const key of Object.keys(v.headers))
      if (
        /^(authorization|proxy-authorization|cookie|host|connection|content-length|transfer-encoding)$/i.test(
          key,
        )
      )
        ctx.addIssue({
          code: 'custom',
          path: ['headers', key],
          message: 'Reserved header; use a secret reference',
        });
  });
export const IntegrationPolicySchema = z.strictObject({
  allowedOrigins: z.array(z.url()).max(100).default([]),
  allowHttp: z.boolean().default(false),
  timeoutMs: z.number().int().min(100).max(10000).default(5000),
  maxResponseBytes: z
    .number()
    .int()
    .min(1)
    .max(5 * 1024 * 1024)
    .default(1024 * 1024),
  retries: z.number().int().min(0).max(3).default(2),
  breakerThreshold: z.number().int().min(1).max(100).default(5),
  breakerResetMs: z.number().int().min(100).max(300000).default(30000),
  concurrency: z.number().int().min(1).max(100).default(10),
  cacheTtlSeconds: z.number().int().min(0).max(86400).default(0),
  containsPii: z.boolean().default(true),
  piiPaths: z.array(z.string().max(256)).max(100).default([]),
  fallback: z.unknown().optional(),
});
export const IntegrationSaveSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  protocol: z.enum(['rest', 'soap', 'graphql']),
  definition: IntegrationDefinitionSchema.safeExtend({ pendingPromotion: z.never().optional() }),
  policy: IntegrationPolicySchema,
});
export const IntegrationCallSchema = z.strictObject({
  input: z.unknown(),
  scenario: z.string().max(64).optional(),
  environment: z.enum(['dev', 'test', 'prod']).default('prod'),
});
export const IntegrationSecretSetSchema = z.strictObject({
  name: z.string().min(1).max(128),
  kind: z.enum(['password', 'api_key', 'oauth_client', 'certificate', 'generic']),
  value: z.string().min(1).max(65536),
});
export const IntegrationConsoleSchema = z.object({
  request: z.unknown(),
  response: z.unknown(),
  mapped: z.unknown(),
  durationMs: z.number(),
  cached: z.boolean(),
  mock: z.boolean(),
  error: z.string().nullable(),
});
export type IntegrationDefinition = z.infer<typeof IntegrationDefinitionSchema>;
export type IntegrationPolicy = z.infer<typeof IntegrationPolicySchema>;
export type IntegrationAuth = z.infer<typeof IntegrationAuthSchema>;
export type IntegrationCall = z.infer<typeof IntegrationCallSchema>;

export const IntegrationPromotionSchema = z.strictObject({
  from: z.enum(['dev', 'test']),
  reason: z.string().min(1).max(500),
});
export const IntegrationRecordSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  protocol: z.enum(['rest', 'soap', 'graphql']),
  version: z.int(),
  definition: IntegrationDefinitionSchema,
  policy: IntegrationPolicySchema,
});
export const IntegrationMetricsSchema = z.array(
  z.object({
    profile: z.string(),
    calls: z.number(),
    errors: z.number(),
    errorRate: z.number(),
    p50: z.number(),
    p95: z.number(),
    p99: z.number(),
    breaker: z.number(),
  }),
);
