import { describe, expect, it } from 'vitest';

import { Y, initializeDocument, readDocument, applyDocumentChange, LOCAL_EDIT } from './index.js';

function replicas(value: unknown) {
  const seed = new Y.Doc();
  initializeDocument(seed, value);
  const a = new Y.Doc(),
    b = new Y.Doc();
  Y.applyUpdate(a, Y.encodeStateAsUpdate(seed));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(seed));
  seed.destroy();
  return {
    a,
    b,
    exchange: () => {
      const ua = Y.encodeStateAsUpdate(a),
        ub = Y.encodeStateAsUpdate(b);
      Y.applyUpdate(a, ub);
      Y.applyUpdate(b, ua);
    },
  };
}
describe('Yjs document bridge', () => {
  it('preserves concurrent edits to different fields of the same stable node', () => {
    const value = { nodes: [{ id: 'a', props: { label: 'before', value: 0 } }] };
    const { a, b, exchange } = replicas(value);
    applyDocumentChange(a, value, { nodes: [{ id: 'a', props: { label: 'after', value: 0 } }] });
    applyDocumentChange(b, value, { nodes: [{ id: 'a', props: { label: 'before', value: 9 } }] });
    exchange();
    expect(readDocument(a)).toEqual({ nodes: [{ id: 'a', props: { label: 'after', value: 9 } }] });
    expect(readDocument(b)).toEqual(readDocument(a));
    a.destroy();
    b.destroy();
  });
  it('reorders references without discarding a concurrent edit to the moved node', () => {
    const value = {
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    };
    const { a, b, exchange } = replicas(value);
    applyDocumentChange(a, value, {
      nodes: [
        { id: 'a', label: 'new A' },
        { id: 'b', label: 'B' },
      ],
    });
    applyDocumentChange(b, value, {
      nodes: [
        { id: 'b', label: 'B' },
        { id: 'a', label: 'A' },
      ],
    });
    exchange();
    expect(readDocument(a)).toEqual({
      nodes: [
        { id: 'b', label: 'B' },
        { id: 'a', label: 'new A' },
      ],
    });
    expect(readDocument(b)).toEqual(readDocument(a));
    a.destroy();
    b.destroy();
  });
  it('merges insertions into an initially empty container and converges under replay', () => {
    const value = { children: [] };
    const { a, b, exchange } = replicas(value);
    applyDocumentChange(a, value, { children: [{ id: 'left' }] });
    applyDocumentChange(b, value, { children: [{ id: 'right' }] });
    exchange();
    exchange();
    const parsed = readDocument(a) as { children: { id: string }[] };
    expect(parsed.children.map((v) => v.id).sort()).toEqual(['left', 'right']);
    expect(readDocument(b)).toEqual(readDocument(a));
    a.destroy();
    b.destroy();
  });
  it('undoes local changes without undoing another author’s fields', () => {
    const value = { nodes: [{ id: 'a', label: 'A', value: 0 }] };
    const { a, b, exchange } = replicas(value);
    const undo = new Y.UndoManager(a.getMap('script'), { trackedOrigins: new Set([LOCAL_EDIT]) });
    applyDocumentChange(a, value, { nodes: [{ id: 'a', label: 'Local', value: 0 }] });
    applyDocumentChange(b, value, { nodes: [{ id: 'a', label: 'A', value: 8 }] });
    exchange();
    undo.undo();
    expect(readDocument(a)).toEqual({ nodes: [{ id: 'a', label: 'A', value: 8 }] });
    undo.destroy();
    a.destroy();
    b.destroy();
  });
  it('keeps arbitrary user field names separate from internal CRDT markers', () => {
    const doc = new Y.Doc();
    const value = {
      kind: 'keyed',
      items: { kind: 'object', order: ['a'] },
      document: { fields: 'safe' },
    };
    initializeDocument(doc, value);
    expect(readDocument(doc)).toEqual(value);
    doc.destroy();
  });
  it('preserves remote fields absent from a stale local edit', () => {
    const value = { nodes: [{ id: 'a', label: 'A', value: 0 }] };
    const { a, b, exchange } = replicas(value);
    applyDocumentChange(b, value, { nodes: [{ id: 'a', label: 'A', value: 7 }] });
    exchange();
    applyDocumentChange(a, value, { nodes: [{ id: 'a', label: 'Local', value: 0 }] });
    expect(readDocument(a)).toEqual({ nodes: [{ id: 'a', label: 'Local', value: 7 }] });
    a.destroy();
    b.destroy();
  });
});

it('round trips JSON scalars, plain lists and keyed variables without reinitializing existing state', () => {
  const doc = new Y.Doc();
  const before = {
    scalars: [null, false, 0, ''],
    variables: [{ key: 'a', value: 1 }],
    nested: { keep: true, remove: 'old' },
  };
  initializeDocument(doc, before);
  initializeDocument(doc, { replaced: true });
  expect(readDocument(doc)).toEqual(before);
  const after = {
    scalars: ['updated', 1],
    variables: [
      { key: 'a', value: 2 },
      { key: 'b', value: 3 },
    ],
    nested: { keep: true, added: null },
  };
  applyDocumentChange(doc, before, after);
  expect(readDocument(doc)).toEqual(after);
  applyDocumentChange(doc, after, after);
  expect(readDocument(doc)).toEqual(after);
  doc.destroy();
});
it('deletes keyed nodes and switches between list, object and scalar properties', () => {
  const doc = new Y.Doc();
  const before = { nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], value: { nested: [] } };
  initializeDocument(doc, before);
  const after = { nodes: [{ id: 'c' }, { id: 'a' }], value: [null, false] };
  applyDocumentChange(doc, before, after);
  expect(readDocument(doc)).toEqual(after);
  const scalar = { nodes: [null, 'plain'], value: null };
  applyDocumentChange(doc, after, scalar);
  expect(readDocument(doc)).toEqual(scalar);
  doc.destroy();
});
it('empty or malformed remote containers fail closed and accept no uninitialized writes', () => {
  const doc = new Y.Doc();
  expect(readDocument(doc)).toBeNull();
  applyDocumentChange(doc, {}, { changed: true });
  expect(readDocument(doc)).toBeNull();
  for (const kind of ['object', 'keyed', 'list']) {
    const value = new Y.Map();
    value.set('kind', kind);
    doc.getMap('script').set('document', value);
    expect(readDocument(doc)).toEqual(kind === 'object' ? {} : []);
    applyDocumentChange(doc, {}, kind === 'object' ? { changed: true } : [{ id: 'a' }]);
    expect(readDocument(doc)).toEqual(kind === 'object' ? {} : []);
  }
  doc.destroy();
});
