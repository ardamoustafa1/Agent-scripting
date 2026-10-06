import {
  createLocalJWKSet,
  decodeProtectedHeader,
  errors as joseErrors,
  jwtVerify,
  type JSONWebKeySet,
} from 'jose';
import { z } from 'zod';

import { CLOCK_SKEW_SECONDS, LaunchDeniedError, MAX_LAUNCH_TTL_SECONDS } from './launch.js';

/**
 * CTI-less launch (flow c): an external system signs a compact JWS with a tenant-registered key.
 * Algorithms are pinned (no `alg` negotiation, never `none`/HMAC), `kid` must be in the issuer's
 * JWKS (rotation = several keys), the audience is tenant-scoped and the lifetime is ≤ 60 s.
 */
export const LAUNCH_JWS_ALGORITHMS = ['EdDSA', 'ES256'] as const;

export const launchAudience = (tenantId: string): string => `verbis-launch:${tenantId}`;

export const LaunchJwsClaimsSchema = z.object({
  iss: z.string().min(1).max(256),
  aud: z.union([z.string(), z.array(z.string()).min(1).max(5)]),
  jti: z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/),
  iat: z.number().int(),
  exp: z.number().int(),
  nbf: z.number().int().optional(),
  /** Verbis user id the launch is for. */
  agentId: z.uuid(),
  /** Verbis interaction id (the launcher registered it through the connector). */
  interactionId: z.uuid(),
});
export type LaunchJwsClaims = z.infer<typeof LaunchJwsClaimsSchema>;

export const PublicJwksSchema = z.object({
  keys: z
    .array(
      z
        .looseObject({ kty: z.enum(['OKP', 'EC']), kid: z.string().min(1).max(128) })
        .refine((key) => !('d' in key), 'private key material is not allowed'),
    )
    .min(1)
    .max(10),
});

/** Reads `iss` without trusting it, to pick the issuer's JWKS. Verification follows. */
export function peekIssuer(token: string): string {
  try {
    const header = decodeProtectedHeader(token);
    if (
      typeof header.alg !== 'string' ||
      !(LAUNCH_JWS_ALGORITHMS as readonly string[]).includes(header.alg) ||
      typeof header.kid !== 'string'
    )
      throw new LaunchDeniedError('token_invalid');
    const [, body] = token.split('.');
    const payload: unknown = JSON.parse(Buffer.from(body ?? '', 'base64url').toString('utf8'));
    const iss = z.object({ iss: z.string().min(1).max(256) }).parse(payload).iss;
    return iss;
  } catch (error) {
    if (error instanceof LaunchDeniedError) throw error;
    throw new LaunchDeniedError('token_invalid');
  }
}

export async function verifyLaunchJws(
  token: string,
  options: { jwks: JSONWebKeySet; issuer: string; tenantId: string; now: Date },
): Promise<LaunchJwsClaims> {
  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token, createLocalJWKSet(options.jwks), {
      issuer: options.issuer,
      audience: launchAudience(options.tenantId),
      algorithms: [...LAUNCH_JWS_ALGORITHMS],
      requiredClaims: ['exp', 'iat', 'jti', 'aud', 'iss'],
      clockTolerance: CLOCK_SKEW_SECONDS,
      maxTokenAge: MAX_LAUNCH_TTL_SECONDS + CLOCK_SKEW_SECONDS,
      currentDate: options.now,
    }));
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) throw new LaunchDeniedError('code_expired');
    if (error instanceof joseErrors.JWTClaimValidationFailed) {
      throw new LaunchDeniedError(
        error.claim === 'aud'
          ? 'token_audience'
          : error.claim === 'iat'
            ? 'token_lifetime'
            : 'token_invalid',
      );
    }
    if (
      error instanceof joseErrors.JWSSignatureVerificationFailed ||
      error instanceof joseErrors.JWKSNoMatchingKey
    )
      throw new LaunchDeniedError('token_signature');
    throw new LaunchDeniedError('token_invalid');
  }
  const claims = LaunchJwsClaimsSchema.safeParse(payload);
  if (!claims.success) throw new LaunchDeniedError('token_invalid');
  if (claims.data.exp - claims.data.iat > MAX_LAUNCH_TTL_SECONDS)
    throw new LaunchDeniedError('token_lifetime');
  return claims.data;
}
