import { describe, expect, it } from 'vitest';

import { VALID_FIXTURES } from '../fixtures/index.js';
import { minimalScript } from '../fixtures/minimal.js';
import { ScriptDocumentSchema } from '../schema/document.js';
import { applyJsonPatch, type JsonPatchOperation } from '../tree/json-patch.js';

import { unusedVariables } from './usage.js';

const doc = (operations: readonly JsonPatchOperation[]) =>
  ScriptDocumentSchema.parse(
    applyJsonPatch(minimalScript(), [{ op: 'add', path: '/variables', value: [] }, ...operations]),
  );
const variable = (value: Record<string, unknown>): JsonPatchOperation => ({
  op: 'add',
  path: '/variables/-',
  value: { type: 'string', scope: 'session', ...value },
});
const setVariable = (key: string): JsonPatchOperation => ({
  op: 'add',
  path: '/pages/0/layout/children/0/events/onPress/-',
  value: { type: 'setVariable', variable: key, value: 'x' },
});

describe('unusedVariables', () => {
  it('reports a declared variable nobody reads or writes', () => {
    expect(unusedVariables(doc([variable({ key: 'notes' })]))).toEqual([
      { key: 'notes', path: '/variables/0', sensitive: false },
    ]);
  });

  it('ignores variables that are written by an action', () => {
    expect(unusedVariables(doc([variable({ key: 'notes' }), setVariable('notes')]))).toEqual([]);
  });

  it('flags unused PII and PCI as sensitive', () => {
    const result = unusedVariables(
      doc([
        variable({ key: 'tckn', pii: true }),
        variable({ key: 'pan', classification: 'pci' }),
        variable({ key: 'name', classification: 'pii' }),
      ]),
    );
    expect(result.map((v) => [v.key, v.sensitive])).toEqual([
      ['tckn', true],
      ['pan', true],
      ['name', true],
    ]);
  });

  it('excludes persisted variables and global constants', () => {
    expect(
      unusedVariables(
        doc([
          variable({ key: 'captured', persist: true }),
          variable({ key: 'brand', scope: 'global' }),
        ]),
      ),
    ).toEqual([]);
  });

  it.each(Object.entries(VALID_FIXTURES))('is deterministic on fixture %s', (_, input) => {
    const parsed = ScriptDocumentSchema.parse(input);
    expect(unusedVariables(parsed)).toEqual(unusedVariables(parsed));
  });
});
