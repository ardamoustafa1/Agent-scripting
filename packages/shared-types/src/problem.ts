import { z } from 'zod';

/** RFC 7807 problem details, Verbis profile (CLAUDE.md §7). */
export const ProblemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string().regex(/^VERBIS_[A-Z0-9]+_[A-Z0-9_]+$/),
  correlationId: z.string().optional(),
  errors: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
        /** Stable machine code of the individual error (e.g. a script validation code). */
        code: z.string().optional(),
      }),
    )
    .optional(),
});

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
export const PROBLEM_TYPE_BASE = 'https://errors.verbis.io/';

const STATUS_DEFAULTS: Record<number, { slug: string; title: string; code: string }> = {
  400: { slug: 'bad-request', title: 'Bad Request', code: 'VERBIS_HTTP_BAD_REQUEST' },
  401: { slug: 'unauthorized', title: 'Unauthorized', code: 'VERBIS_HTTP_UNAUTHORIZED' },
  403: { slug: 'forbidden', title: 'Forbidden', code: 'VERBIS_HTTP_FORBIDDEN' },
  404: { slug: 'not-found', title: 'Not Found', code: 'VERBIS_HTTP_NOT_FOUND' },
  405: {
    slug: 'method-not-allowed',
    title: 'Method Not Allowed',
    code: 'VERBIS_HTTP_METHOD_NOT_ALLOWED',
  },
  409: { slug: 'conflict', title: 'Conflict', code: 'VERBIS_HTTP_CONFLICT' },
  422: { slug: 'unprocessable', title: 'Unprocessable Content', code: 'VERBIS_HTTP_UNPROCESSABLE' },
  429: { slug: 'rate-limited', title: 'Too Many Requests', code: 'VERBIS_HTTP_RATE_LIMITED' },
  503: { slug: 'unavailable', title: 'Service Unavailable', code: 'VERBIS_HTTP_UNAVAILABLE' },
};

const CLIENT_ERROR = {
  slug: 'client-error',
  title: 'Client Error',
  code: 'VERBIS_HTTP_CLIENT_ERROR',
};
const INTERNAL = { slug: 'internal', title: 'Internal Server Error', code: 'VERBIS_HTTP_INTERNAL' };

/**
 * Builds a problem document for an HTTP status. 5xx details are never exposed to clients.
 */
export function problemForStatus(
  status: number,
  options: { instance?: string; detail?: string; correlationId?: string } = {},
): ProblemDetails {
  const normalized = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
  const meta = STATUS_DEFAULTS[normalized] ?? (normalized < 500 ? CLIENT_ERROR : INTERNAL);
  const problem: ProblemDetails = {
    type: `${PROBLEM_TYPE_BASE}${meta.slug}`,
    title: meta.title,
    status: normalized,
    code: meta.code,
  };
  if (options.instance !== undefined) problem.instance = options.instance;
  if (options.correlationId !== undefined) problem.correlationId = options.correlationId;
  if (options.detail !== undefined && normalized < 500) problem.detail = options.detail;
  return problem;
}

/**
 * Catalogue of Verbis problem types (CLAUDE.md §7). `code` is the stable machine contract;
 * `title` is a fixed English summary. Localized, user-facing text is derived from `code`.
 */
export const PROBLEM_CATALOG = {
  VERBIS_CONNECTOR_CONCURRENCY_LIMIT: {
    status: 409,
    slug: 'connector-concurrency-limit',
    title: 'Agent channel capacity reached',
  },
  VERBIS_CONNECTOR_PAYLOAD_REJECTED: {
    status: 422,
    slug: 'connector-payload-rejected',
    title: 'Connector rejected the request',
  },
  VERBIS_CONNECTOR_COMMAND_UNSUPPORTED: {
    status: 422,
    slug: 'connector-command-unsupported',
    title: 'Connector command is not supported',
  },
  VERBIS_CONNECTOR_ACCESS_DENIED: {
    status: 403,
    slug: 'connector-access-denied',
    title: 'Connector access denied',
  },
  VERBIS_CONNECTOR_RATE_LIMITED: {
    status: 429,
    slug: 'connector-rate-limited',
    title: 'Connector rate limit reached',
  },
  VERBIS_AI_DISABLED: { status: 403, slug: 'ai-disabled', title: 'AI is disabled' },
  VERBIS_AI_QUOTA: { status: 429, slug: 'ai-quota', title: 'AI quota exhausted' },
  VERBIS_AI_UNAVAILABLE: {
    status: 503,
    slug: 'ai-unavailable',
    title: 'AI provider or local redactor unavailable',
  },
  VERBIS_AI_OUTPUT: { status: 422, slug: 'ai-output', title: 'AI output failed validation' },
  VERBIS_AUTH_UNAUTHENTICATED: {
    status: 401,
    slug: 'auth/unauthenticated',
    title: 'Authentication required',
  },
  VERBIS_AUTH_CSRF_FAILED: {
    status: 403,
    slug: 'auth/csrf-failed',
    title: 'Cross-site request forgery check failed',
  },
  VERBIS_AUTH_LOGIN_FAILED: { status: 401, slug: 'auth/login-failed', title: 'Sign-in failed' },
  VERBIS_AUTH_INVALID_CREDENTIALS: {
    status: 401,
    slug: 'auth/invalid-credentials',
    title: 'Invalid credentials',
  },
  VERBIS_AUTH_ORIGIN_NOT_ALLOWED: {
    status: 403,
    slug: 'auth/origin-not-allowed',
    title: 'Request origin is not allowed',
  },
  VERBIS_AUTH_SESSION_LIMIT_REACHED: {
    status: 409,
    slug: 'auth/session-limit-reached',
    title: 'Concurrent session limit reached',
  },
  VERBIS_AUTH_TENANT_UNKNOWN: {
    status: 404,
    slug: 'auth/tenant-unknown',
    title: 'No sign-in is configured for this organization',
  },
  VERBIS_AUTH_IDP_UNAVAILABLE: {
    status: 502,
    slug: 'auth/idp-unavailable',
    title: 'The identity provider is unavailable',
  },
  VERBIS_AUTH_BREAK_GLASS_DISABLED: {
    status: 403,
    slug: 'auth/break-glass-disabled',
    title: 'Break-glass sign-in is disabled',
  },
  VERBIS_AUTHZ_FORBIDDEN: { status: 403, slug: 'authz/forbidden', title: 'Forbidden' },
  VERBIS_AUTHZ_SCOPE_MISSING: {
    status: 403,
    slug: 'authz/scope-missing',
    title: 'Campaign scope required',
  },
  VERBIS_AUTHZ_SOD_VIOLATION: {
    status: 403,
    slug: 'authz/separation-of-duties',
    title: 'Authors cannot approve their own version',
  },
  VERBIS_AUTHZ_PRIVILEGE_ESCALATION: {
    status: 403,
    slug: 'authz/privilege-escalation',
    title: 'Cannot grant permissions you do not hold',
  },
  VERBIS_IDENTITY_DOMAIN_CLAIMED: {
    status: 409,
    slug: 'identity/domain-claimed',
    title: 'Email domain is already claimed',
  },
  VERBIS_IDENTITY_IDP_CONFIG_INVALID: {
    status: 422,
    slug: 'identity/idp-config-invalid',
    title: 'Identity provider configuration is invalid',
  },
  VERBIS_IDENTITY_PASSWORD_WEAK: {
    status: 422,
    slug: 'identity/password-weak',
    title: 'Password does not meet the policy',
  },
  VERBIS_IDENTITY_MFA_INVALID: {
    status: 422,
    slug: 'identity/mfa-invalid',
    title: 'One-time code is invalid',
  },
  VERBIS_TENANT_INACTIVE: { status: 403, slug: 'tenant/inactive', title: 'Tenant is not active' },
  /** One code for every refused launch (wrong user/tenant, expired, replayed, tampered): no oracle. */
  VERBIS_LAUNCH_DENIED: { status: 403, slug: 'launch/denied', title: 'Launch denied' },
  VERBIS_LAUNCH_NO_ASSIGNMENT: {
    status: 422,
    slug: 'launch/no-assignment',
    title: 'No script is assigned to this interaction',
  },
  VERBIS_LAUNCH_RATE_LIMITED: {
    status: 429,
    slug: 'launch/rate-limited',
    title: 'Too many launch attempts',
  },
  VERBIS_RESOURCE_NOT_FOUND: {
    status: 404,
    slug: 'resource/not-found',
    title: 'Resource not found',
  },
  VERBIS_RESOURCE_CONFLICT: { status: 409, slug: 'resource/conflict', title: 'Resource conflict' },
  VERBIS_VALIDATION_FAILED: { status: 400, slug: 'validation/failed', title: 'Validation failed' },
  VERBIS_PAGINATION_INVALID_CURSOR: {
    status: 400,
    slug: 'pagination/invalid-cursor',
    title: 'Invalid pagination cursor',
  },
  VERBIS_CONCURRENCY_PRECONDITION_REQUIRED: {
    status: 428,
    slug: 'concurrency/precondition-required',
    title: 'If-Match header required',
  },
  VERBIS_CONCURRENCY_VERSION_MISMATCH: {
    status: 412,
    slug: 'concurrency/version-mismatch',
    title: 'Resource version mismatch',
  },
  VERBIS_IDEMPOTENCY_KEY_INVALID: {
    status: 400,
    slug: 'idempotency/key-invalid',
    title: 'Invalid Idempotency-Key',
  },
  VERBIS_IDEMPOTENCY_KEY_REUSED: {
    status: 422,
    slug: 'idempotency/key-reused',
    title: 'Idempotency-Key reused with a different request',
  },
  VERBIS_IDEMPOTENCY_IN_PROGRESS: {
    status: 409,
    slug: 'idempotency/in-progress',
    title: 'A request with this Idempotency-Key is in progress',
  },
  VERBIS_SCRIPT_INVALID_TRANSITION: {
    status: 409,
    slug: 'script/invalid-transition',
    title: 'The version cannot make this lifecycle transition',
  },
  VERBIS_SCRIPT_VERSION_IMMUTABLE: {
    status: 409,
    slug: 'script/version-immutable',
    title: 'Only draft versions can be changed',
  },
  VERBIS_SCRIPT_SEMVER_NOT_INCREASING: {
    status: 422,
    slug: 'script/semver-not-increasing',
    title: 'The semantic version must be greater than every existing version',
  },
  VERBIS_SCRIPT_APPROVER_NOT_ELIGIBLE: {
    status: 403,
    slug: 'script/approver-not-eligible',
    title: 'You are not an eligible approver for this version',
  },
  VERBIS_SCRIPT_VERSION_IN_USE: {
    status: 409,
    slug: 'script/version-in-use',
    title: 'The version is pinned by active assignments',
  },
  VERBIS_SCREEN_COMPOSITION_CONFLICT: {
    status: 422,
    slug: 'screen/composition-conflict',
    title: 'Shared screens conflict with the script document',
  },
  VERBIS_PACKAGE_INVALID: {
    status: 422,
    slug: 'package/invalid',
    title: 'The package failed verification',
  },
  VERBIS_SCRIPT_DOCUMENT_INVALID: {
    status: 422,
    slug: 'script/document-invalid',
    title: 'Script document is invalid',
  },
  VERBIS_INTEGRATION_FAILED: {
    status: 502,
    slug: 'integration-failed',
    title: 'Integration failed',
  },
  VERBIS_AUDIT_UNAVAILABLE: {
    status: 503,
    slug: 'audit-unavailable',
    title: 'Security audit unavailable',
  },
  VERBIS_INTEGRATION_UNAVAILABLE: {
    status: 503,
    slug: 'integration-unavailable',
    title: 'Integration unavailable',
  },
  VERBIS_HTTP_RATE_LIMITED: { status: 429, slug: 'rate-limited', title: 'Too Many Requests' },
  VERBIS_HTTP_PAYLOAD_TOO_LARGE: {
    status: 413,
    slug: 'payload-too-large',
    title: 'Payload Too Large',
  },
  VERBIS_HTTP_UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    slug: 'unsupported-media-type',
    title: 'Unsupported Media Type',
  },
} as const satisfies Record<string, { status: number; slug: string; title: string }>;

export type ProblemCode = keyof typeof PROBLEM_CATALOG;

export interface ProblemOptions {
  instance?: string;
  detail?: string;
  correlationId?: string;
  errors?: ProblemDetails['errors'];
}

/** Builds a catalogued problem document. */
export function problemForCode(code: ProblemCode, options: ProblemOptions = {}): ProblemDetails {
  const meta = PROBLEM_CATALOG[code];
  const problem: ProblemDetails = {
    type: `${PROBLEM_TYPE_BASE}${meta.slug}`,
    title: meta.title,
    status: meta.status,
    code,
  };
  if (options.instance !== undefined) problem.instance = options.instance;
  if (options.correlationId !== undefined) problem.correlationId = options.correlationId;
  if (options.detail !== undefined) problem.detail = options.detail;
  if (options.errors !== undefined && options.errors.length > 0) problem.errors = options.errors;
  return problem;
}

export function isProblemCode(value: string): value is ProblemCode {
  return Object.hasOwn(PROBLEM_CATALOG, value);
}
