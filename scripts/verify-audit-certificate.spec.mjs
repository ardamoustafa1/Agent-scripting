import { generateKeyPairSync, sign } from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { verifyCertificate } from './verify-audit-certificate.mjs';

const pair = generateKeyPairSync('ed25519');
const jwks = { keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'k' }] };
const body = {
  v: 1,
  tenantId: 't',
  fromSeq: '1',
  toSeq: '3',
  eventCount: 3,
  chainValid: true,
  breakCount: 0,
  anchor: { seq: '0', source: 'genesis' },
  lastHash: 'a',
  checkpoints: [],
  issuedAt: '2026-10-06T00:00:00.000Z',
};
const issue = (b) => ({
  body: b,
  keyId: 'k',
  signature: sign(
    null,
    Buffer.from(
      JSON.stringify(
        Object.fromEntries(
          Object.entries({ ...b, anchor: b.anchor })
            .sort(([x], [y]) => (x < y ? -1 : 1))
            .map(([k, v]) => [k, k === 'anchor' ? { seq: v.seq, source: v.source } : v]),
        ),
      ),
      'utf8',
    ),
    pair.privateKey,
  ).toString('base64url'),
});
describe('verify-audit-certificate', () => {
  it('accepts a valid certificate and rejects a modified one', () => {
    const cert = issue(body);
    assert.deepEqual(verifyCertificate(cert, jwks), { ok: true, reason: 'valid' });
    const tampered = { ...cert, body: { ...body, toSeq: '4' } };
    assert.equal(verifyCertificate(tampered, jwks).reason, 'bad-signature');
    assert.equal(verifyCertificate({ ...cert, keyId: 'x' }, jwks).reason, 'unknown-key');
    assert.equal(verifyCertificate(null, jwks).reason, 'malformed');
  });
  it('rejects a signed certificate that attests a broken chain', () => {
    const broken = issue({ ...body, chainValid: false, breakCount: 1 });
    assert.equal(verifyCertificate(broken, jwks).reason, 'chain-not-valid');
  });
});
