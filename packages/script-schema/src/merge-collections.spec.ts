import { describe, expect, it } from 'vitest';

import { surveyScript } from './fixtures/index.js';
import { mergeDocuments } from './merge.js';
import { ScriptDocumentSchema, type ScriptDocument } from './schema/document.js';

/**
 * Collection-level contract of the structural merge: every keyed collection reports conflicts
 * under its own path, applies one-sided deletions of untouched items, flags delete-versus-change
 * in both directions and keeps the surviving side. Complements `merge.spec.ts`.
 */
const survey = ScriptDocumentSchema.parse(surveyScript);
const rich = (): ScriptDocument => {
  const doc = structuredClone(survey);
  doc.rules.push({ id: 'rule-base', when: { $expr: 'true' }, then: [] });
  doc.dataSources.push({
    id: 'dsBase',
    ref: 'tenant-datasource:a',
    version: 1,
    inputs: {},
    outputs: {},
  } as never);
  doc.subflows = [{ ...structuredClone(survey.flow), id: 'sub-base' }];
  doc.componentRegistry = [{ type: 'scriptText', version: '1.0.0', integrity: 'sha256-AAAA' }];
  doc.testScenarios = [
    {
      id: 'scnBase',
      name: 'Base',
      synthetic: true,
      context: {},
      dataSources: {},
      steps: [],
      expected: { ended: false },
    },
  ] as never;
  return doc;
};
const base = ScriptDocumentSchema.parse(rich());
const clone = (): ScriptDocument => structuredClone(base);

type Item = Record<string, unknown>;
const items = (doc: ScriptDocument, name: string): Item[] =>
  (doc as unknown as Record<string, Item[]>)[name] ?? [];
const setItems = (doc: ScriptDocument, name: string, value: Item[]): void => {
  (doc as unknown as Record<string, Item[]>)[name] = value;
};

const COLLECTIONS = [
  { name: 'variables', key: 'key', change: { description: 'changed' } },
  { name: 'dataSources', key: 'id', change: { version: 2 } },
  { name: 'rules', key: 'id', change: { description: 'changed' } },
  { name: 'componentRegistry', key: 'type', change: { version: '2.0.0' } },
  { name: 'testScenarios', key: 'id', change: { name: 'Changed' } },
  { name: 'subflows', key: 'id', change: { startNodeId: 'elsewhere' } },
  { name: 'pages', key: 'id', change: { name: 'Changed page' } },
] as const;

describe.each(COLLECTIONS)('mergeDocuments / $name', ({ name, key, change }) => {
  const target = (doc: ScriptDocument): Item => {
    const found = items(doc, name)[0];
    if (!found) throw new Error(`fixture needs a ${name} entry`);
    return found;
  };
  const id = String(target(base)[key]);

  it('applies a deletion the other side never touched, from either side', () => {
    const deleting = clone();
    setItems(
      deleting,
      name,
      items(deleting, name).filter((item) => item[key] !== id),
    );
    for (const [ours, theirs] of [
      [deleting, clone()],
      [clone(), deleting],
    ] as const) {
      const result = mergeDocuments(base, ours, theirs);
      expect(result.conflicts).toEqual([]);
      expect(items(result.document ?? base, name).some((item) => item[key] === id)).toBe(false);
    }
  });

  it('flags delete-versus-change under the collection path and keeps the changed side', () => {
    const deleting = clone();
    setItems(
      deleting,
      name,
      items(deleting, name).filter((item) => item[key] !== id),
    );
    const changing = clone();
    Object.assign(target(changing), change);
    const changed = target(changing);
    const baseItem = target(base);
    expect(mergeDocuments(base, deleting, changing).conflicts).toEqual([
      {
        path: `/${name}/${id}`,
        kind: 'deleted-vs-changed',
        base: baseItem,
        ours: undefined,
        theirs: changed,
      },
    ]);
    expect(mergeDocuments(base, changing, deleting).conflicts).toEqual([
      {
        path: `/${name}/${id}`,
        kind: 'deleted-vs-changed',
        base: baseItem,
        ours: changed,
        theirs: undefined,
      },
    ]);
  });

  it('flags two different items added under the same id as duplicates', () => {
    const lean = clone();
    setItems(
      lean,
      name,
      items(lean, name).filter((item) => item[key] !== id),
    );
    const baseLean = ScriptDocumentSchema.parse(lean);
    const ours = structuredClone(baseLean),
      theirs = structuredClone(baseLean);
    const a = { ...target(base), ...change },
      b = structuredClone(target(base));
    setItems(ours, name, [...items(ours, name), a]);
    setItems(theirs, name, [...items(theirs, name), b]);
    const conflicts = mergeDocuments(baseLean, ours, theirs).conflicts;
    expect(conflicts.map(({ path, kind }) => ({ path, kind }))).toEqual([
      { path: `/${name}/${id}`, kind: 'duplicate-id' },
    ]);
    expect(conflicts[0]).toMatchObject({ base: undefined, ours: a, theirs: b });
  });
});

describe('mergeDocuments / ordering and flow internals', () => {
  it('lists our items first, then items only theirs added', () => {
    const ours = clone(),
      theirs = clone();
    ours.rules.push({ id: 'rule-ours', when: { $expr: 'true' }, then: [] });
    theirs.rules.push({ id: 'rule-theirs', when: { $expr: 'true' }, then: [] });
    expect(mergeDocuments(base, ours, theirs).document?.rules.map((r) => r.id)).toEqual([
      'rule-base',
      'rule-ours',
      'rule-theirs',
    ]);
  });

  it('removes an untouched flow edge and an untouched flow node child from the base', () => {
    const edge = base.flow.edges[0];
    if (!edge) throw new Error('fixture needs a flow edge');
    const ours = clone();
    ours.flow.edges = ours.flow.edges.filter((candidate) => candidate.id !== edge.id);
    const result = mergeDocuments(base, ours, clone());
    expect(result.conflicts).toEqual([]);
    expect(result.document?.flow.edges.some((e) => e.id === edge.id)).toBe(false);
    expect(
      mergeDocuments(base, clone(), ours).document?.flow.edges.some((e) => e.id === edge.id),
    ).toBe(false);
  });

  it('reports conflicts for flow edges and meta under their own paths', () => {
    const edge = base.flow.edges[0];
    if (!edge) throw new Error('fixture needs a flow edge');
    const ours = clone(),
      theirs = clone();
    const a = ours.flow.edges.find((candidate) => candidate.id === edge.id),
      b = theirs.flow.edges.find((candidate) => candidate.id === edge.id);
    if (!a || !b) throw new Error('fixture');
    a.maxIterations = 2;
    b.maxIterations = 3;
    ours.meta = { ...ours.meta, name: 'Ours name' };
    theirs.meta = { ...theirs.meta, name: 'Theirs name' };
    const conflicts = mergeDocuments(base, ours, theirs)
      .conflicts.map((c) => c.path)
      .sort();
    expect(conflicts).toEqual([`/flow/edges/${edge.id}/maxIterations`, '/meta/name']);
  });

  it('reports nested layout children under /pages/<id>/layout/children/<node>', () => {
    const page = base.pages[0];
    const child = page?.layout.children?.[0];
    if (!page || !child) throw new Error('fixture needs a layout child');
    const ours = clone(),
      theirs = clone();
    const ourChild = ours.pages[0]?.layout.children?.[0],
      theirChild = theirs.pages[0]?.layout.children?.[0];
    if (!ourChild || !theirChild) throw new Error('fixture');
    ourChild.props = { ...ourChild.props, hint: 'ours' };
    theirChild.props = { ...theirChild.props, hint: 'theirs' };
    const conflicts = mergeDocuments(base, ours, theirs).conflicts;
    expect(conflicts.map((c) => c.path)).toEqual([
      `/pages/${page.id}/layout/children/${child.id}/props/hint`,
    ]);
  });

  it('drops an untouched layout child that one side deleted', () => {
    const page = base.pages[0];
    const child = page?.layout.children?.[0];
    if (!page || !child) throw new Error('fixture needs a layout child');
    const ours = clone();
    const layout = ours.pages[0]?.layout;
    if (!layout) throw new Error('fixture');
    layout.children = (layout.children ?? []).filter((candidate) => candidate.id !== child.id);
    const result = mergeDocuments(base, ours, clone());
    expect(result.conflicts).toEqual([]);
    expect(result.document?.pages[0]?.layout.children?.some((n) => n.id === child.id)).toBe(false);
  });

  it('treats a theme only one side set as that side’s value and conflicts when both differ', () => {
    const ours = clone(),
      theirs = clone();
    ours.theme = { mode: 'dark', tokens: { density: 'compact' } } as never;
    expect(mergeDocuments(base, ours, clone()).document?.theme).toEqual(ours.theme);
    expect(mergeDocuments(base, clone(), ours).document?.theme).toEqual(ours.theme);
    theirs.theme = { mode: 'dark', tokens: { density: 'comfortable' } } as never;
    expect(mergeDocuments(base, ours, theirs).conflicts.map((c) => c.path)).toEqual(['/theme']);
  });

  it('omits testScenarios when no side has any', () => {
    const lean = ScriptDocumentSchema.parse(structuredClone(survey));
    const result = mergeDocuments(lean, structuredClone(lean), structuredClone(lean));
    expect(result.document).not.toBeNull();
    expect('testScenarios' in (result.document ?? {})).toBe(false);
  });

  it('describes schema issues as path: message', () => {
    const broken = structuredClone(base) as unknown as { id: string };
    broken.id = '';
    const result = mergeDocuments(base, broken as unknown as ScriptDocument, clone());
    expect(result.document).toBeNull();
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]).toMatch(/^id: .+/);
  });
});

describe('mergeDocuments / resolutions', () => {
  const pageName = (doc: ScriptDocument) => doc.pages[0]?.name;
  const conflicted = () => {
    const ours = clone(),
      theirs = clone();
    if (ours.pages[0]) ours.pages[0].name = 'Ours';
    if (theirs.pages[0]) theirs.pages[0].name = 'Theirs';
    return { ours, theirs, path: `/pages/${base.pages[0]?.id ?? ''}/name` };
  };

  it('applies the chosen side of a both-changed conflict and marks it resolved', () => {
    const { ours, theirs, path } = conflicted();
    const theirsWins = mergeDocuments(base, ours, theirs, { [path]: 'theirs' });
    expect(pageName(theirsWins.document!)).toBe('Theirs');
    expect(theirsWins.conflicts).toEqual([expect.objectContaining({ path, resolution: 'theirs' })]);
    const oursWins = mergeDocuments(base, ours, theirs, { [path]: 'ours' });
    expect(pageName(oursWins.document!)).toBe('Ours');
    expect(oursWins.conflicts[0]?.resolution).toBe('ours');
    // Unresolved stays provisional in favour of ours, without a resolution marker.
    const open = mergeDocuments(base, ours, theirs);
    expect(pageName(open.document!)).toBe('Ours');
    expect(open.conflicts[0]).not.toHaveProperty('resolution');
  });

  it('lets the chosen side win a delete-versus-change conflict, including the deletion', () => {
    const id = String(items(base, 'rules')[0]?.['id']);
    const deleting = clone();
    setItems(
      deleting,
      'rules',
      items(deleting, 'rules').filter((r) => r['id'] !== id),
    );
    const changing = clone();
    Object.assign(items(changing, 'rules')[0] ?? {}, { description: 'changed' });
    const path = `/rules/${id}`;
    // ours deleted, theirs changed.
    const keepsChange = mergeDocuments(base, deleting, changing, { [path]: 'theirs' });
    expect(keepsChange.document?.rules.some((r) => r.id === id)).toBe(true);
    const keepsDeletion = mergeDocuments(base, deleting, changing, { [path]: 'ours' });
    expect(keepsDeletion.document?.rules.some((r) => r.id === id)).toBe(false);
    // ours changed, theirs deleted.
    expect(
      mergeDocuments(base, changing, deleting, { [path]: 'theirs' }).document?.rules.some(
        (r) => r.id === id,
      ),
    ).toBe(false);
    expect(
      mergeDocuments(base, changing, deleting, { [path]: 'ours' }).document?.rules.some(
        (r) => r.id === id,
      ),
    ).toBe(true);
  });

  it('picks the chosen item when two different items were added under one id', () => {
    const lean = clone();
    setItems(lean, 'rules', []);
    const baseLean = ScriptDocumentSchema.parse(lean);
    const first: Item = structuredClone(items(base, 'rules')[0] ?? {});
    const a: Item = { ...first, description: 'ours item' },
      b: Item = { ...first, description: 'theirs item' };
    const ours = structuredClone(baseLean),
      theirs = structuredClone(baseLean);
    setItems(ours, 'rules', [a]);
    setItems(theirs, 'rules', [b]);
    const path = `/rules/${String(a['id'])}`;
    expect(
      mergeDocuments(baseLean, ours, theirs, { [path]: 'theirs' }).document?.rules[0]?.description,
    ).toBe('theirs item');
    expect(
      mergeDocuments(baseLean, ours, theirs, { [path]: 'ours' }).document?.rules[0]?.description,
    ).toBe('ours item');
  });

  it('ignores resolutions for paths that are not conflicts, including prototype keys', () => {
    const { ours, theirs, path } = conflicted();
    const result = mergeDocuments(base, ours, theirs, {
      '/nothing/here': 'theirs',
      ['__proto__']: 'theirs',
      constructor: 'theirs',
    } as never);
    expect(pageName(result.document!)).toBe('Ours');
    expect(result.conflicts).toEqual([expect.objectContaining({ path })]);
    expect(result.conflicts[0]).not.toHaveProperty('resolution');
  });
});
