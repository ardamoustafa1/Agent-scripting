import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  certificateBody,
  signCertificate,
  verifyCertificate,
  type AuditCertificate,
} from './audit-certificate.js';

import type { VerifyResult } from './chain-verifier.js';

const pair = generateKeyPairSync('ed25519');
const privateJwk = JSON.stringify({ ...pair.privateKey.export({ format: 'jwk' }), kid: 'k1' });
const jwks = { keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'k1' }] } as never;
const result: VerifyResult = {
  valid: true,
  checked: 10,
  fromSeq: '5',
  toSeq: '14',
  anchor: { seq: '4', source: 'event' },
  lastHash: 'a'.repeat(64),
  checkpointsChecked: 1,
  breaks: [],
  truncated: false,
};
const issue = (r = result) =>
  signCertificate(
    certificateBody(
      'tenant-1',
      r,
      [{ id: 'c1', seq: 14n, hash: 'a'.repeat(64) }],
      new Date('2026-10-06T00:00:00Z'),
    ),
    'k1',
    privateJwk,
  );

describe('audit certificate', () => {
  it('verifies an untouched certificate', () => {
    expect(verifyCertificate(issue(), jwks)).toBe(true);
  });
  it('rejects every modified field, a foreign key and a wrong key id', () => {
    const cert = issue();
    const mutate = (patch: Partial<AuditCertificate['body']>): AuditCertificate => ({
      ...cert,
      body: { ...cert.body, ...patch },
    });
    for (const patch of [
      { tenantId: 'tenant-2' },
      { toSeq: '15' },
      { lastHash: 'b'.repeat(64) },
      { chainValid: false },
      { eventCount: 11 },
      { issuedAt: '2027-01-01T00:00:00.000Z' },
    ])
      expect(verifyCertificate(mutate(patch), jwks)).toBe(false);
    expect(verifyCertificate({ ...cert, keyId: 'other' }, jwks)).toBe(false);
    const other = generateKeyPairSync('ed25519');
    expect(
      verifyCertificate(cert, {
        keys: [{ ...other.publicKey.export({ format: 'jwk' }), kid: 'k1' }],
      } as never),
    ).toBe(false);
    expect(verifyCertificate({ ...cert, signature: 'garbage' }, jwks)).toBe(false);
  });
  it('refuses an empty range and never certifies a broken chain', () => {
    expect(() =>
      certificateBody('t', { ...result, fromSeq: null, toSeq: null }, [], new Date()),
    ).toThrow();
    const broken = issue({
      ...result,
      valid: false,
      breaks: [{ kind: 'hash_mismatch', seq: '7' }],
    });
    expect(verifyCertificate(broken, jwks)).toBe(false);
  });
});
