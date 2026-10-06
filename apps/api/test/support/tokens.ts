import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';

/** Test key material and token minting (mirrors what the BFF does in step 7). */
export interface TokenKit {
  readonly jwks: string;
  sign(
    claims: Partial<JWTPayload> & {
      sub: string;
      tnt: string;
      typ?: 'user' | 'service';
      scp?: string[];
    },
    options?: { lifetimeSeconds?: number; issuer?: string; audience?: string; iat?: number },
  ): Promise<string>;
}

export async function createTokenKit(): Promise<TokenKit> {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'EdDSA' };
  return {
    jwks: JSON.stringify({ keys: [jwk] }),
    async sign(claims, options = {}) {
      const iat = options.iat ?? Math.floor(Date.now() / 1000);
      return new SignJWT({ typ: 'user', ...claims })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' })
        .setIssuer(options.issuer ?? 'verbis-api-gateway')
        .setAudience(options.audience ?? 'verbis-api')
        .setIssuedAt(iat)
        .setExpirationTime(iat + (options.lifetimeSeconds ?? 300))
        .setJti(crypto.randomUUID())
        .sign(privateKey);
    },
  };
}
