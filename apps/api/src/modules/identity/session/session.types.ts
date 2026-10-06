import { z } from 'zod';

/**
 * Server-side BFF session (ADR-0004, ADR-0012). The browser holds only an opaque random id in an
 * httpOnly cookie; this record, including IdP tokens, is sealed (AES-256-GCM) in Redis.
 */
export const SessionRecordSchema = z.object({
  v: z.literal(1),
  /** Public handle (listing, termination, audit); never the cookie value. */
  id: z.uuid(),
  tenantId: z.uuid(),
  userId: z.uuid(),
  kind: z.enum(['sso', 'break_glass']),
  protocol: z.enum(['oidc', 'saml', 'local']),
  idpId: z.uuid().optional(),
  app: z.string().max(32),
  createdAt: z.number().int(),
  lastSeenAt: z.number().int(),
  absoluteExpiresAt: z.number().int(),
  idleTimeoutSeconds: z.number().int().positive(),
  csrfToken: z.string().min(32),
  ip: z.string().max(64),
  userAgent: z.string().max(512),
  /** Break-glass sessions are usable only from this exact origin (admin-web). */
  boundOrigin: z.string().optional(),
  amr: z.array(z.string().max(64)).max(20).optional(),
  acr: z.string().max(256).optional(),
  oidc: z
    .object({
      sub: z.string().max(512),
      sid: z.string().max(512).optional(),
      idToken: z.string().max(16_384).optional(),
      accessToken: z.string().max(16_384).optional(),
      accessTokenExpiresAt: z.number().int().optional(),
      refreshToken: z.string().max(16_384).optional(),
      refreshedAt: z.number().int().optional(),
    })
    .optional(),
  saml: z
    .object({
      nameId: z.string().max(1024),
      nameIdFormat: z.string().max(256),
      sessionIndex: z.string().max(256).optional(),
      nameQualifier: z.string().max(1024).optional(),
      spNameQualifier: z.string().max(1024).optional(),
    })
    .optional(),
});
export type SessionRecord = z.infer<typeof SessionRecordSchema>;

/** What callers supply to create a session; timing fields come from the policy. */
export type NewSession = Omit<
  SessionRecord,
  'v' | 'id' | 'createdAt' | 'lastSeenAt' | 'absoluteExpiresAt' | 'idleTimeoutSeconds' | 'csrfToken'
>;

export interface SessionPolicy {
  readonly idleTimeoutSeconds: number;
  readonly absoluteTimeoutSeconds: number;
  readonly maxConcurrent: number;
  /** `evict_oldest` ends the oldest session; `deny` refuses the new login. */
  readonly onLimit: 'evict_oldest' | 'deny';
}

/** Session view for listing (no tokens, no CSRF token). */
export interface SessionSummary {
  readonly id: string;
  readonly kind: SessionRecord['kind'];
  readonly protocol: SessionRecord['protocol'];
  readonly idpId: string | null;
  readonly app: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  readonly ip: string;
  readonly userAgent: string;
}

export function summarize(record: SessionRecord): SessionSummary {
  return {
    id: record.id,
    kind: record.kind,
    protocol: record.protocol,
    idpId: record.idpId ?? null,
    app: record.app,
    createdAt: new Date(record.createdAt).toISOString(),
    lastSeenAt: new Date(record.lastSeenAt).toISOString(),
    expiresAt: new Date(
      Math.min(record.absoluteExpiresAt, record.lastSeenAt + record.idleTimeoutSeconds * 1000),
    ).toISOString(),
    ip: record.ip,
    userAgent: record.userAgent,
  };
}
