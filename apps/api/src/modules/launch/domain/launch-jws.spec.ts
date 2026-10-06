import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JSONWebKeySet } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { launchAudience, peekIssuer, PublicJwksSchema, verifyLaunchJws } from './launch-jws.js';
import { LaunchDeniedError } from './launch.js';

const tenantId = '0190f000-0000-7000-8000-000000000001';
const agentId = '0190f000-0000-7000-8000-000000000002';
const interactionId = '0190f000-0000-7000-8000-000000000003';
const now = new Date('2026-10-01T10:00:00.000Z');
const nowS = Math.floor(now.getTime() / 1000);

let key: CryptoKey, rotated: CryptoKey, other: CryptoKey, jwks: JSONWebKeySet;

beforeAll(async () => {
  const k1 = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
  const k2 = await generateKeyPair('ES256');
  const k3 = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
  key = k1.privateKey;
  rotated = k2.privateKey;
  other = k3.privateKey;
  jwks = {
    keys: [
      { ...(await exportJWK(k1.publicKey)), kid: 'k1', alg: 'EdDSA' },
      { ...(await exportJWK(k2.publicKey)), kid: 'k2', alg: 'ES256' },
    ],
  };
});

function sign(
  overrides: {
    iat?: number;
    exp?: number;
    aud?: string;
    iss?: string;
    kid?: string;
    alg?: string;
    jti?: string;
    agentId?: string;
  } = {},
  signer: CryptoKey = key,
) {
  const iat = overrides.iat ?? nowS;
  return new SignJWT({ agentId: overrides.agentId ?? agentId, interactionId })
    .setProtectedHeader({ alg: overrides.alg ?? 'EdDSA', kid: overrides.kid ?? 'k1' })
    .setIssuer(overrides.iss ?? 'crm')
    .setAudience(overrides.aud ?? launchAudience(tenantId))
    .setIssuedAt(iat)
    .setExpirationTime(overrides.exp ?? iat + 30)
    .setJti(overrides.jti ?? 'jti-0123456789abcdef')
    .sign(signer);
}

const verify = (token: string) => verifyLaunchJws(token, { jwks, issuer: 'crm', tenantId, now });

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'accepted';
  } catch (error) {
    return error instanceof LaunchDeniedError ? error.reason : 'other';
  }
}

describe('verifyLaunchJws', () => {
  it('accepts a valid token and any key in the rotation window', async () => {
    await expect(verify(await sign())).resolves.toMatchObject({
      agentId,
      interactionId,
      iss: 'crm',
    });
    await expect(verify(await sign({ kid: 'k2', alg: 'ES256' }, rotated))).resolves.toMatchObject({
      agentId,
    });
  });

  it('refuses tampering, foreign keys and unknown kids', async () => {
    const token = await sign();
    const [h, p, s] = token.split('.') as [string, string, string];
    const body = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>;
    const forged = Buffer.from(JSON.stringify({ ...body, agentId: interactionId })).toString(
      'base64url',
    );
    expect(await reason(verify(`${h}.${forged}.${s}`))).toBe('token_signature');
    expect(await reason(verify(await sign({}, other)))).toBe('token_signature');
    expect(await reason(verify(await sign({ kid: 'nope' })))).toBe('token_signature');
  });

  it('refuses alg none and HMAC (no algorithm negotiation)', async () => {
    const [, p] = (await sign()).split('.') as [string, string];
    const none = `${Buffer.from('{"alg":"none","kid":"k1"}').toString('base64url')}.${p}.`;
    expect(await reason(verify(none))).toBe('token_invalid');
    expect(() => peekIssuer(none)).toThrow(LaunchDeniedError);
    const hs = await new SignJWT({ agentId, interactionId })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setIssuer('crm')
      .setAudience(launchAudience(tenantId))
      .setIssuedAt(nowS)
      .setExpirationTime(nowS + 30)
      .setJti('jti-0123456789abcdef')
      .sign(new TextEncoder().encode('x'.repeat(32)));
    expect(await reason(verify(hs))).not.toBe('accepted');
    expect(() => peekIssuer(hs)).toThrow(LaunchDeniedError);
  });

  it('refuses wrong audience/tenant, wrong issuer, long lifetime, expiry and future tokens', async () => {
    expect(await reason(verify(await sign({ aud: launchAudience('another-tenant') })))).toBe(
      'token_audience',
    );
    expect(await reason(verify(await sign({ iss: 'someone-else' })))).toBe('token_invalid');
    expect(await reason(verify(await sign({ exp: nowS + 600 })))).toBe('token_lifetime');
    expect(await reason(verify(await sign({ iat: nowS - 120, exp: nowS - 60 })))).toBe(
      'code_expired',
    );
    expect(await reason(verify(await sign({ iat: nowS + 120, exp: nowS + 150 })))).not.toBe(
      'accepted',
    );
  });

  it('refuses malformed claims', async () => {
    expect(await reason(verify(await sign({ agentId: 'not-a-uuid' })))).toBe('token_invalid');
    expect(await reason(verify(await sign({ jti: 'short' })))).toBe('token_invalid');
    expect(await reason(verify('a.b.c'))).toBe('token_invalid');
  });
});

describe('peekIssuer and PublicJwksSchema', () => {
  it('reads iss from a well-formed token only', async () => {
    expect(peekIssuer(await sign())).toBe('crm');
    expect(() => peekIssuer('garbage')).toThrow(LaunchDeniedError);
  });

  it('rejects private key material and empty sets', () => {
    expect(PublicJwksSchema.safeParse(jwks).success).toBe(true);
    expect(PublicJwksSchema.safeParse({ keys: [] }).success).toBe(false);
    expect(
      PublicJwksSchema.safeParse({ keys: [{ kty: 'OKP', kid: 'x', d: 'secret' }] }).success,
    ).toBe(false);
    expect(
      PublicJwksSchema.safeParse({ keys: [{ kty: 'oct', kid: 'x', k: 'secret' }] }).success,
    ).toBe(false);
  });
});
