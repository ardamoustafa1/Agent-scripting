import { describe, expect, it } from 'vitest';

import { surveyScript } from './fixtures/index.js';
import { ScriptDocumentSchema, type ScriptDocument } from './schema/document.js';
import {
  applySuggestion,
  MAX_SUGGESTION_OPERATIONS,
  suggestOperations,
  TooManyOperationsError,
} from './suggest.js';

const base = ScriptDocumentSchema.parse(surveyScript);
const edit = (change: (doc: ScriptDocument) => void): ScriptDocument => {
  const doc = structuredClone(base);
  change(doc);
  return doc;
};

describe('suggestOperations', () => {
  it('returns nothing for an unchanged document, whatever the key order', () => {
    expect(suggestOperations(base, structuredClone(base))).toEqual([]);
    expect(suggestOperations({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
  });

  it('describes object key changes with the narrowest paths', () => {
    expect(suggestOperations({ a: { b: 1, c: 2 }, d: 3 }, { a: { b: 9 }, e: { f: 1 } })).toEqual([
      { op: 'replace', path: '/a/b', value: 9 },
      { op: 'remove', path: '/a/c' },
      { op: 'remove', path: '/d' },
      { op: 'add', path: '/e', value: { f: 1 } },
    ]);
  });

  it('compares arrays element by element only when identity and order are unchanged', () => {
    const before = {
      items: [
        { id: 'a', v: 1 },
        { id: 'b', v: 2 },
      ],
    };
    expect(
      suggestOperations(before, {
        items: [
          { id: 'a', v: 1 },
          { id: 'b', v: 3 },
        ],
      }),
    ).toEqual([{ op: 'replace', path: '/items/1/v', value: 3 }]);
    // Reordered or renamed identities: replaced as a whole.
    expect(
      suggestOperations(before, {
        items: [
          { id: 'b', v: 2 },
          { id: 'a', v: 1 },
        ],
      }),
    ).toEqual([
      {
        op: 'replace',
        path: '/items',
        value: [
          { id: 'b', v: 2 },
          { id: 'a', v: 1 },
        ],
      },
    ]);
    // Anything without a string id/key (primitives, anonymous objects) is replaced whole.
    expect(suggestOperations({ l: [{ v: 1 }] }, { l: [{ v: 2 }] })).toEqual([
      { op: 'replace', path: '/l', value: [{ v: 2 }] },
    ]);
  });

  it('turns items appended at the end into additions, and anything else into a replacement', () => {
    expect(suggestOperations({ l: [1, 2] }, { l: [1, 2, 3, 4] })).toEqual([
      { op: 'add', path: '/l/2', value: 3 },
      { op: 'add', path: '/l/3', value: 4 },
    ]);
    expect(suggestOperations({ l: [1, 2] }, { l: [0, 1, 2] })).toEqual([
      { op: 'replace', path: '/l', value: [0, 1, 2] },
    ]);
    expect(suggestOperations({ l: [1, 2] }, { l: [1] })).toEqual([
      { op: 'replace', path: '/l', value: [1] },
    ]);
  });

  it('replaces an array or a changed type as a whole so no index ever shifts', () => {
    expect(suggestOperations({ list: [1, 2, 3] }, { list: [1, 3] })).toEqual([
      { op: 'replace', path: '/list', value: [1, 3] },
    ]);
    expect(suggestOperations({ a: { b: 1 } }, { a: 'text' })).toEqual([
      { op: 'replace', path: '/a', value: 'text' },
    ]);
    expect(suggestOperations({ a: null }, { a: { b: 1 } })).toEqual([
      { op: 'replace', path: '/a', value: { b: 1 } },
    ]);
  });

  it('treats undefined values as absent and escapes pointer characters', () => {
    expect(suggestOperations({ a: 1, b: 2 }, { a: 1, b: undefined })).toEqual([
      { op: 'remove', path: '/b' },
    ]);
    expect(suggestOperations({}, { 'a/b': 1, 'c~d': 2 })).toEqual([
      { op: 'add', path: '/a~1b', value: 1 },
      { op: 'add', path: '/c~0d', value: 2 },
    ]);
  });

  it('applies back to exactly the edited document (round trip on real script edits)', () => {
    const edited = edit((doc) => {
      const page = doc.pages[0];
      if (!page) throw new Error('fixture');
      page.name = 'Renamed';
      page.layout.props = { ...page.layout.props, hint: 'new' };
      doc.rules = doc.rules.slice(1);
      doc.variables.push({ key: 'addedVariable', type: 'string', scope: 'session' } as never);
      doc.meta = { ...doc.meta, description: 'Edited' };
    });
    const operations = suggestOperations(base, edited);
    expect(operations.length).toBeGreaterThan(0);
    expect(applySuggestion(base, operations)).toEqual(edited);
  });

  it('refuses a suggestion that would need too many operations', () => {
    const before: Record<string, number> = {},
      after: Record<string, number> = {};
    for (let i = 0; i <= MAX_SUGGESTION_OPERATIONS; i += 1) after[`k${String(i)}`] = i;
    expect(() => suggestOperations(before, after)).toThrow(TooManyOperationsError);
    const ok: Record<string, number> = {};
    for (let i = 0; i < MAX_SUGGESTION_OPERATIONS; i += 1) ok[`k${String(i)}`] = i;
    expect(suggestOperations(before, ok)).toHaveLength(MAX_SUGGESTION_OPERATIONS);
  });
});
