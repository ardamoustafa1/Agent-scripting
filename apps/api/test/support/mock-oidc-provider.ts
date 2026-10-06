import { createHash, randomBytes } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';

/** Claims the mock IdP asserts for the next login. */
export interface MockUser {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  groups?: string[];
}

interface PendingCode {
  clientId: string;
  redirectUri: string;
  nonce: string;
  codeChallenge: string;
  sid: string;
  user: MockUser;
}

/**
 * Minimal OpenID Provider for tests: discovery, JWKS (RS256), authorization codes with PKCE S256
 * and nonce, refresh tokens with rotation and reuse detection, end-session, logout tokens.
 */
export class MockOidcProvider {
  readonly #app: FastifyInstance = Fastify();
  #privateKey!: CryptoKey;
  #publicJwk!: Record<string, unknown>;
  readonly #codes = new Map<string, PendingCode>();
  readonly #refresh = new Map<string, { sid: string; user: MockUser; clientId: string }>();
  issuer = '';
  user: MockUser = { sub: 'u-1' };
  accessTokenLifetime = 300;
  clientId = 'verbis-test';
  clientSecret = 'mock-client-secret-0123456789';
  readonly grants: string[] = [];

  async start(): Promise<void> {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    this.#privateKey = privateKey;
    this.#publicJwk = { ...(await exportJWK(publicKey)), kid: 'mock-1', alg: 'RS256', use: 'sig' };
    this.#app.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_req, body, done) => {
        done(null, Object.fromEntries(new URLSearchParams(body as string)));
      },
    );
    this.#app.get('/.well-known/openid-configuration', () => ({
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/authorize`,
      token_endpoint: `${this.issuer}/token`,
      jwks_uri: `${this.issuer}/jwks`,
      end_session_endpoint: `${this.issuer}/logout`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      backchannel_logout_supported: true,
      backchannel_logout_session_supported: true,
    }));
    this.#app.get('/jwks', () => ({ keys: [this.#publicJwk] }));
    this.#app.post('/token', async (request, reply) => {
      const body = request.body as Record<string, string>;
      const auth = request.headers.authorization;
      const basic =
        auth?.startsWith('Basic ') === true
          ? Buffer.from(auth.slice(6), 'base64').toString('utf8')
          : undefined;
      const [id, secret] =
        basic === undefined
          ? [body['client_id'], body['client_secret']]
          : basic.split(':').map(decodeURIComponent);
      if (id !== this.clientId || secret !== this.clientSecret)
        return reply.status(401).send({ error: 'invalid_client' });
      this.grants.push(body['grant_type'] ?? '');
      if (body['grant_type'] === 'authorization_code') {
        const pending = this.#codes.get(body['code'] ?? '');
        this.#codes.delete(body['code'] ?? '');
        if (pending === undefined || pending.redirectUri !== body['redirect_uri'])
          return reply.status(400).send({ error: 'invalid_grant' });
        const challenge = createHash('sha256')
          .update(body['code_verifier'] ?? '')
          .digest('base64url');
        if (challenge !== pending.codeChallenge)
          return reply.status(400).send({ error: 'invalid_grant', error_description: 'pkce' });
        return this.tokens(pending.sid, pending.user, pending.nonce);
      }
      if (body['grant_type'] === 'refresh_token') {
        const entry = this.#refresh.get(body['refresh_token'] ?? '');
        if (entry === undefined) return reply.status(400).send({ error: 'invalid_grant' });
        this.#refresh.delete(body['refresh_token'] ?? ''); // rotation: single use
        return this.tokens(entry.sid, entry.user);
      }
      return reply.status(400).send({ error: 'unsupported_grant_type' });
    });
    this.#app.get('/logout', () => ({ ok: true }));
    await this.#app.listen({ port: 0, host: '127.0.0.1' });
    const address = this.#app.server.address();
    this.issuer = `http://127.0.0.1:${typeof address === 'object' && address !== null ? String(address.port) : '0'}`;
  }

  async stop(): Promise<void> {
    await this.#app.close();
  }

  /** What the IdP does when the browser arrives with an authorization request: returns the callback query. */
  authorize(
    authorizationUrl: string,
    sid = randomBytes(8).toString('hex'),
  ): { code: string; state: string; redirectUri: string; sid: string } {
    const url = new URL(authorizationUrl);
    const params = url.searchParams;
    if (params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256')
      throw new Error('bad request');
    const code = randomBytes(16).toString('hex');
    this.#codes.set(code, {
      clientId: params.get('client_id') ?? '',
      redirectUri: params.get('redirect_uri') ?? '',
      nonce: params.get('nonce') ?? '',
      codeChallenge: params.get('code_challenge') ?? '',
      sid,
      user: { ...this.user },
    });
    return {
      code,
      state: params.get('state') ?? '',
      redirectUri: params.get('redirect_uri') ?? '',
      sid,
    };
  }

  /** Simulates the IdP session ending: every refresh token stops working. */
  revokeRefreshTokens(): void {
    this.#refresh.clear();
  }

  async idToken(sid: string, user: MockUser, nonce?: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ ...user, sid, ...(nonce === undefined ? {} : { nonce }) })
      .setProtectedHeader({ alg: 'RS256', kid: 'mock-1' })
      .setIssuer(this.issuer)
      .setAudience(this.clientId)
      .setSubject(user.sub)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(this.#privateKey);
  }

  async logoutToken(
    claims: { sid?: string; sub?: string; nonce?: string; events?: unknown },
    options: { audience?: string } = {},
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const jwt = new SignJWT({
      events: claims.events ?? { 'http://schemas.openid.net/event/backchannel-logout': {} },
      ...(claims.sid === undefined ? {} : { sid: claims.sid }),
      ...(claims.nonce === undefined ? {} : { nonce: claims.nonce }),
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'mock-1', typ: 'logout+jwt' })
      .setIssuer(this.issuer)
      .setAudience(options.audience ?? this.clientId)
      .setIssuedAt(now)
      .setExpirationTime(now + 120)
      .setJti(randomBytes(8).toString('hex'));
    if (claims.sub !== undefined) jwt.setSubject(claims.sub);
    return jwt.sign(this.#privateKey);
  }

  private async tokens(sid: string, user: MockUser, nonce?: string) {
    const refreshToken = randomBytes(16).toString('hex');
    this.#refresh.set(refreshToken, { sid, user, clientId: this.clientId });
    return {
      access_token: randomBytes(16).toString('hex'),
      token_type: 'Bearer',
      expires_in: this.accessTokenLifetime,
      refresh_token: refreshToken,
      id_token: await this.idToken(sid, user, nonce),
    };
  }
}
