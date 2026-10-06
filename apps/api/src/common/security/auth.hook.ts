import type { Principal, PrincipalVerifier } from './principal.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the authentication hook when valid credentials are present. */
    principal?: Principal;
    /** True when credentials were present but rejected. */
    authRejected?: boolean;
    /** Set when a cookie session failed the CSRF/origin checks (403, not 401). */
    csrfRejected?: boolean;
  }
}

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

/**
 * Additional credential types (BFF session cookies, SCIM bearer tokens) provided by the identity
 * module. Returns true when it took responsibility for the request; the internal-JWT path is
 * then skipped.
 */
export interface RequestAuthenticator {
  authenticate(request: FastifyRequest): Promise<boolean>;
  /** RFC 8705 thumbprint of the client certificate presented with this request, if any. */
  clientCertificateThumbprint(request: FastifyRequest): string | undefined;
}

/**
 * Verifies credentials once per request (onRequest), before rate limiting, so limits can be keyed
 * per tenant and user. Authorization decisions happen in guards. `authenticator` is resolved
 * lazily because the identity module's providers exist only after the Nest app is created.
 */
export function registerAuthenticationHook(
  app: FastifyInstance,
  verifier: PrincipalVerifier,
  authenticator: () => RequestAuthenticator | undefined = () => undefined,
): void {
  app.decorateRequest('principal', undefined);
  app.decorateRequest('authRejected', false);
  app.decorateRequest('csrfRejected', false);
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const extra = authenticator();
    if (extra !== undefined && (await extra.authenticate(request))) return;
    const header = request.headers.authorization;
    if (header === undefined) return;
    const match = BEARER.exec(header);
    if (match?.[1] === undefined) {
      request.authRejected = true;
      return;
    }
    try {
      const principal = await verifier.verify(match[1]);
      // Certificate-bound token (RFC 8705): the same client certificate must accompany it.
      if (
        principal.certificateThumbprint !== undefined &&
        extra?.clientCertificateThumbprint(request) !== principal.certificateThumbprint
      ) {
        request.authRejected = true;
        return;
      }
      request.principal = principal;
    } catch {
      request.authRejected = true;
    }
  });
}
