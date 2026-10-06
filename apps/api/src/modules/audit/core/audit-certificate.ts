import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';

import { canonicalJson } from '../../../common/crypto/canonical-json.js';

import type { VerifyResult } from './chain-verifier.js';
import type { PublicJwk } from './checkpoint-signer.js';

/**
 * Customer-facing audit certificate: an Ed25519-signed statement that a tenant's hash chain was
 * verified over a sequence range, bound to the checkpoint hashes inside that range. Verifiable
 * offline with only the published JWKS (`scripts/verify-audit-certificate.mjs`).
 */
export interface AuditCertificateBody {
  readonly v: 1;
  readonly tenantId: string;
  readonly fromSeq: string;
  readonly toSeq: string;
  readonly eventCount: number;
  readonly anchor: { readonly seq: string; readonly source: 'genesis' | 'event' | 'checkpoint' };
  readonly lastHash: string;
  readonly chainValid: boolean;
  readonly breakCount: number;
  readonly checkpoints: readonly {
    readonly id: string;
    readonly seq: string;
    readonly hash: string;
  }[];
  readonly issuedAt: string;
}
export interface AuditCertificate {
  readonly body: AuditCertificateBody;
  readonly keyId: string;
  readonly signature: string;
}

export function certificateBody(
  tenantId: string,
  result: VerifyResult,
  checkpoints: readonly { id: string; seq: bigint; hash: string }[],
  issuedAt: Date,
): AuditCertificateBody {
  if (result.fromSeq === null || result.toSeq === null)
    throw new Error('AUDIT_CERTIFICATE_EMPTY_RANGE');
  return {
    v: 1,
    tenantId,
    fromSeq: result.fromSeq,
    toSeq: result.toSeq,
    eventCount: result.checked,
    anchor: { seq: result.anchor.seq, source: result.anchor.source },
    lastHash: result.lastHash,
    chainValid: result.valid,
    breakCount: result.breaks.length,
    checkpoints: checkpoints
      .map((c) => ({ id: c.id, seq: c.seq.toString(), hash: c.hash }))
      .sort((a, b) => (BigInt(a.seq) < BigInt(b.seq) ? -1 : 1)),
    issuedAt: issuedAt.toISOString(),
  };
}
const message = (body: AuditCertificateBody) => Buffer.from(canonicalJson(body), 'utf8');

export function signCertificate(
  body: AuditCertificateBody,
  keyId: string,
  privateJwk: string,
): AuditCertificate {
  const key: KeyObject = createPrivateKey({
    key: JSON.parse(privateJwk) as JsonWebKey,
    format: 'jwk',
  });
  return { body, keyId, signature: sign(null, message(body), key).toString('base64url') };
}
/** True only if the signature is valid AND the body is internally consistent and attests validity. */
export function verifyCertificate(cert: AuditCertificate, jwks: { keys: PublicJwk[] }): boolean {
  const jwk = jwks.keys.find((k) => k.kid === cert.keyId);
  if (!jwk) return false;
  try {
    const b = cert.body;
    if (
      !verify(
        null,
        message(b),
        createPublicKey({ key: jwk, format: 'jwk' }),
        Buffer.from(cert.signature, 'base64url'),
      )
    )
      return false;
    return (
      b.chainValid &&
      b.breakCount === 0 &&
      BigInt(b.toSeq) >= BigInt(b.fromSeq) &&
      b.eventCount === Number(BigInt(b.toSeq) - BigInt(b.fromSeq) + 1n) &&
      b.checkpoints.every(
        (c) => BigInt(c.seq) >= BigInt(b.fromSeq) && BigInt(c.seq) <= BigInt(b.toSeq),
      )
    );
  } catch {
    return false;
  }
}
