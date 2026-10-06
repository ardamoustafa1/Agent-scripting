import { describe, expect, it } from 'vitest';

import { validateRows } from './attached-data-api.js';

const row = {
  key: 'CustomerId',
  variable: 'customerId',
  type: 'string' as const,
  writeBack: false,
  pii: false,
};

describe('attached data rows', () => {
  it('accepts valid unique rows and flags invalid or duplicate ones', () => {
    expect(validateRows([row, { ...row, key: 'Segment', variable: 'segment' }])).toBe('ok');
    expect(validateRows([{ ...row, variable: 'has space' }])).toBe('invalid');
    expect(validateRows([row, { ...row, variable: 'other' }])).toBe('duplicate');
    expect(validateRows([row, { ...row, key: 'Other' }])).toBe('duplicate');
  });
});
