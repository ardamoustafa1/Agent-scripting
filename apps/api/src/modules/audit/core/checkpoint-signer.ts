import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

import { z } from 'zod';

import { canonicalJson, sha256Hex } from '../../../common/crypto/canonical-json.js';

/** What a checkpoint attests (canonical JSON of this object is signed with Ed25519). */
export interface CheckpointPayload {
  readonly v: 1;
  readonly id: string;
  readonly tenantId: string;
  readonly seq: string;
  readonly hash: string;
  readonly sessionHeadsDigest: string;
  readonly sessionHeadsCount: number;
  readonly prevCheckpointId: string | null;
  readonly signedAt: string;
}

const OkpPrivateJwk = z.object({
  kty: z.literal('OKP'),
  crv: z.literal('Ed25519'),
  kid: z.string().min(1).max(64),
  x: z.string().min(1),
  d: z.string().min(1),
});
const OkpPublicJwk = z.object({
  kty: z.literal('OKP'),
  crv: z.literal('Ed25519'),
  kid: z.string().min(1).max(64),
  x: z.string().min(1),
});
const Jwks = z.object({ keys: z.array(OkpPublicJwk).min(1) });

export type PublicJwk = z.infer<typeof OkpPublicJwk>;

export function checkpointMessage(payload: CheckpointPayload): Buffer {
  return Buffer.from(canonicalJson(payload), 'utf8');
}

/** Verifies checkpoint signatures against the published keys (current and retired). */
export class CheckpointVerifier {
  readonly #publicKeys: Map<string, KeyObject>;
  readonly #publicJwks: PublicJwk[];

  protected constructor(publicJwks: PublicJwk[]) {
    this.#publicJwks = publicJwks;
    this.#publicKeys = new Map(
      publicJwks.map((jwk) => [jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })]),
    );
  }

  static fromJwks(jwks: string): CheckpointVerifier {
    return new CheckpointVerifier(Jwks.parse(JSON.parse(jwks)).keys);
  }

  verify(payload: CheckpointPayload, keyId: string, signature: string): boolean {
    const key = this.#publicKeys.get(keyId);
    if (key === undefined) return false;
    try {
      return verify(null, checkpointMessage(payload), key, Buffer.from(signature, 'base64url'));
    } catch {
      return false;
    }
  }

  /** Published verification keys (`GET /v1/audit-checkpoints/keys`) for offline verifiers. */
  jwks(): { keys: PublicJwk[] } {
    return { keys: [...this.#publicJwks] };
  }
}

/** Signs with the current key; verifies against every published key (rotation-safe). */
export class CheckpointSigner extends CheckpointVerifier {
  readonly keyId: string;
  readonly #privateKey: KeyObject;

  private constructor(keyId: string, privateKey: KeyObject, publicJwks: PublicJwk[]) {
    super(publicJwks);
    this.keyId = keyId;
    this.#privateKey = privateKey;
  }

  /**
   * `signingJwk`: private OKP/Ed25519 JWK. `verificationJwks`: published keys (current and
   * retired); the signing key's public half is always included.
   */
  static fromJwk(signingJwk: string, verificationJwks?: string): CheckpointSigner {
    const priv = OkpPrivateJwk.parse(JSON.parse(signingJwk));
    const own: PublicJwk = { kty: 'OKP', crv: 'Ed25519', kid: priv.kid, x: priv.x };
    const extra =
      verificationJwks === undefined ? [] : Jwks.parse(JSON.parse(verificationJwks)).keys;
    const keys = [own, ...extra.filter((k) => k.kid !== own.kid)];
    return new CheckpointSigner(priv.kid, createPrivateKey({ key: priv, format: 'jwk' }), keys);
  }

  sign(payload: CheckpointPayload): string {
    return sign(null, checkpointMessage(payload), this.#privateKey).toString('base64url');
  }
}

/** Order-independent digest of session chain heads: sha256 over sorted `sessionId:seq:hash` lines. */
export function sessionHeadsDigest(
  heads: readonly { sessionId: string; seq: number; hash: string }[],
): string {
  const lines = heads
    .map((h) => `${h.sessionId}:${String(h.seq)}:${h.hash}`)
    .sort()
    .join('\n');
  return sha256Hex(lines);
}
