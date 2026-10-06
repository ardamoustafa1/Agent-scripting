import { createLocalJWKSet, errors as joseErrors, jwtVerify, type JSONWebKeySet } from 'jose';
import { z } from 'zod';

/**
 * Authenticated caller, derived only from a verified internal token minted by the BFF or a
 * platform service (ADR-0004). Never from request bodies, query strings or plain headers.
 */
export interface Principal {
  readonly type: 'user' | 'service';
  /** User id (UUID) or service name. */
  readonly id: string;
  readonly tenantId: string;
  /** Scopes granted to service principals; users get permissions from their roles. */
  readonly scopes: readonly string[];
  readonly sessionId?: string;
  /** How a user authenticated (`sso`, `break_glass`); absent for internal tokens. */
  readonly authMethod?: 'sso' | 'break_glass';
  /** RFC 8705 `x5t#S256` the token is bound to (mTLS service clients). */
  readonly certificateThumbprint?: string;
}

/** Actor reference stored in created_by/updated_by and audit events. */
export function actorRef(principal: Principal): string {
  return `${principal.type}:${principal.id}`;
}

export const MAX_TOKEN_LIFETIME_SECONDS = 300;

const ClaimsSchema = z.object({
  sub: z.string().min(1).max(100),
  tnt: z.uuid(),
  typ: z.enum(['user', 'service']),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().min(1).max(128),
  scp: z
    .array(z.string().regex(/^[a-z]+:[A-Za-z]+$/))
    .max(100)
    .optional(),
  sid: z.string().max(128).optional(),
  cnf: z.object({ 'x5t#S256': z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).optional(),
});

export interface PrincipalVerifierOptions {
  readonly jwks: JSONWebKeySet;
  readonly issuer: string;
  readonly audience: string;
  /** Injectable clock (seconds) for tests. */
  readonly now?: () => number;
}

export class InvalidTokenError extends Error {
  override readonly name = 'InvalidTokenError';
}

/** Verifies internal access tokens: asymmetric only, issuer/audience bound, ≤ 5 minutes. */
export class PrincipalVerifier {
  readonly #keys: ReturnType<typeof createLocalJWKSet>;

  constructor(private readonly options: PrincipalVerifierOptions) {
    this.#keys = createLocalJWKSet(options.jwks);
  }

  static parseJwks(raw: string): JSONWebKeySet {
    const parsed: unknown = JSON.parse(raw);
    const result = z
      .object({ keys: z.array(z.looseObject({ kty: z.string() })).min(1) })
      .safeParse(parsed);
    if (!result.success) throw new Error('INTERNAL_JWT_JWKS must be a JWKS with at least one key');
    for (const key of result.data.keys) {
      if ('d' in key) throw new Error('INTERNAL_JWT_JWKS must contain public keys only');
    }
    return result.data;
  }

  async verify(token: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, this.#keys, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ['EdDSA', 'ES256'],
        requiredClaims: ['exp', 'iat', 'sub', 'jti'],
        ...(this.options.now === undefined
          ? {}
          : { currentDate: new Date(this.options.now() * 1000) }),
      });
      const claims = ClaimsSchema.parse(payload);
      if (claims.exp - claims.iat > MAX_TOKEN_LIFETIME_SECONDS) {
        throw new InvalidTokenError('token lifetime exceeds the maximum');
      }
      if (claims.typ === 'user' && !z.uuid().safeParse(claims.sub).success) {
        throw new InvalidTokenError('user subject must be a UUID');
      }
      return {
        type: claims.typ,
        id: claims.sub,
        tenantId: claims.tnt,
        scopes: claims.typ === 'service' ? (claims.scp ?? []) : [],
        ...(claims.sid === undefined ? {} : { sessionId: claims.sid }),
        ...(claims.cnf === undefined ? {} : { certificateThumbprint: claims.cnf['x5t#S256'] }),
      };
    } catch (error) {
      if (error instanceof InvalidTokenError) throw error;
      if (error instanceof joseErrors.JOSEError || error instanceof z.ZodError) {
        throw new InvalidTokenError('token rejected');
      }
      throw error;
    }
  }
}
