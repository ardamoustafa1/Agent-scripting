import { describe, expect, it } from 'vitest';

import { GENESIS_HASH } from '../core/audit-event.js';

import { hashSessionEvent, verifySessionChain, type StoredSessionRow } from './session-chain.js';

const SESSION = '0199a000-0000-7000-8000-0000000000aa';

function chain(n: number): StoredSessionRow[] {
  const rows: StoredSessionRow[] = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq += 1) {
    const base = {
      id: `0199a000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
      tenantId: 't',
      sessionId: SESSION,
      seq,
      type: seq === 1 ? 'page.entered' : 'field.changed',
      payload: { field: `f${String(seq)}`, value: '[REDACTED]' },
      actorId: 'agent-1',
      pageId: 'p-1',
      occurredAt: new Date(1_790_000_000_000 + seq),
      recordedAt: new Date(1_790_000_000_000 + seq),
      createdBy: 'user:agent-1',
      prevHash: prev,
    };
    const hash = hashSessionEvent({
      ...base,
      occurredAt: base.occurredAt.toISOString(),
      recordedAt: base.recordedAt.toISOString(),
    });
    rows.push({ ...base, hash });
    prev = hash;
  }
  return rows;
}

describe('session event chain', () => {
  it('verifies an intact session and its sealed head', () => {
    const rows = chain(5);
    expect(verifySessionChain(SESSION, rows, { seq: 5, hash: rows[4]!.hash })).toMatchObject({
      valid: true,
      checked: 5,
      lastSeq: 5,
    });
  });

  it('detects edited input, deleted events, foreign events and a moved seal', () => {
    const edited = chain(5);
    edited[2] = { ...edited[2]!, payload: { field: 'f3', value: 'changed' } };
    expect(verifySessionChain(SESSION, edited).breaks[0]).toMatchObject({
      kind: 'hash_mismatch',
      seq: '3',
    });

    const deleted = chain(5);
    deleted.splice(1, 1);
    expect(verifySessionChain(SESSION, deleted).breaks.map((b) => b.kind)).toEqual([
      'sequence_gap',
      'link_mismatch',
    ]);

    const foreign = chain(3);
    foreign[1] = { ...foreign[1]!, sessionId: 'other' };
    expect(verifySessionChain(SESSION, foreign).valid).toBe(false);

    const rows = chain(5);
    expect(
      verifySessionChain(SESSION, rows.slice(0, 4), { seq: 5, hash: rows[4]!.hash }).breaks[0]
        ?.kind,
    ).toBe('checkpoint_mismatch');
  });

  it('who entered what on which page is part of the hash', () => {
    const rows = chain(2);
    for (const change of [{ actorId: 'agent-2' }, { pageId: 'p-2' }, { type: 'field.cleared' }]) {
      const tampered = [rows[0]!, { ...rows[1]!, ...change }];
      expect(verifySessionChain(SESSION, tampered).valid).toBe(false);
    }
  });
});
