import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { securityPropertyOptions } from '@verbis/test-utils';

import { GENESIS_HASH, recomputeHash, type StoredAuditRow } from './audit-event.js';
import { ChainVerifier, GENESIS_ANCHOR } from './chain-verifier.js';

const TENANT = '0199a000-0000-7000-8000-000000000001';

/** A valid chain of n rows built exactly like the writer does. */
export function buildChain(n: number, tenantId = TENANT): StoredAuditRow[] {
  const rows: StoredAuditRow[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i += 1) {
    const base: StoredAuditRow = {
      id: `01J${String(i).padStart(23, '0')}`,
      tenantId,
      seq: BigInt(i),
      hashVersion: 2,
      action: i % 2 === 0 ? 'campaign.campaign.updated' : 'script.published',
      actorType: 'user',
      actorId: `u-${String(i % 3)}`,
      actor: { ip: '10.0.0.1' },
      targetType: 'Campaign',
      targetId: `c-${String(i)}`,
      targetName: null,
      outcome: 'success',
      reason: null,
      diff: { mode: 'patch', ops: [{ op: 'replace', path: '/name', value: `n${String(i)}` }] },
      correlationId: `corr-${String(i)}`,
      interactionId: null,
      metadata: {},
      occurredAt: new Date(1_790_000_000_000 + i),
      recordedAt: new Date(1_790_000_000_000 + i),
      prevHash: prev,
      hash: '',
    };
    const hash = recomputeHash(base);
    rows.push({ ...base, hash });
    prev = hash;
  }
  return rows;
}

function verify(rows: readonly StoredAuditRow[], expectedLast?: bigint) {
  const verifier = new ChainVerifier(TENANT, GENESIS_ANCHOR);
  verifier.push(rows);
  return verifier.result(expectedLast);
}

describe('ChainVerifier — tamper detection', () => {
  it('accepts an intact chain (in any batch size)', () => {
    const rows = buildChain(50);
    const verifier = new ChainVerifier(TENANT, GENESIS_ANCHOR);
    for (let i = 0; i < rows.length; i += 7) verifier.push(rows.slice(i, i + 7));
    const result = verifier.result(50n);
    expect(result).toMatchObject({
      valid: true,
      checked: 50,
      fromSeq: '1',
      toSeq: '50',
      breaks: [],
    });
    expect(result.lastHash).toBe(rows[49]?.hash);
  });

  it('detects modified content (hash mismatch at that seq only)', () => {
    const rows = buildChain(10);
    rows[4] = { ...rows[4]!, targetName: 'tampered' };
    const result = verify(rows);
    expect(result.valid).toBe(false);
    expect(result.breaks).toEqual([expect.objectContaining({ kind: 'hash_mismatch', seq: '5' })]);
  });

  it('detects a recomputed hash (attacker rewrites one row consistently) as a broken link', () => {
    const rows = buildChain(10);
    const forged = { ...rows[4]!, targetName: 'tampered' };
    rows[4] = { ...forged, hash: recomputeHash(forged) };
    const result = verify(rows);
    expect(result.breaks).toEqual([expect.objectContaining({ kind: 'link_mismatch', seq: '6' })]);
  });

  it('detects a deleted row (sequence gap + broken link)', () => {
    const rows = buildChain(10);
    rows.splice(3, 1);
    const kinds = verify(rows).breaks.map((b) => `${b.kind}@${b.seq}`);
    expect(kinds).toEqual(['sequence_gap@5', 'link_mismatch@5']);
  });

  it('detects a truncated tail against the known head', () => {
    const result = verify(buildChain(10).slice(0, 8), 10n);
    expect(result.breaks).toEqual([
      expect.objectContaining({ kind: 'sequence_gap', seq: '9', expected: '10' }),
    ]);
  });

  it('detects reordering and duplication', () => {
    const rows = buildChain(6);
    const swapped = [rows[0]!, rows[2]!, rows[1]!, ...rows.slice(3)];
    expect(verify(swapped).valid).toBe(false);
    const duplicated = [...rows.slice(0, 3), rows[2]!, ...rows.slice(3)];
    expect(verify(duplicated).breaks.some((b) => b.kind === 'sequence_gap')).toBe(true);
  });

  it('detects an inserted forged row', () => {
    const rows = buildChain(6);
    const forged = { ...rows[2]!, id: 'forged', targetId: 'evil' };
    expect(
      verify([...rows.slice(0, 3), { ...forged, hash: recomputeHash(forged) }, ...rows.slice(3)])
        .valid,
    ).toBe(false);
  });

  it('detects rows of another tenant', () => {
    const rows = buildChain(3);
    rows[1] = { ...rows[1]!, tenantId: '0199a000-0000-7000-8000-000000000009' };
    expect(verify(rows).breaks.map((b) => b.kind)).toContain('tenant_mismatch');
  });

  it('a fully rewritten chain is caught by a signed checkpoint', () => {
    const genuine = buildChain(10);
    // The attacker changes event 1 and re-hashes the whole chain: internally consistent…
    const alt = buildChain(10);
    alt[0] = { ...alt[0]!, targetId: 'rewritten' };
    let prev = GENESIS_HASH;
    const rewritten = alt.map((row) => {
      const next = { ...row, prevHash: prev };
      const hash = recomputeHash(next);
      prev = hash;
      return { ...next, hash };
    });
    expect(verify(rewritten).valid).toBe(true);
    // …but it no longer matches the signed checkpoint.
    const verifier = new ChainVerifier(TENANT, GENESIS_ANCHOR, [
      { id: 'cp-1', seq: 10n, hash: genuine[9]!.hash, signatureValid: true },
    ]);
    verifier.push(rewritten);
    expect(verifier.result().breaks).toEqual([
      expect.objectContaining({ kind: 'checkpoint_mismatch', seq: '10' }),
    ]);
  });

  it('reports invalid checkpoint signatures', () => {
    const rows = buildChain(4);
    const verifier = new ChainVerifier(TENANT, GENESIS_ANCHOR, [
      { id: 'cp', seq: 2n, hash: rows[1]!.hash, signatureValid: false },
    ]);
    verifier.push(rows);
    expect(verifier.result().breaks).toEqual([
      expect.objectContaining({ kind: 'checkpoint_signature_invalid', seq: '2' }),
    ]);
  });

  it('verifies a range from an event or checkpoint anchor', () => {
    const rows = buildChain(20);
    const verifier = new ChainVerifier(TENANT, {
      seq: 10n,
      hash: rows[9]!.hash,
      source: 'checkpoint',
    });
    verifier.push(rows.slice(10));
    expect(verifier.result(20n)).toMatchObject({
      valid: true,
      checked: 10,
      fromSeq: '11',
      anchor: { seq: '10', source: 'checkpoint' },
    });
    const wrong = new ChainVerifier(TENANT, { seq: 10n, hash: 'f'.repeat(64), source: 'event' });
    wrong.push(rows.slice(10));
    expect(wrong.result().breaks[0]).toMatchObject({ kind: 'link_mismatch', seq: '11' });
  });

  it('reports a missing anchor and a tampered anchor', () => {
    const verifier = new ChainVerifier(TENANT, { seq: 4n, hash: '', source: 'checkpoint' });
    verifier.anchorMissing(4n);
    verifier.anchorTampered(4n, 'hash_mismatch', 'a', 'b');
    expect(verifier.result().breaks.map((b) => b.kind)).toEqual([
      'anchor_missing',
      'hash_mismatch',
    ]);
  });

  it('caps the number of reported breaks', () => {
    const rows = buildChain(30).map((row) => ({ ...row, targetName: 'x' }));
    const verifier = new ChainVerifier(TENANT, GENESIS_ANCHOR, [], 5);
    verifier.push(rows);
    const result = verifier.result();
    expect(result.breaks).toHaveLength(5);
    expect(result.truncated).toBe(true);
    expect(result.valid).toBe(false);
  });

  it('property: any single-field tampering of any row is detected and located', () => {
    const rows = buildChain(25);
    const fields = [
      'action',
      'actorId',
      'targetId',
      'correlationId',
      'outcome',
      'reason',
      'metadata',
      'diff',
    ] as const;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 24 }),
        fc.constantFrom(...fields),
        fc.string({ minLength: 1, maxLength: 8 }),
        (index, field, value) => {
          const tampered = rows.map((row) => ({ ...row }));
          const target = tampered[index]!;
          const replacement: unknown =
            field === 'metadata' || field === 'diff'
              ? { v: value }
              : field === 'outcome'
                ? target.outcome === 'success'
                  ? 'denied'
                  : 'success'
                : `${String(target[field])}${value}`;
          tampered[index] = { ...target, [field]: replacement };
          const result = verify(tampered);
          expect(result.valid).toBe(false);
          expect(result.breaks[0]?.seq).toBe(String(index + 1));
        },
      ),
      securityPropertyOptions(20261001),
    );
  });

  it('property: deleting any non-empty subset of rows is detected', () => {
    const rows = buildChain(20);
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 19 }), { minLength: 1, maxLength: 19 }),
        (indexes) => {
          const kept = rows.filter((_r, i) => !indexes.includes(i));
          expect(verify(kept, 20n).valid).toBe(false);
        },
      ),
      securityPropertyOptions(42),
    );
  });
});
