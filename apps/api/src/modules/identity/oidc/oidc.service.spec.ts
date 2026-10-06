import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Configuration } from 'openid-client';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { OidcConfigSchema } from '../idp/idp-config.js';

import { OidcService } from './oidc.service.js';

import type { ApiEnv } from '../../../env.js';
import type { OidcIdp } from '../idp/idp.repository.js';

const issuer = 'https://synthetic-idp.test';
const event = 'http://schemas.openid.net/event/backchannel-logout';
let keys: Awaited<ReturnType<typeof generateKeyPair>>, jwks: { keys: object[] };
beforeAll(async () => {
  keys = await generateKeyPair('EdDSA');
  jwks = { keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'synthetic' }] };
});
function fixture() {
  const fetcher = vi.fn<typeof fetch>().mockImplementation((input) =>
    Promise.resolve(
      Response.json(
        (input instanceof Request ? input.url : input.toString()).endsWith('/jwks')
          ? jwks
          : {
              issuer,
              authorization_endpoint: `${issuer}/authorize`,
              token_endpoint: `${issuer}/token`,
              jwks_uri: `${issuer}/jwks`,
              end_session_endpoint: `${issuer}/logout`,
            },
      ),
    ),
  );
  const service = new OidcService({ IDENTITY_CLOCK_SKEW_SECONDS: 0 } as ApiEnv, fetcher);
  const idp = {
    id: 'synthetic',
    version: 1,
    config: OidcConfigSchema.parse({ vendor: 'generic', issuer, clientId: 'synthetic-client' }),
  } as OidcIdp;
  const configuration = new Configuration(
    {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      jwks_uri: `${issuer}/jwks`,
      end_session_endpoint: `${issuer}/logout`,
    },
    'synthetic-client',
  );
  return { service, idp, configuration, fetcher };
}
async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({ events: { [event]: {} }, sid: 'synthetic-sid', ...overrides })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'synthetic' })
    .setIssuer(issuer)
    .setAudience('synthetic-client')
    .setIssuedAt()
    .setJti('synthetic-jti')
    .sign(keys.privateKey);
}

describe('OIDC real signed logout and authorization requests', () => {
  it('verifies logout signatures and caches JWKS until the provider is forgotten', async () => {
    const f = fixture();
    const signed = await token();
    expect(await f.service.verifyLogoutToken(f.idp, f.configuration, signed)).toMatchObject({
      sid: 'synthetic-sid',
      jti: 'synthetic-jti',
    });
    await f.service.verifyLogoutToken(f.idp, f.configuration, signed);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    f.service.forget(f.idp.id);
    await f.service.verifyLogoutToken(f.idp, f.configuration, signed);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    { name: 'null events', claims: { events: null }, reason: 'logout_event_missing' },
    { name: 'non-object events', claims: { events: 'invalid' }, reason: 'logout_event_missing' },
    { name: 'absent event', claims: { events: {} }, reason: 'logout_event_missing' },
    {
      name: 'non-object event',
      claims: { events: { [event]: 'invalid' } },
      reason: 'logout_event_missing',
    },
    { name: 'null event', claims: { events: { [event]: null } }, reason: 'logout_event_missing' },
    { name: 'array event', claims: { events: { [event]: [] } }, reason: 'logout_event_missing' },
    { name: 'nonce', claims: { nonce: 'unexpected' }, reason: 'logout_token_has_nonce' },
    { name: 'missing subject', claims: { sid: null }, reason: 'logout_token_no_subject' },
  ])('rejects signed logout tokens with $name', async ({ claims, reason }) => {
    const f = fixture();
    await expect(
      f.service.verifyLogoutToken(f.idp, f.configuration, await token(claims)),
    ).rejects.toMatchObject({ reason });
  });
  it('accepts subject-only logout and preserves an explicit expiry', async () => {
    const f = fixture();
    const exp = Math.floor(Date.now() / 1000) + 120;
    expect(
      await f.service.verifyLogoutToken(
        f.idp,
        f.configuration,
        await token({ sid: null, sub: 'synthetic-sub', exp }),
      ),
    ).toEqual({ sub: 'synthetic-sub', jti: 'synthetic-jti', exp });
  });
  it('rejects corrupt signatures and providers without published JWKS', async () => {
    const f = fixture();
    await expect(
      f.service.verifyLogoutToken(f.idp, f.configuration, 'invalid.token.signature'),
    ).rejects.toMatchObject({ reason: 'logout_token_invalid' });
    await expect(
      f.service.verifyLogoutToken(
        f.idp,
        new Configuration({ issuer }, 'synthetic-client'),
        await token(),
      ),
    ).rejects.toMatchObject({ reason: 'no_jwks_uri' });
  });
  it('creates real PKCE challenges with optional authentication hints and safe logout parameters', async () => {
    const f = fixture();
    f.idp.config.acrValues = 'synthetic-acr';
    const result = await f.service.authorizationRequest(
      f.idp,
      f.configuration,
      'https://designer.test/callback',
      'synthetic-state',
      'synthetic@example.invalid',
    );
    const url = new URL(result.url);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).not.toBe(result.codeVerifier);
    expect(url.searchParams.get('login_hint')).toBe('synthetic@example.invalid');
    expect(url.searchParams.get('acr_values')).toBe('synthetic-acr');
    const basic = new URL(
      (
        await f.service.authorizationRequest(
          {
            ...f.idp,
            config: OidcConfigSchema.parse({
              vendor: 'generic',
              issuer,
              clientId: 'synthetic-client',
            }),
          },
          f.configuration,
          'https://designer.test/callback',
          'state',
        )
      ).url,
    );
    expect(basic.searchParams.has('login_hint')).toBe(false);
    expect(basic.searchParams.has('acr_values')).toBe(false);
    expect(
      new URL(
        f.service.endSessionUrl(
          f.configuration,
          'synthetic-id-token',
          'https://designer.test/logout',
        ) ?? '',
      ).searchParams.get('id_token_hint'),
    ).toBe('synthetic-id-token');
    expect(
      new URL(
        f.service.endSessionUrl(f.configuration, undefined, 'https://designer.test/logout') ?? '',
      ).searchParams.has('id_token_hint'),
    ).toBe(false);
    expect(
      f.service.endSessionUrl(
        new Configuration({ issuer }, 'synthetic-client'),
        undefined,
        'https://designer.test/logout',
      ),
    ).toBeUndefined();
    expect(f.service.issuer(f.configuration)).toBe(issuer);
  });
  it('caches discovery by provider version and invalidates configuration after an update', async () => {
    const f = fixture();
    const first = await f.service.configuration(f.idp, 'synthetic-secret');
    expect(await f.service.configuration(f.idp, 'synthetic-secret')).toBe(first);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    const updatedIdp = { ...f.idp, version: f.idp.version + 1 };
    expect(await f.service.configuration(updatedIdp, 'synthetic-secret')).not.toBe(first);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    f.service.forget(f.idp.id);
    f.idp.config.clientAuth = 'client_secret_post';
    await f.service.configuration(f.idp, 'synthetic-secret');
    expect(f.fetcher).toHaveBeenCalledTimes(3);
  });
  it.each([
    {
      name: 'unchanged token without expiry',
      response: { access_token: 'access', token_type: 'Bearer' },
      rotated: 'original-refresh',
    },
    {
      name: 'rotated token with expiry',
      response: {
        access_token: 'access',
        token_type: 'Bearer',
        refresh_token: 'rotated-refresh',
        expires_in: 120,
      },
      rotated: 'rotated-refresh',
    },
  ])('refreshes with $name using the real token grant', async ({ response, rotated }) => {
    const f = fixture();
    const config = await f.service.configuration(f.idp, 'synthetic-secret');
    f.fetcher.mockResolvedValue(Response.json(response));
    const before = Date.now();
    const result = await f.service.refresh(config, 'original-refresh', 'synthetic-sub');
    expect(result).toMatchObject({
      kind: 'refreshed',
      tokens: { accessToken: 'access', refreshToken: rotated },
    });
    if (result.kind !== 'refreshed') throw new Error('refresh failed');
    if ('expires_in' in response) {
      expect(result.tokens.accessTokenExpiresAt).toBeGreaterThanOrEqual(before + 120_000);
      expect(result.tokens.accessTokenExpiresAt).toBeLessThanOrEqual(Date.now() + 120_000);
    } else expect(result.tokens.accessTokenExpiresAt).toBeUndefined();
    expect(result.tokens.idToken).toBeUndefined();
    const request = f.fetcher.mock.calls.at(-1);
    const input = request?.[0];
    expect(
      input instanceof Request ? input.url : input instanceof URL ? input.href : input,
    ).toContain('/token');
    const body = request?.[1]?.body;
    expect(body instanceof URLSearchParams ? body.toString() : body).toContain(
      'grant_type=refresh_token',
    );
  });
  it.each([
    { status: 400, kind: 'revoked' },
    { status: 401, kind: 'revoked' },
    { status: 503, kind: 'unavailable' },
  ])('handles a provider refusing refresh with HTTP $status', async ({ status, kind }) => {
    const f = fixture();
    const config = await f.service.configuration(f.idp, 'synthetic-secret');
    f.fetcher.mockResolvedValue(Response.json({ error: 'invalid_grant' }, { status }));
    expect(await f.service.refresh(config, 'original-refresh', 'synthetic-sub')).toEqual({ kind });
  });
  it.each(['synthetic-sub', 'different-sub'])(
    'validates the subject of a refreshed ID token for %s',
    async (subject) => {
      const f = fixture();
      const config = await f.service.configuration(f.idp, 'synthetic-secret');
      const refreshKeys = await generateKeyPair('RS256');
      const idToken = await new SignJWT({ sub: subject })
        .setProtectedHeader({ alg: 'RS256', kid: 'refresh-key' })
        .setIssuer(issuer)
        .setAudience('synthetic-client')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(refreshKeys.privateKey);
      const publicKey = await exportJWK(refreshKeys.publicKey);
      f.fetcher.mockImplementation((input) =>
        Promise.resolve(
          Response.json(
            (input instanceof Request ? input.url : input.toString()).endsWith('/jwks')
              ? { keys: [{ ...publicKey, kid: 'refresh-key' }] }
              : { access_token: 'access', token_type: 'Bearer', id_token: idToken },
          ),
        ),
      );
      const result = await f.service.refresh(config, 'original-refresh', 'synthetic-sub');
      expect(result).toEqual(
        subject === 'synthetic-sub'
          ? {
              kind: 'refreshed',
              tokens: { accessToken: 'access', refreshToken: 'original-refresh', idToken },
            }
          : { kind: 'revoked' },
      );
    },
  );
  it('treats refresh transport and malformed token responses as temporary unavailability', async () => {
    const f = fixture();
    const config = await f.service.configuration(f.idp, 'synthetic-secret');
    f.fetcher.mockRejectedValueOnce(new Error('synthetic transport failure'));
    expect(await f.service.refresh(config, 'original-refresh', 'synthetic-sub')).toEqual({
      kind: 'unavailable',
    });
    f.fetcher.mockResolvedValueOnce(Response.json({ token_type: 'Bearer' }));
    expect(await f.service.refresh(config, 'original-refresh', 'synthetic-sub')).toEqual({
      kind: 'unavailable',
    });
  });
  it.each([
    {
      query: 'error=access_denied&state=state',
      responseError: false,
      reason: 'idp_error:access_denied',
    },
    {
      query: 'code=synthetic-code&state=state',
      responseError: true,
      reason: 'token_error:invalid_grant',
    },
    {
      query: 'code=synthetic-code&state=wrong-state',
      responseError: false,
      reason: 'token_validation_failed',
    },
  ])(
    'rejects failed authorization redemption: $reason',
    async ({ query, responseError, reason }) => {
      const f = fixture();
      const config = await f.service.configuration(f.idp, 'synthetic-secret');
      if (responseError)
        f.fetcher.mockResolvedValue(Response.json({ error: 'invalid_grant' }, { status: 400 }));
      await expect(
        f.service.redeem(config, new URL(`https://designer.test/callback?${query}`), {
          state: 'state',
          nonce: 'synthetic-nonce',
          codeVerifier: 'synthetic-verifier',
        }),
      ).rejects.toMatchObject({ reason });
    },
  );
  it('redeems a signed minimal ID token without inventing optional identity or token metadata', async () => {
    const f = fixture();
    const config = await f.service.configuration(f.idp, 'synthetic-secret');
    const loginKeys = await generateKeyPair('RS256');
    const idToken = await new SignJWT({ sub: 'synthetic-sub', nonce: 'synthetic-nonce' })
      .setProtectedHeader({ alg: 'RS256', kid: 'login-key' })
      .setIssuer(issuer)
      .setAudience('synthetic-client')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(loginKeys.privateKey);
    f.fetcher.mockResolvedValue(
      Response.json({ access_token: 'access', token_type: 'Bearer', id_token: idToken }),
    );
    const result = await f.service.redeem(
      config,
      new URL('https://designer.test/callback?code=synthetic-code&state=state'),
      {
        state: 'state',
        nonce: 'synthetic-nonce',
        codeVerifier: 'synthetic-verifier',
      },
    );
    expect(result).toMatchObject({
      subject: 'synthetic-sub',
      accessToken: 'access',
      idToken,
      claims: { nonce: 'synthetic-nonce' },
    });
    for (const optional of ['sid', 'accessTokenExpiresAt', 'refreshToken', 'amr', 'acr'])
      expect(result).not.toHaveProperty(optional);
  });
  it('preserves a JWKS transport failure instead of misclassifying it as an invalid logout signature', async () => {
    const f = fixture();
    const failure = new Error('synthetic JWKS transport failure');
    f.fetcher.mockRejectedValue(failure);
    await expect(f.service.verifyLogoutToken(f.idp, f.configuration, await token())).rejects.toBe(
      failure,
    );
  });
  it('turns discovery network failure into a safe unavailable response', async () => {
    const f = fixture();
    f.fetcher.mockRejectedValue(new Error('synthetic network detail'));
    await expect(f.service.configuration(f.idp, 'synthetic-secret')).rejects.toMatchObject({
      code: 'VERBIS_AUTH_IDP_UNAVAILABLE',
    });
  });
});
