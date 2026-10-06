import { Inject, Injectable } from '@nestjs/common';
import {
  createRemoteJWKSet,
  customFetch as joseCustomFetch,
  errors as joseErrors,
  jwtVerify,
} from 'jose';
import * as oidc from 'openid-client';

import { DomainError } from '../../../common/errors/domain-errors.js';
import { type ApiEnv, API_ENV } from '../../../env.js';
import { IDP_FETCH } from '../core/identity.tokens.js';
import { oidcAuthParams, oidcScopes } from '../idp/idp-config.js';

import type { IdpFetch } from '../egress/idp-fetch.js';
import type { OidcIdp } from '../idp/idp.repository.js';

export interface OidcLoginRequest {
  readonly url: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
}

export interface OidcTokens {
  readonly claims: Record<string, unknown>;
  readonly subject: string;
  readonly sid?: string;
  readonly idToken?: string;
  readonly accessToken?: string;
  readonly accessTokenExpiresAt?: number;
  readonly refreshToken?: string;
  readonly amr?: string[];
  readonly acr?: string;
}

export type RefreshOutcome =
  | { readonly kind: 'refreshed'; readonly tokens: Omit<OidcTokens, 'claims' | 'subject'> }
  | { readonly kind: 'revoked' }
  | { readonly kind: 'unavailable' };

export class OidcLoginError extends Error {
  override readonly name = 'OidcLoginError';
  constructor(readonly reason: string) {
    super(reason);
  }
}

const BACKCHANNEL_EVENT = 'http://schemas.openid.net/event/backchannel-logout';
const CACHE_TTL_MS = 60 * 60 * 1000;
const LOGOUT_ALGORITHMS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
];

/**
 * OIDC relying party (Authorization Code + PKCE S256, state, nonce) on openid-client, with all
 * IdP traffic through the egress guard. Network calls never run inside a DB transaction: callers
 * load the IdP and its secret first, then call these methods.
 */
@Injectable()
export class OidcService {
  readonly #configs = new Map<
    string,
    { version: number; config: oidc.Configuration; expires: number }
  >();
  readonly #jwks = new Map<string, { uri: string; keys: ReturnType<typeof createRemoteJWKSet> }>();

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(IDP_FETCH) private readonly fetch: IdpFetch,
  ) {}

  async configuration(idp: OidcIdp, clientSecret: string): Promise<oidc.Configuration> {
    const hit = this.#configs.get(idp.id);
    if (hit?.version === idp.version && hit.expires > Date.now()) return hit.config;
    const issuer = new URL(idp.config.issuer);
    const auth =
      idp.config.clientAuth === 'client_secret_post'
        ? oidc.ClientSecretPost(clientSecret)
        : oidc.ClientSecretBasic(clientSecret);
    let config: oidc.Configuration;
    try {
      config = await oidc.discovery(
        issuer,
        idp.config.clientId,
        { [oidc.clockTolerance]: this.env.IDENTITY_CLOCK_SKEW_SECONDS },
        auth,
        {
          [oidc.customFetch]: this.fetch as unknown as oidc.CustomFetch,
          // Plain http is possible only for hosts the egress guard allows (development IdPs).
          // eslint-disable-next-line @typescript-eslint/no-deprecated -- only reachable for IDENTITY_EGRESS_ALLOW_HTTP_HOSTS (refused in production)
          execute: issuer.protocol === 'http:' ? [oidc.allowInsecureRequests] : [],
          timeout: 5,
        },
      );
    } catch {
      throw new DomainError('VERBIS_AUTH_IDP_UNAVAILABLE');
    }
    config[oidc.customFetch] = this.fetch as unknown as oidc.CustomFetch;
    if (this.#configs.size > 1000) this.#configs.clear();
    this.#configs.set(idp.id, { version: idp.version, config, expires: Date.now() + CACHE_TTL_MS });
    return config;
  }

  /** Drops cached discovery (IdP updated, disabled or deleted). */
  forget(idpId: string): void {
    this.#configs.delete(idpId);
    this.#jwks.delete(idpId);
  }

  async authorizationRequest(
    idp: OidcIdp,
    config: oidc.Configuration,
    callbackUrl: string,
    state: string,
    loginHint?: string,
  ): Promise<OidcLoginRequest> {
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const nonce = oidc.randomNonce();
    const params: Record<string, string> = {
      ...oidcAuthParams(idp.config),
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: oidcScopes(idp.config).join(' '),
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      ...(idp.config.acrValues === undefined ? {} : { acr_values: idp.config.acrValues }),
      ...(loginHint === undefined ? {} : { login_hint: loginHint }),
    };
    return { url: oidc.buildAuthorizationUrl(config, params).href, state, nonce, codeVerifier };
  }

  /** Validates the authorization response and redeems the code (id_token checked per spec). */
  async redeem(
    config: oidc.Configuration,
    currentUrl: URL,
    checks: { state: string; nonce: string; codeVerifier: string },
  ): Promise<OidcTokens> {
    let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
    try {
      tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
        expectedState: checks.state,
        expectedNonce: checks.nonce,
        pkceCodeVerifier: checks.codeVerifier,
        idTokenExpected: true,
      });
    } catch (error) {
      if (error instanceof oidc.AuthorizationResponseError)
        throw new OidcLoginError(`idp_error:${error.error}`);
      if (error instanceof oidc.ResponseBodyError)
        throw new OidcLoginError(`token_error:${error.error}`);
      throw new OidcLoginError('token_validation_failed');
    }
    const claims = tokens.claims();
    if (claims === undefined) throw new OidcLoginError('id_token_missing');
    return {
      claims: { ...claims },
      subject: claims.sub,
      ...(typeof claims['sid'] === 'string' ? { sid: claims['sid'] } : {}),
      ...(tokens.id_token === undefined ? {} : { idToken: tokens.id_token }),
      accessToken: tokens.access_token,
      ...(tokens.expires_in === undefined
        ? {}
        : { accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000 }),
      ...(tokens.refresh_token === undefined ? {} : { refreshToken: tokens.refresh_token }),
      ...(Array.isArray(claims['amr'])
        ? { amr: claims['amr'].filter((v): v is string => typeof v === 'string') }
        : {}),
      ...(typeof claims['acr'] === 'string' ? { acr: claims['acr'] } : {}),
    };
  }

  /**
   * Refresh-token grant with rotation: the IdP's new refresh token replaces the old one. A refused
   * refresh (`invalid_grant`: IdP session ended, token reused or revoked) ends the Verbis session.
   */
  async refresh(
    config: oidc.Configuration,
    refreshToken: string,
    expectedSubject: string,
  ): Promise<RefreshOutcome> {
    try {
      const tokens = await oidc.refreshTokenGrant(config, refreshToken);
      const claims = tokens.claims();
      if (claims !== undefined && claims.sub !== expectedSubject) return { kind: 'revoked' };
      return {
        kind: 'refreshed',
        tokens: {
          ...(tokens.id_token === undefined ? {} : { idToken: tokens.id_token }),
          accessToken: tokens.access_token,
          ...(tokens.expires_in === undefined
            ? {}
            : { accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000 }),
          refreshToken: tokens.refresh_token ?? refreshToken,
        },
      };
    } catch (error) {
      if (
        error instanceof oidc.ResponseBodyError &&
        (error.status === 400 || error.status === 401)
      ) {
        return { kind: 'revoked' };
      }
      return { kind: 'unavailable' };
    }
  }

  /** RP-initiated logout URL, when the IdP has an end_session_endpoint. */
  endSessionUrl(
    config: oidc.Configuration,
    idToken: string | undefined,
    postLogoutRedirectUri: string,
  ): string | undefined {
    if (config.serverMetadata().end_session_endpoint === undefined) return undefined;
    return oidc.buildEndSessionUrl(config, {
      post_logout_redirect_uri: postLogoutRedirectUri,
      client_id: config.clientMetadata().client_id,
      ...(idToken === undefined ? {} : { id_token_hint: idToken }),
    }).href;
  }

  issuer(config: oidc.Configuration): string {
    return config.serverMetadata().issuer;
  }

  /**
   * Validates an OIDC Back-Channel Logout token (OpenID Back-Channel Logout 1.0 §2.6): signature
   * from the IdP's JWKS, iss, aud, iat, jti, the logout event, no nonce, sid and/or sub.
   */
  async verifyLogoutToken(
    idp: OidcIdp,
    config: oidc.Configuration,
    token: string,
  ): Promise<{ sid?: string; sub?: string; jti: string; exp: number }> {
    const metadata = config.serverMetadata();
    if (metadata.jwks_uri === undefined) throw new OidcLoginError('no_jwks_uri');
    let entry = this.#jwks.get(idp.id);
    if (entry?.uri !== metadata.jwks_uri) {
      entry = {
        uri: metadata.jwks_uri,
        keys: createRemoteJWKSet(new URL(metadata.jwks_uri), {
          [joseCustomFetch]: this.fetch,
          timeoutDuration: 5000,
        }),
      };
      this.#jwks.set(idp.id, entry);
    }
    try {
      const { payload } = await jwtVerify(token, entry.keys, {
        issuer: metadata.issuer,
        audience: idp.config.clientId,
        algorithms: LOGOUT_ALGORITHMS,
        clockTolerance: this.env.IDENTITY_CLOCK_SKEW_SECONDS,
        maxTokenAge: '10m',
        requiredClaims: ['iat', 'jti', 'events'],
      });
      const events = payload['events'];
      if (
        events === null ||
        typeof events !== 'object' ||
        Array.isArray(events) ||
        !Object.hasOwn(events, BACKCHANNEL_EVENT) ||
        typeof (events as Record<string, unknown>)[BACKCHANNEL_EVENT] !== 'object' ||
        (events as Record<string, unknown>)[BACKCHANNEL_EVENT] === null ||
        Array.isArray((events as Record<string, unknown>)[BACKCHANNEL_EVENT])
      ) {
        throw new OidcLoginError('logout_event_missing');
      }
      if (payload['nonce'] !== undefined) throw new OidcLoginError('logout_token_has_nonce');
      const sid = typeof payload['sid'] === 'string' ? payload['sid'] : undefined;
      const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
      if (sid === undefined && sub === undefined)
        throw new OidcLoginError('logout_token_no_subject');
      return {
        ...(sid === undefined ? {} : { sid }),
        ...(sub === undefined ? {} : { sub }),
        jti: String(payload.jti),
        exp: typeof payload.exp === 'number' ? payload.exp : Math.floor(Date.now() / 1000) + 600,
      };
    } catch (error) {
      if (error instanceof OidcLoginError) throw error;
      if (error instanceof joseErrors.JOSEError) throw new OidcLoginError('logout_token_invalid');
      throw error;
    }
  }
}
