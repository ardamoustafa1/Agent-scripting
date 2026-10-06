import { describe, expect, it } from 'vitest';

import { applyJsonPatch, JsonPatchError } from './json-patch.js';

describe('atomic patch and array boundary regressions', () => {
  it.each(['-1', '01', '1.0', '2', '-'])('rejects invalid replacement index %s', (index) => {
    const original = { values: ['first', 'second'] };
    expect(() =>
      applyJsonPatch(original, [{ op: 'replace', path: `/values/${index}`, value: 'changed' }]),
    ).toThrow(JsonPatchError);
    expect(original).toEqual({ values: ['first', 'second'] });
  });
  it('permits append at length and rejects removal at length', () => {
    const original = { values: ['first'] };
    expect(applyJsonPatch(original, [{ op: 'add', path: '/values/1', value: 'second' }])).toEqual({
      values: ['first', 'second'],
    });
    expect(() => applyJsonPatch(original, [{ op: 'remove', path: '/values/1' }])).toThrow(
      JsonPatchError,
    );
  });
  it('rolls back earlier operations when a later operation is invalid', () => {
    const original = { name: 'before', values: [1] };
    expect(() =>
      applyJsonPatch(original, [
        { op: 'replace', path: '/name', value: 'after' },
        { op: 'remove', path: '/values/2' },
      ]),
    ).toThrow(JsonPatchError);
    expect(original).toEqual({ name: 'before', values: [1] });
  });
  it('copies inserted values and preserves unrelated structural sharing', () => {
    const original = { values: [] as { value: number }[], stable: { key: 'unchanged' } };
    const inserted = { value: 1 };
    const updated = applyJsonPatch(original, [{ op: 'add', path: '/values/-', value: inserted }]);
    inserted.value = 2;
    expect(updated.values).toEqual([{ value: 1 }]);
    expect(updated.stable).toBe(original.stable);
    expect(original.values).toEqual([]);
  });
});
