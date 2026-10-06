import { describe, expect, it } from 'vitest';

import { tokenHash, writableLease } from './runtime-engine.service.js';

const claim = { tabId: '01900000-0000-7000-8000-000000000001', writeToken: 'a'.repeat(43) };
const bffId = '01900000-0000-7000-8000-000000000002';
const row = {
  writerHash: tokenHash(claim.writeToken),
  writerTabId: claim.tabId,
  writerBffId: bffId,
  writerUntil: new Date(60_000),
};
describe('writer fencing across browser tabs', () => {
  it('lets only the original authenticated tab renew/write', () => {
    expect(writableLease(row, claim, bffId, 59_999)).toBe(true);
    expect(
      writableLease(row, { ...claim, tabId: '01900000-0000-7000-8000-000000000003' }, bffId, 1),
    ).toBe(false);
    expect(writableLease(row, claim, '01900000-0000-7000-8000-000000000004', 1)).toBe(false);
    expect(writableLease(row, { ...claim, writeToken: 'b'.repeat(43) }, bffId, 1)).toBe(false);
  });
  it('rejects expired and released leases including the exact expiry boundary', () => {
    expect(writableLease(row, claim, bffId, 60_000)).toBe(false);
    expect(writableLease({ ...row, writerUntil: null }, claim, bffId, 1)).toBe(false);
    expect(writableLease({ ...row, writerHash: null }, claim, bffId, 1)).toBe(false);
  });
});
