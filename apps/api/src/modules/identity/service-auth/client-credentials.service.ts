import { Inject, Injectable } from '@nestjs/common';
import { importJWK, SignJWT, type JWK } from 'jose';

import { requestContext } from '../../../common/context/request-context.js';
import { uuidv7 } from '../../../common/crypto/uuid.js';
import { PrincipalVerifier } from '../../../common/security/principal.js';
import { type ApiEnv, API_ENV } from '../../../env.js';
import { AuditService } from '../../audit/audit.service.js';
import { isAllowed, type Permission } from '../../authz/permissions.js';
import { identityActor, IdentityTx } from '../core/identity-tx.js';
import { IDENTITY_CLOCK, type Clock } from '../core/identity.tokens.js';
import { TenantResolver } from '../core/tenant-resolver.js';
import { safeEqual, sha256Hex } from '../crypto/random.js';

export class OAuthError extends Error {
  override readonly name = 'OAuthError';
  constructor(
    readonly error:
      | 'invalid_request'
      | 'invalid_client'
      | 'invalid_scope'
      | 'unsupported_grant_type'
      | 'temporarily_unavailable',
    readonly status: number,
    readonly description?: string,
  ) {
    super(error);
  }
}

export interface TokenRequest {
  readonly tenant: string;
  readonly grantType: unknown;
  readonly scope: unknown;
  readonly clientId?: string;
  readonly clientSecret?: string;
  /** How the secret arrived; must match the client's registered method. */
  readonly secretVia: 'basic' | 'post' | 'none';
  readonly certificateThumbprint?: string;
}

export interface TokenResponse {
  readonly access_token: string;
  readonly token_type: 'Bearer';
  readonly expires_in: number;
  readonly scope: string;
}

export const CLIENT_SECRET = /^vsc_[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * OAuth 2.0 client-credentials grant (RFC 6749 §4.4) for connectors and other services.
 * Authentication: client_secret_basic, client_secret_post, or tls_client_auth (RFC 8705).
 * Issues the same short-lived, audience-bound internal JWT the API verifies (ADR-0011), with
 * `typ=service`, the granted `scp`, and `cnf.x5t#S256` when a client certificate was used.
 */
@Injectable()
export class ClientCredentialsService {
  #key: Promise<{ key: Awaited<ReturnType<typeof importJWK>>; kid?: string }> | undefined;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(TenantResolver) private readonly tenants: TenantResolver,
    @Inject(IdentityTx) private readonly identityTx: IdentityTx,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(IDENTITY_CLOCK) private readonly now: Clock,
  ) {}

  private signingKey() {
    const raw = this.env.INTERNAL_JWT_SIGNING_JWK;
    if (raw === undefined || raw === '')
      throw new OAuthError('temporarily_unavailable', 503, 'token issuance is not configured');
    this.#key ??= (async () => {
      const jwk = JSON.parse(raw) as JWK;
      const kid = jwk.kid;
      const published = PrincipalVerifier.parseJwks(this.env.INTERNAL_JWT_JWKS).keys.some(
        (key) => key.kid === kid,
      );
      if (kid === undefined || !published)
        throw new Error('INTERNAL_JWT_SIGNING_JWK kid must be published in INTERNAL_JWT_JWKS');
      return { key: await importJWK(jwk, 'EdDSA'), kid };
    })();
    return this.#key;
  }

  async issue(request: TokenRequest): Promise<TokenResponse> {
    if (request.grantType !== 'client_credentials')
      throw new OAuthError('unsupported_grant_type', 400);
    const scope = request.scope;
    if (scope !== undefined && typeof scope !== 'string')
      throw new OAuthError('invalid_request', 400);
    const tenant = await this.tenants.bySlug(request.tenant);
    if (
      tenant?.status !== 'active' ||
      request.clientId === undefined ||
      !UUID.test(request.clientId)
    ) {
      throw new OAuthError('invalid_client', 401);
    }
    const clientId = request.clientId;
    const actor = identityActor(tenant.id);
    const outcome = await this.identityTx.run(tenant.id, actor, async (tx) => {
      const client = await tx.serviceClient.findFirst({
        where: { id: clientId, tenantId: tenant.id, deletedAt: null },
      });
      const reject = async (reason: string) => {
        await this.audit.record(tx, {
          action: 'identity.serviceToken.rejected',
          target: { type: 'ServiceClient', id: client?.id ?? 'unknown' },
          outcome: 'denied',
          after: { reason },
        });
        return { error: new OAuthError('invalid_client', 401) } as const;
      };
      if (client === null) return reject('unknown_client');
      if (client.status !== 'active') return reject('client_disabled');
      if (client.authMethod === 'tls_client_auth') {
        if (
          request.certificateThumbprint === undefined ||
          !safeEqual(request.certificateThumbprint, client.certificateThumbprint ?? '')
        ) {
          return reject('certificate_mismatch');
        }
      } else {
        const expected = client.authMethod === 'client_secret_basic' ? 'basic' : 'post';
        if (
          request.secretVia !== expected ||
          request.clientSecret === undefined ||
          !CLIENT_SECRET.test(request.clientSecret)
        ) {
          return reject('auth_method_mismatch');
        }
        if (!safeEqual(sha256Hex(request.clientSecret), client.secretHash ?? ''))
          return reject('bad_secret');
        // Optional certificate binding for secret-based clients.
        if (
          client.certificateThumbprint !== null &&
          request.certificateThumbprint !== client.certificateThumbprint
        ) {
          return reject('certificate_mismatch');
        }
      }
      const requested: string[] =
        scope === undefined || scope.trim() === '' ? client.scopes : scope.trim().split(/\s+/);
      const allowed = new Set(client.scopes);
      if (requested.some((scope) => !isAllowed(allowed, scope as Permission))) {
        await this.audit.record(tx, {
          action: 'identity.serviceToken.rejected',
          target: { type: 'ServiceClient', id: client.id, name: client.name },
          outcome: 'denied',
          after: { reason: 'invalid_scope' },
        });
        return { error: new OAuthError('invalid_scope', 400) } as const;
      }
      const ttl = this.env.OAUTH_ACCESS_TOKEN_TTL_SECONDS;
      const iat = Math.floor(this.now() / 1000);
      const jti = uuidv7(this.now());
      const thumbprint =
        client.authMethod === 'tls_client_auth' || client.certificateThumbprint !== null
          ? request.certificateThumbprint
          : undefined;
      const { key, kid } = await this.signingKey();
      const token = await new SignJWT({
        tnt: tenant.id,
        typ: 'service',
        scp: requested,
        ...(thumbprint === undefined ? {} : { cnf: { 'x5t#S256': thumbprint } }),
      })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'at+jwt', ...(kid === undefined ? {} : { kid }) })
        .setSubject(`svc:${client.id}`)
        .setIssuer(this.env.INTERNAL_JWT_ISSUER)
        .setAudience(this.env.INTERNAL_JWT_AUDIENCE)
        .setIssuedAt(iat)
        .setExpirationTime(iat + ttl)
        .setJti(jti)
        .sign(key);
      await tx.serviceClient.update({
        where: { id: client.id },
        data: { lastUsedAt: new Date(this.now()) },
      });
      const ctx = requestContext.require();
      await this.identityTx.runAs(
        { type: 'service', id: `svc:${client.id}`, tenantId: tenant.id, scopes: [] },
        async () => {
          await this.audit.record(tx, {
            action: 'identity.serviceToken.issued',
            target: { type: 'ServiceClient', id: client.id, name: client.name },
            after: {
              jti,
              scopes: requested,
              expiresIn: ttl,
              certificateBound: thumbprint !== undefined,
              correlationId: ctx.correlationId,
            },
          });
        },
      );
      return {
        response: {
          access_token: token,
          token_type: 'Bearer',
          expires_in: ttl,
          scope: requested.join(' '),
        } as const,
      };
    });
    if ('error' in outcome) throw outcome.error;
    return outcome.response;
  }
}
