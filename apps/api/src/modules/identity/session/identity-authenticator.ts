import { X509Certificate } from 'node:crypto';
import { TLSSocket } from 'node:tls';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { type ApiEnv, API_ENV } from '../../../env.js';
import { IdentityTx, identityActor, userActor } from '../core/identity-tx.js';
import { APP_ORIGINS, SESSION_STORE } from '../core/identity.tokens.js';
import { safeEqual, sha256Base64Url } from '../crypto/random.js';
import { ScimAuthenticator } from '../scim/scim.authenticator.js';

import { OidcSessionRefresher } from './oidc-session-refresher.js';
import { cookieValue, SessionCookie } from './session-cookie.js';
import { SessionService } from './session.service.js';

import type { SessionStore } from './session-store.js';
import type { SessionRecord } from './session.types.js';
import type { RequestAuthenticator } from '../../../common/security/auth.hook.js';
import type { AppOrigins } from '../core/app-origins.js';
import type { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** The BFF session behind the principal, when authenticated by cookie. */
    verbisSession?: { readonly hash: string; readonly record: SessionRecord };
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const JSON_TYPES = /^application\/(json|merge-patch\+json|problem\+json)(;|$)/i;

/**
 * Credentials owned by the identity module:
 * - SCIM bearer tokens on `/scim/v2/*`;
 * - the BFF session cookie (when no Authorization header is sent), with CSRF protection on
 *   state-changing requests: synchronizer token header + Origin/Sec-Fetch-Site + JSON-only bodies
 *   (SECURITY §5.3), break-glass origin binding, and OIDC refresh-token rotation.
 */
@Injectable()
export class IdentityAuthenticator implements RequestAuthenticator {
  readonly #logger = new Logger(IdentityAuthenticator.name);
  readonly cookie: SessionCookie;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(SESSION_STORE) private readonly store: SessionStore,
    @Inject(APP_ORIGINS) private readonly origins: AppOrigins,
    @Inject(ScimAuthenticator) private readonly scim: ScimAuthenticator,
    @Inject(OidcSessionRefresher) private readonly refresher: OidcSessionRefresher,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(IdentityTx) private readonly tx: IdentityTx,
  ) {
    this.cookie = new SessionCookie(env);
  }

  async authenticate(request: FastifyRequest): Promise<boolean> {
    if (request.url.startsWith('/scim/v2/')) {
      await this.scim.authenticate(request);
      return true;
    }
    if (request.headers.authorization !== undefined) return false;
    const token = cookieValue(request.headers.cookie, this.cookie.name);
    if (token === undefined) return false;

    const loaded = await this.store.load(token);
    if (loaded === undefined) return true;
    const origin = request.headers.origin;
    if (
      loaded.record.boundOrigin !== undefined &&
      origin !== undefined &&
      origin !== loaded.record.boundOrigin
    ) {
      request.authRejected = true;
      await this.recordRejection(request, loaded.record, 'VERBIS_AUTH_ORIGIN_REJECTED');
      return true;
    }
    if (!SAFE_METHODS.has(request.method) && !this.passesCsrf(request, loaded.record)) {
      request.csrfRejected = true;
      await this.recordRejection(request, loaded.record, 'VERBIS_AUTH_CSRF_FAILED');
      return true;
    }
    const record = await this.refresher.ensureFresh(loaded.hash, loaded.record);
    if (record === undefined) {
      await this.sessions.recordEnded(
        loaded.record.tenantId,
        identityActor(loaded.record.tenantId),
        [loaded.record],
        'refresh_rejected',
      );
      return true;
    }
    request.principal = userActor(record.tenantId, record.userId, record.id, record.kind);
    request.verbisSession = { hash: loaded.hash, record };
    return true;
  }

  private async recordRejection(
    request: FastifyRequest,
    record: SessionRecord,
    reason: string,
  ): Promise<void> {
    // A verified server-side session identifies the audit actor, never an authorized principal.
    // Guards must continue to reject this request before any application handler runs.
    try {
      await this.tx.record(
        record.tenantId,
        userActor(record.tenantId, record.userId, record.id, record.kind),
        {
          action: 'identity.request.denied',
          target: { type: 'Route', id: `${request.method} ${request.url.split('?')[0] ?? ''}` },
          outcome: 'denied',
          reason,
        },
      );
    } catch {
      this.#logger.error(`Failed to audit authentication rejection (correlationId=${request.id})`);
    }
  }

  passesCsrf(request: FastifyRequest, record: SessionRecord): boolean {
    const header = request.headers['x-csrf-token'];
    if (typeof header !== 'string' || !safeEqual(header, record.csrfToken)) return false;
    const origin = request.headers.origin;
    if (origin !== undefined) {
      if (record.boundOrigin !== undefined) {
        if (origin !== record.boundOrigin) return false;
      } else if (this.origins.match(origin) === undefined) {
        return false;
      }
    } else if (request.headers['sec-fetch-site'] !== 'same-origin') {
      return false;
    }
    const length = Number(request.headers['content-length'] ?? '0');
    const type = request.headers['content-type'];
    if ((length > 0 || type !== undefined) && (type === undefined || !JSON_TYPES.test(type)))
      return false;
    return true;
  }

  /**
   * RFC 8705 `x5t#S256` of the client certificate: from this process's TLS socket, or from the
   * verified proxy header (URL-encoded PEM + shared MTLS_PROXY_SECRET proof) when configured.
   */
  clientCertificateThumbprint(request: FastifyRequest): string | undefined {
    try {
      if (this.env.MTLS_CLIENT_CERT_HEADER !== '') {
        const proof = request.headers['x-verbis-mtls-proxy-secret'];
        if (
          this.env.MTLS_PROXY_SECRET.length < 32 ||
          typeof proof !== 'string' ||
          !safeEqual(proof, this.env.MTLS_PROXY_SECRET)
        )
          return undefined;
        const value = request.headers[this.env.MTLS_CLIENT_CERT_HEADER];
        if (typeof value !== 'string' || value === '') return undefined;
        const certificate = new X509Certificate(decodeURIComponent(value));
        return sha256Base64Url(certificate.raw);
      }
      const socket = request.raw.socket;
      if (!(socket instanceof TLSSocket) || !socket.authorized) return undefined;
      const peer = socket.getPeerCertificate();
      return Object.keys(peer).length === 0 ? undefined : sha256Base64Url(peer.raw);
    } catch {
      this.#logger.warn('Unparseable client certificate');
      return undefined;
    }
  }
}
