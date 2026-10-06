import { z } from 'zod';

import { envSchemas, parseEnv } from '@verbis/shared-types';

/** Empty env values (`KEY=`) mean "not set". */
const blank = (value: unknown): unknown => (value === '' ? undefined : value);
const optionalText = z.preprocess(blank, z.string().min(1).optional());

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

/** `kid:base64(32 bytes)` entries; the first is the active sealing key. */
const keyringSpec = z
  .string()
  .min(1, 'must be kid:base64key[,kid:base64key…]')
  .refine(
    (value) =>
      value
        .split(',')
        .every((entry) => /^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9+/=_-]{43,44}$/.test(entry.trim())),
    'every entry must be kid:base64(32 bytes)',
  );

/** `app=origin` pairs; origins are exact (scheme://host[:port]) and may contain `{tenant}`. */
const appOrigins = z
  .string()
  .default('')
  .transform((value, ctx) => {
    const out: Record<string, string> = {};
    for (const entry of value.split(',').map((item) => item.trim())) {
      if (entry === '') continue;
      const match = /^([a-z]+)=(https?:\/\/(?:\{tenant\}\.)?[A-Za-z0-9.-]+(?::\d{1,5})?)$/.exec(
        entry,
      );
      if (match?.[1] === undefined || match[2] === undefined) {
        ctx.addIssue({ code: 'custom', message: `invalid app origin: ${entry}` });
        return z.NEVER;
      }
      out[match[1]] = match[2];
    }
    return out;
  });

export const ApiEnvSchema = z
  .object({
    AI_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    AI_ENDPOINTS_JSON: z.string().default('[]'),
    AI_REDACTOR_JSON: z.string().default(''),
    ANALYTICS_ENABLED: envSchemas.boolean.default(false),
    ANALYTICS_REPORTS_ENABLED: envSchemas.boolean.default(false),
    ANALYTICS_SMTP_URL: optionalText,
    ANALYTICS_MAIL_FROM: z.preprocess(blank, z.email().optional()),
    ANALYTICS_STORAGE: z.enum(['postgres', 'clickhouse']).default('postgres'),
    ANALYTICS_PSEUDONYM_KEY: z.preprocess(
      blank,
      z
        .string()
        .regex(/^[A-Za-z0-9+/]{43}=$/)
        .optional(),
    ),
    ANALYTICS_CLICKHOUSE_URL: z.preprocess(blank, z.url().optional()),
    ANALYTICS_CLICKHOUSE_USER: optionalText,
    ANALYTICS_CLICKHOUSE_PASSWORD: optionalText,
    NODE_ENV: envSchemas.nodeEnv,
    LOG_LEVEL: envSchemas.logLevel,
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: envSchemas.port.default(4000),
    AUDIT_WORKER_HEALTH_PORT: envSchemas.port.default(4200),
    NATS_STREAM_REPLICAS: z.coerce
      .number()
      .int()
      .refine((n) => [1, 3, 5].includes(n))
      .default(1),
    APP_VERSION: z.string().default('0.0.0-dev'),
    /** Runtime connection as the least-privilege `verbis_app` role (never the schema owner). */
    DATABASE_APP_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// connection string'),
    REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must be a redis:// or rediss:// URL'),
    NATS_URL: z
      .string()
      .regex(/^(nats|tls):\/\//, 'must be a nats:// or tls:// URL')
      .transform((value) => value.split(',').map((item) => item.trim())),
    /** JWKS (`{"keys":[…]}`) with the public keys of internal-token issuers (ADR-0004). */
    INTERNAL_JWT_JWKS: z.string().min(1, 'must be a JWKS JSON document'),
    INTERNAL_JWT_ISSUER: z.string().min(1).default('verbis-api-gateway'),
    INTERNAL_JWT_AUDIENCE: z.string().min(1).default('verbis-api'),
    /** Exact origins allowed for every tenant (tenants add their own in settings.allowedOrigins). */
    CORS_ALLOWED_ORIGINS: csv,
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(600),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
    /** `public` (dev only), `admin` (requires read:ApiDocs) or `off`. */
    API_DOCS: z.enum(['public', 'admin', 'off']).optional(),
    OUTBOX_RELAY_ENABLED: envSchemas.boolean.default(true),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(500),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(10),
    EVENT_CONSUMERS_ENABLED: envSchemas.boolean.default(true),
    /** Server-only encryption master key; optional until secret operations are enabled. */
    INTEGRATION_MASTER_KEY: z.preprocess(
      blank,
      z
        .string()
        .refine(
          (value) => Buffer.from(value, 'base64').length === 32,
          'Expected a base64 32-byte AES key',
        )
        .optional(),
    ),
    INTEGRATION_RUNTIME_JWKS: optionalText,
    INTEGRATION_KEY_PROVIDER: z.enum(['env', 'vault-transit']).default('env'),
    INTEGRATION_VAULT_ADDRESS: optionalText,
    INTEGRATION_VAULT_TOKEN_FILE: optionalText,
    INTEGRATION_VAULT_MOUNT: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .default('transit'),
    INTEGRATION_VAULT_KEY: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .default('verbis-integrations'),
    INTEGRATION_VAULT_NAMESPACE: z.preprocess(
      blank,
      z
        .string()
        .regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/)
        .optional(),
    ),
    INTEGRATION_VAULT_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(5000),
    /** Read-only migration; new encryptions always use the selected remote provider. */
    INTEGRATION_VAULT_ALLOW_LEGACY_DECRYPT: envSchemas.boolean.default(false),
    // ─── Authoring packages (ADR-0015) ───
    /** Name of this environment in .verbis manifests (dev → test → prod promotion). */
    VERBIS_ENVIRONMENT: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,31}$/)
      .default('dev'),
    /** Private Ed25519 JWK that signs exported packages. */
    PACKAGE_SIGNING_JWK: optionalText,
    /** JWKS of environments whose packages this environment imports. */
    PACKAGE_TRUSTED_JWKS: optionalText,
    /** Resolver decision cache TTL (safety net; publish/assignment events invalidate). */
    RESOLVER_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),
    // ─── Audit (ADR-0014) ───
    /** Public Ed25519 JWKS used to verify checkpoint signatures (API and worker). */
    AUDIT_CHECKPOINT_JWKS: optionalText,
    /** Private Ed25519 JWK (worker only) that signs checkpoints. */
    AUDIT_CHECKPOINT_SIGNING_JWK: optionalText,
    AUDIT_CHECKPOINT_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(86_400).default(300),
    AUDIT_EXPORT_MAX_ROWS: z.coerce.number().int().min(1).max(5_000_000).default(1_000_000),
    AUDIT_VERIFY_MAX_ROWS: z.coerce.number().int().min(1).max(50_000_000).default(5_000_000),
    /** Worker connection as `verbis_audit_worker` (least privilege, never the owner). */
    AUDIT_WORKER_DATABASE_URL: z.preprocess(
      blank,
      z
        .string()
        .regex(/^postgres(ql)?:\/\//)
        .optional(),
    ),
    AUDIT_PARTITION_MONTHS_AHEAD: z.coerce.number().int().min(1).max(24).default(3),
    /** WORM archive (S3 Object Lock). Empty endpoint disables archiving and partition drops. */
    AUDIT_ARCHIVE_S3_ENDPOINT: z.preprocess(blank, z.url().optional()),
    AUDIT_ARCHIVE_S3_REGION: z.string().default('us-east-1'),
    AUDIT_ARCHIVE_S3_BUCKET: optionalText,
    AUDIT_ARCHIVE_S3_ACCESS_KEY_ID: optionalText,
    AUDIT_ARCHIVE_S3_SECRET_ACCESS_KEY: optionalText,
    AUDIT_ARCHIVE_LOCK_MODE: z.enum(['COMPLIANCE', 'GOVERNANCE']).default('COMPLIANCE'),
    /** Default legal retention when a tenant sets none (days). */
    AUDIT_DEFAULT_RETENTION_DAYS: z.coerce.number().int().min(30).max(36_500).default(3650),
    SIEM_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(200),
    SIEM_MAX_BACKOFF_SECONDS: z.coerce.number().int().min(1).max(3600).default(300),
    SCRIPT_DOCUMENT_COMPRESSION_THRESHOLD_BYTES: z.coerce.number().int().min(1024).default(262_144),
    IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),

    // ─── Identity (ADR-0012) ───────────────────────────────────────────────────
    /**
     * AES-256-GCM keyring for server-side sealed data (sessions, IdP secrets, TOTP seeds):
     * `kid:base64key[,kid:base64key…]`; the first key seals, all keys open (rotation).
     */
    IDENTITY_ENCRYPTION_KEYS: keyringSpec,
    /** Private JWK (EdDSA) that signs internal tokens issued by the client-credentials grant. */
    INTERNAL_JWT_SIGNING_JWK: z.string().optional(),
    /**
     * Browser apps that may start a login: `app=origin,…` (e.g. `admin=https://{tenant}.admin.example`).
     * `{tenant}` resolves the tenant from the host. Callback URLs are `<origin><prefix>/auth/…`.
     */
    AUTH_APP_ORIGINS: appOrigins,
    /** Public base URL of this API for protocol endpoints called directly (SCIM, token, SAML metadata). */
    PUBLIC_API_URL: z
      .url({ protocol: /^https?$/ })
      .default('http://localhost:4000')
      .transform((value) => value.replace(/\/+$/, '')),
    /** Path under which the web apps proxy this API (`/api` with the Vite/nginx proxies). */
    AUTH_PUBLIC_PATH_PREFIX: z
      .string()
      .regex(/^(\/[A-Za-z0-9._-]+)*$/)
      .default('/api'),
    SESSION_COOKIE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .default('verbis_session'),
    SESSION_COOKIE_SAMESITE: z.enum(['lax', 'strict']).default('lax'),
    /** Only false for plain-http test rigs; refused in production. */
    /** Public PSP configuration, provisioned by operators; no PAN or private signing keys. */
    PSP_TENANT_PROFILES: optionalText,
    SESSION_COOKIE_SECURE: envSchemas.boolean.default(true),
    SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
    SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().min(1).max(168).default(12),
    SESSION_MAX_CONCURRENT: z.coerce.number().int().min(1).max(100).default(5),
    /** Refresh the IdP tokens (rotation) when the access token expires; detects IdP logout. */
    OIDC_REFRESH_ON_EXPIRY: envSchemas.boolean.default(true),
    /** Allowed clock skew for id_token, logout_token and SAML assertion validation. */
    IDENTITY_CLOCK_SKEW_SECONDS: z.coerce.number().int().min(0).max(300).default(30),
    /** IdP hosts reachable over plain http (development IdPs only; refused in production). */
    IDENTITY_EGRESS_ALLOW_HTTP_HOSTS: csv,
    /** IdP hosts that may resolve to private addresses (on-prem ADFS/Keycloak). */
    IDENTITY_EGRESS_ALLOW_PRIVATE_HOSTS: csv,
    BREAK_GLASS_ENABLED: envSchemas.boolean.default(true),
    /** Exact admin-web origins break-glass login is accepted from (default: the `admin` app). */
    BREAK_GLASS_ALLOWED_ORIGINS: csv,
    BREAK_GLASS_SESSION_MINUTES: z.coerce.number().int().min(5).max(240).default(60),
    BREAK_GLASS_IDLE_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
    BREAK_GLASS_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    BREAK_GLASS_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    /** Access-token lifetime of the client-credentials grant (≤ 5 minutes, ADR-0011). */
    OAUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(30).max(300).default(300),
    /**
     * Header carrying the client certificate (URL-encoded PEM) set by a trusted TLS-terminating
     * proxy. Empty: only certificates presented on this process's own TLS socket count.
     */
    MTLS_CLIENT_CERT_HEADER: z
      .string()
      .regex(/^[a-z0-9-]*$/)
      .default(''),

    // ─── Connector hub (step 18, ADR-0018) ─────────────────────────────────────
    /** Base URL of apps/connector-hub for internal calls (participant verification, simulator). */
    CONNECTOR_HUB_URL: z.union([z.url(), z.literal('')]).default(''),
    /** Interaction Simulator endpoints (dev/demo). Refused in production regardless. */
    /** Loopback collaborative authoring listener; 0 disables it. Reverse proxy /collaboration to this port. */
    COLLABORATION_ADDRESS: z
      .string()
      .regex(/^(127\.0\.0\.1|0\.0\.0\.0)$/)
      .default('127.0.0.1'),
    COLLABORATION_PORT: z.coerce.number().int().min(0).max(65535).default(0),
    SIMULATOR_ENABLED: envSchemas.boolean.default(false),
  })
  .transform((env) => ({
    ...env,
    API_DOCS: env.API_DOCS ?? (env.NODE_ENV === 'development' ? 'public' : 'admin'),
    BREAK_GLASS_ALLOWED_ORIGINS:
      env.BREAK_GLASS_ALLOWED_ORIGINS.length > 0
        ? env.BREAK_GLASS_ALLOWED_ORIGINS
        : env.AUTH_APP_ORIGINS['admin'] === undefined
          ? []
          : [env.AUTH_APP_ORIGINS['admin']],
  }))
  .refine((env) => !(env.NODE_ENV === 'production' && env.API_DOCS === 'public'), {
    message: 'API_DOCS=public is not allowed in production',
    path: ['API_DOCS'],
  })
  .refine((env) => !(env.NODE_ENV === 'production' && !env.SESSION_COOKIE_SECURE), {
    message: 'SESSION_COOKIE_SECURE=false is not allowed in production',
    path: ['SESSION_COOKIE_SECURE'],
  })
  .refine(
    (env) => {
      if (env.INTEGRATION_KEY_PROVIDER !== 'vault-transit') return true;
      try {
        const url = new URL(env.INTEGRATION_VAULT_ADDRESS ?? '');
        return (
          !!env.INTEGRATION_VAULT_TOKEN_FILE?.startsWith('/') &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          url.pathname === '/' &&
          (url.protocol === 'https:' ||
            (env.NODE_ENV !== 'production' &&
              url.protocol === 'http:' &&
              ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) &&
          (!env.INTEGRATION_VAULT_ALLOW_LEGACY_DECRYPT || !!env.INTEGRATION_MASTER_KEY)
        );
      } catch {
        return false;
      }
    },
    {
      message:
        'Vault Transit requires a safe origin, absolute token file and explicit legacy key when migrating',
      path: ['INTEGRATION_VAULT_ADDRESS'],
    },
  )
  .refine(
    (env) => !(env.NODE_ENV === 'production' && env.IDENTITY_EGRESS_ALLOW_HTTP_HOSTS.length > 0),
    {
      message: 'IDENTITY_EGRESS_ALLOW_HTTP_HOSTS is not allowed in production',
      path: ['IDENTITY_EGRESS_ALLOW_HTTP_HOSTS'],
    },
  );

export type ApiEnv = z.output<typeof ApiEnvSchema>;

export const API_ENV = Symbol('API_ENV');

export function loadApiEnv(source?: Record<string, string | undefined>): ApiEnv {
  return parseEnv(ApiEnvSchema, source);
}
