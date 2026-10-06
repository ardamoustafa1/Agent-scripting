import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CheckpointSigner,
  CheckpointVerifier,
  sessionHeadsDigest,
  type CheckpointPayload,
} from './checkpoint-signer.js';

function keyPair(kid: string) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privateJwk: JSON.stringify({ ...privateKey.export({ format: 'jwk' }), kid }),
    publicJwk: { ...publicKey.export({ format: 'jwk' }), kid },
  };
}

const payload: CheckpointPayload = {
  v: 1,
  id: '01J00000000000000000000000',
  tenantId: 't',
  seq: '42',
  hash: 'a'.repeat(64),
  sessionHeadsDigest: 'b'.repeat(64),
  sessionHeadsCount: 1,
  prevCheckpointId: null,
  signedAt: '2026-10-01T00:00:00.000Z',
};

describe('checkpoint signatures (Ed25519)', () => {
  it('signs and verifies; any payload change invalidates the signature', () => {
    const signer = CheckpointSigner.fromJwk(keyPair('k1').privateJwk);
    const signature = signer.sign(payload);
    expect(signer.verify(payload, 'k1', signature)).toBe(true);
    for (const change of [
      { seq: '43' },
      { hash: 'c'.repeat(64) },
      { tenantId: 'u' },
      { prevCheckpointId: 'x' },
    ]) {
      expect(signer.verify({ ...payload, ...change }, 'k1', signature)).toBe(false);
    }
    expect(signer.verify(payload, 'unknown', signature)).toBe(false);
    expect(signer.verify(payload, 'k1', 'garbage')).toBe(false);
  });

  it('verifies with published keys only (API side) and across rotation', () => {
    const old = keyPair('old');
    const current = keyPair('new');
    const oldSigner = CheckpointSigner.fromJwk(old.privateJwk);
    const oldSignature = oldSigner.sign(payload);
    const jwks = JSON.stringify({ keys: [old.publicJwk, current.publicJwk] });
    const newSigner = CheckpointSigner.fromJwk(current.privateJwk, jwks);
    expect(newSigner.verify(payload, 'old', oldSignature)).toBe(true);
    const verifier = CheckpointVerifier.fromJwks(jwks);
    expect(verifier.verify(payload, 'new', newSigner.sign(payload))).toBe(true);
    expect(
      verifier
        .jwks()
        .keys.map((k) => k.kid)
        .sort(),
    ).toEqual(['new', 'old']);
    expect(JSON.stringify(verifier.jwks())).not.toContain('"d"');
  });

  it('rejects non-Ed25519 or public-only signing keys', () => {
    expect(() => CheckpointSigner.fromJwk(JSON.stringify(keyPair('k').publicJwk))).toThrow();
    expect(() => CheckpointSigner.fromJwk('{"kty":"RSA"}')).toThrow();
  });

  it('session head digest is order independent and sensitive to every head', () => {
    const a = { sessionId: 's1', seq: 3, hash: 'x' };
    const b = { sessionId: 's2', seq: 1, hash: 'y' };
    expect(sessionHeadsDigest([a, b])).toBe(sessionHeadsDigest([b, a]));
    expect(sessionHeadsDigest([a, { ...b, seq: 2 }])).not.toBe(sessionHeadsDigest([a, b]));
  });
});
