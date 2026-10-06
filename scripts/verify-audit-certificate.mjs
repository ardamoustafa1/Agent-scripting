#!/usr/bin/env node
// Independent verifier for Verbis audit certificates: no Verbis code, only node:crypto.
// Usage: node scripts/verify-audit-certificate.mjs <certificate.json> <jwks.json>
import { createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function normalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : normalize(v)));
  const out = {};
  for (const key of Object.keys(value).sort())
    if (value[key] !== undefined) out[key] = normalize(value[key]);
  return out;
}
export function verifyCertificate(cert, jwks) {
  try {
    const jwk = jwks.keys.find((k) => k.kid === cert.keyId);
    if (!jwk) return { ok: false, reason: 'unknown-key' };
    const b = cert.body;
    const signed = verify(
      null,
      Buffer.from(JSON.stringify(normalize(b)), 'utf8'),
      createPublicKey({ key: jwk, format: 'jwk' }),
      Buffer.from(cert.signature, 'base64url'),
    );
    if (!signed) return { ok: false, reason: 'bad-signature' };
    const span = BigInt(b.toSeq) - BigInt(b.fromSeq) + 1n;
    if (!b.chainValid || b.breakCount !== 0) return { ok: false, reason: 'chain-not-valid' };
    if (span < 1n || BigInt(b.eventCount) !== span)
      return { ok: false, reason: 'inconsistent-range' };
    if (
      !b.checkpoints.every(
        (checkpoint) =>
          BigInt(checkpoint.seq) >= BigInt(b.fromSeq) && BigInt(checkpoint.seq) <= BigInt(b.toSeq),
      )
    )
      return { ok: false, reason: 'inconsistent-range' };
    return { ok: true, reason: 'valid' };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [certPath, jwksPath] = process.argv.slice(2);
  if (!certPath || !jwksPath) {
    console.error('usage: verify-audit-certificate.mjs <certificate.json> <jwks.json>');
    process.exit(2);
  }
  const result = verifyCertificate(
    JSON.parse(readFileSync(certPath, 'utf8')),
    JSON.parse(readFileSync(jwksPath, 'utf8')),
  );
  console.log(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}
