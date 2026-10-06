/** Reads one cookie from a Cookie header (values are base64url tokens; anything else is ignored). */
import type { ApiEnv } from '../../../env.js';
import type { FastifyReply } from 'fastify';

export function cookieValue(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : undefined;
  }
  return undefined;
}

/**
 * The only credential the browser holds: an opaque id in a `__Host-` cookie (host-only, path `/`,
 * Secure), httpOnly so scripts cannot read it, SameSite Lax/Strict (SECURITY S4, ADR-0004).
 */
export class SessionCookie {
  readonly name: string;
  /** Login transaction cookie: binds the IdP round trip to this browser (login CSRF). */
  readonly transactionName: string;

  constructor(private readonly env: ApiEnv) {
    const prefix = env.SESSION_COOKIE_SECURE ? '__Host-' : '';
    this.name = `${prefix}${env.SESSION_COOKIE_NAME}`;
    this.transactionName = `${prefix}${env.SESSION_COOKIE_NAME}_tx`;
  }

  set(reply: FastifyReply, token: string, maxAgeSeconds: number): void {
    void reply.setCookie(this.name, token, {
      httpOnly: true,
      secure: this.env.SESSION_COOKIE_SECURE,
      sameSite: this.env.SESSION_COOKIE_SAMESITE,
      path: '/',
      maxAge: maxAgeSeconds,
    });
  }

  clear(reply: FastifyReply): void {
    void reply.clearCookie(this.name, {
      httpOnly: true,
      secure: this.env.SESSION_COOKIE_SECURE,
      sameSite: this.env.SESSION_COOKIE_SAMESITE,
      path: '/',
    });
  }

  /**
   * SameSite=None: SAML responses arrive as a cross-site POST from the IdP, which Lax cookies
   * would not accompany. It carries only a random handle that must match the login transaction.
   */
  setTransaction(reply: FastifyReply, handle: string, maxAgeSeconds: number): void {
    void reply.setCookie(this.transactionName, handle, {
      httpOnly: true,
      secure: this.env.SESSION_COOKIE_SECURE,
      sameSite: this.env.SESSION_COOKIE_SECURE ? 'none' : 'lax',
      path: '/',
      maxAge: maxAgeSeconds,
    });
  }

  clearTransaction(reply: FastifyReply): void {
    void reply.clearCookie(this.transactionName, {
      httpOnly: true,
      secure: this.env.SESSION_COOKIE_SECURE,
      sameSite: this.env.SESSION_COOKIE_SECURE ? 'none' : 'lax',
      path: '/',
    });
  }
}
