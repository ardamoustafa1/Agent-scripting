import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { createTokenKit, type TokenKit } from '../../../test/support/tokens.js';

import { actorRef, InvalidTokenError, PrincipalVerifier } from './principal.js';

const TENANT = '01928f3a-0000-7000-8000-000000000001';
const USER = '01928f3a-0000-7000-8000-000000000101';

let kit: TokenKit;
let verifier: PrincipalVerifier;

beforeAll(async () => {
  kit = await createTokenKit();
  verifier = new PrincipalVerifier({
    jwks: PrincipalVerifier.parseJwks(kit.jwks),
    issuer: 'verbis-api-gateway',
    audience: 'verbis-api',
  });
});

describe('PrincipalVerifier', () => {
  it('accepts a valid user token', async () => {
    const principal = await verifier.verify(await kit.sign({ sub: USER, tnt: TENANT, sid: 's-1' }));
    expect(principal).toEqual({
      type: 'user',
      id: USER,
      tenantId: TENANT,
      scopes: [],
      sessionId: 's-1',
    });
    expect(actorRef(principal)).toBe(`user:${USER}`);
  });

  it('accepts service tokens with scopes', async () => {
    const principal = await verifier.verify(
      await kit.sign({ sub: 'connector-hub', tnt: TENANT, typ: 'service', scp: ['read:Session'] }),
    );
    expect(principal).toMatchObject({
      type: 'service',
      id: 'connector-hub',
      scopes: ['read:Session'],
    });
  });

  it.each<[string, () => Promise<string>]>([
    ['wrong audience', () => kit.sign({ sub: USER, tnt: TENANT }, { audience: 'other' })],
    ['wrong issuer', () => kit.sign({ sub: USER, tnt: TENANT }, { issuer: 'evil' })],
    [
      'expired',
      () => kit.sign({ sub: USER, tnt: TENANT }, { iat: Math.floor(Date.now() / 1000) - 3600 }),
    ],
    [
      'lifetime above 5 minutes',
      () => kit.sign({ sub: USER, tnt: TENANT }, { lifetimeSeconds: 3600 }),
    ],
    ['non-uuid tenant', () => kit.sign({ sub: USER, tnt: 'acme' })],
    ['non-uuid user subject', () => kit.sign({ sub: 'admin', tnt: TENANT })],
    [
      'bad scope format',
      () => kit.sign({ sub: 'svc', tnt: TENANT, typ: 'service', scp: ['everything'] }),
    ],
  ])('rejects %s', async (_label, token) => {
    await expect(verifier.verify(await token())).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('rejects tokens signed by an unknown key and HMAC/none algorithms', async () => {
    const other = await createTokenKit();
    await expect(
      verifier.verify(await other.sign({ sub: USER, tnt: TENANT })),
    ).rejects.toBeInstanceOf(InvalidTokenError);
    const hmac = await new SignJWT({ tnt: TENANT, typ: 'user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER)
      .setIssuer('verbis-api-gateway')
      .setAudience('verbis-api')
      .setIssuedAt()
      .setExpirationTime('1m')
      .setJti('j')
      .sign(new TextEncoder().encode('x'.repeat(32)));
    await expect(verifier.verify(hmac)).rejects.toBeInstanceOf(InvalidTokenError);
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: USER, tnt: TENANT })).toString('base64url')}.`;
    await expect(verifier.verify(none)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('honours an injected clock', async () => {
    const token = await kit.sign({ sub: USER, tnt: TENANT });
    const future = new PrincipalVerifier({
      jwks: PrincipalVerifier.parseJwks(kit.jwks),
      issuer: 'verbis-api-gateway',
      audience: 'verbis-api',
      now: () => Date.now() / 1000 + 3600,
    });
    await expect(future.verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });
});

describe('PrincipalVerifier.parseJwks', () => {
  it('rejects malformed sets and private keys', async () => {
    expect(() => PrincipalVerifier.parseJwks('{"keys":[]}')).toThrow(/at least one key/);
    expect(() => PrincipalVerifier.parseJwks('{}')).toThrow();
    const { privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
    const jwks = JSON.stringify({ keys: [await exportJWK(privateKey)] });
    expect(() => PrincipalVerifier.parseJwks(jwks)).toThrow(/public keys only/);
  });
});
