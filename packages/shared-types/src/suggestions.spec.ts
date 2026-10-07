import { describe, expect, it } from 'vitest';

import { SuggestionInputSchema } from './suggestions.js';

describe('SuggestionInputSchema', () => {
  const ok = {
    title: ' Rename page ',
    operations: [{ op: 'replace', path: '/pages/0/name', value: 'A' }],
  };
  it('accepts add/replace/remove and trims the title', () => {
    expect(SuggestionInputSchema.parse(ok).title).toBe('Rename page');
    expect(
      SuggestionInputSchema.safeParse({
        title: 't',
        operations: [{ op: 'remove', path: '/rules/1' }],
      }).success,
    ).toBe(true);
  });
  it('rejects unsupported operations, bad pointers, empty and oversized lists, unknown fields', () => {
    const bad = (value: unknown) => SuggestionInputSchema.safeParse(value).success;
    expect(bad({ ...ok, operations: [{ op: 'move', from: '/a', path: '/b' }] })).toBe(false);
    expect(bad({ ...ok, operations: [{ op: 'remove', path: 'pages/0' }] })).toBe(false);
    expect(bad({ ...ok, operations: [] })).toBe(false);
    expect(
      bad({ ...ok, operations: Array.from({ length: 201 }, () => ({ op: 'remove', path: '/a' })) }),
    ).toBe(false);
    expect(bad({ ...ok, title: ' ' })).toBe(false);
    expect(bad({ ...ok, extra: 1 })).toBe(false);
    expect(bad({ ...ok, operations: [{ op: 'replace', path: '/a' }] })).toBe(false);
  });
});
