import { describe, expect, it } from 'vitest';

import { surveyScript } from './fixtures/index.js';
import { mergeDocuments } from './merge.js';
import { ScriptDocumentSchema, type ScriptDocument } from './schema/document.js';

const base = ScriptDocumentSchema.parse(surveyScript);
const clone = (): ScriptDocument => structuredClone(base);
const firstPage = (doc: ScriptDocument) => {
  const page = doc.pages[0];
  if (!page) throw new Error('fixture needs a page');
  return page;
};
const variable = (doc: ScriptDocument) => {
  const v = doc.variables[0];
  if (!v) throw new Error('fixture needs a variable');
  return v;
};

describe('mergeDocuments', () => {
  it('returns the document unchanged when nobody changed anything', () => {
    const result = mergeDocuments(base, clone(), clone());
    expect(result.conflicts).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.document).toEqual(base);
  });

  it('combines edits to different things without conflict, from either side', () => {
    const ours = clone(),
      theirs = clone();
    firstPage(ours).name = 'Renamed by ours';
    theirs.variables.push({ key: 'addedByTheirs', type: 'string', scope: 'session' } as never);
    for (const [a, b] of [
      [ours, theirs],
      [theirs, ours],
    ] as const) {
      const result = mergeDocuments(base, a, b);
      expect(result.conflicts).toEqual([]);
      expect(result.issues).toEqual([]);
      expect(firstPage(result.document!).name).toBe('Renamed by ours');
      expect(result.document?.variables.map((v) => v.key)).toContain('addedByTheirs');
    }
  });

  it('reports a conflict when both sides change the same field differently, keeping ours provisionally', () => {
    const ours = clone(),
      theirs = clone(),
      id = firstPage(base).id;
    firstPage(ours).name = 'Ours';
    firstPage(theirs).name = 'Theirs';
    const result = mergeDocuments(base, ours, theirs);
    expect(result.conflicts).toEqual([
      {
        path: `/pages/${id}/name`,
        kind: 'both-changed',
        base: firstPage(base).name,
        ours: 'Ours',
        theirs: 'Theirs',
      },
    ]);
    expect(firstPage(result.document!).name).toBe('Ours');
  });

  it('is not a conflict when both sides make the same change', () => {
    const ours = clone(),
      theirs = clone();
    firstPage(ours).name = firstPage(theirs).name = 'Same';
    expect(mergeDocuments(base, ours, theirs).conflicts).toEqual([]);
  });

  it('applies a deletion that the other side did not touch, and flags delete-versus-change', () => {
    const key = variable(base).key;
    const deletes = clone();
    deletes.variables = deletes.variables.filter((v) => v.key !== key);
    const touches = clone();
    const changed = touches.variables.find((v) => v.key === key);
    if (!changed) throw new Error('fixture');
    const untouched = mergeDocuments(base, deletes, clone());
    expect(untouched.conflicts).toEqual([]);
    expect(untouched.document?.variables.some((v) => v.key === key)).toBe(false);
    changed.persist = !changed.persist;
    const clash = mergeDocuments(base, deletes, touches);
    expect(clash.conflicts).toMatchObject([
      { path: `/variables/${key}`, kind: 'deleted-vs-changed' },
    ]);
  });

  it('flags two different items that were added under the same id', () => {
    const ours = clone(),
      theirs = clone();
    ours.variables.push({ key: 'dup', type: 'string', scope: 'session' } as never);
    theirs.variables.push({ key: 'dup', type: 'number', scope: 'session' } as never);
    expect(mergeDocuments(base, ours, theirs).conflicts).toMatchObject([
      { path: '/variables/dup', kind: 'duplicate-id' },
    ]);
    const identical = clone();
    identical.variables.push({ key: 'dup', type: 'string', scope: 'session' } as never);
    expect(mergeDocuments(base, ours, identical).conflicts).toEqual([]);
  });

  it('merges layout trees node by node: one side edits a node, the other adds a child', () => {
    const ours = clone(),
      theirs = clone();
    const root = firstPage(theirs).layout;
    root.children = [
      ...(root.children ?? []),
      { id: 'added-node', type: 'scriptText', props: {}, bindings: [], events: {} },
    ];
    const ourRoot = firstPage(ours).layout;
    ourRoot.props = { ...ourRoot.props, hint: 'edited by ours' };
    const result = mergeDocuments(base, ours, theirs);
    expect(result.conflicts).toEqual([]);
    const merged = firstPage(result.document!).layout;
    expect(merged.props['hint']).toBe('edited by ours');
    expect(merged.children?.map((n) => n.id)).toContain('added-node');
  });

  it('merges i18n texts per locale and key', () => {
    const ours = clone(),
      theirs = clone(),
      locale = Object.keys(base.i18n.messages)[0] ?? 'tr';
    ours.i18n.messages[locale] = { ...ours.i18n.messages[locale], 'merge.a': 'A' };
    theirs.i18n.messages[locale] = { ...theirs.i18n.messages[locale], 'merge.b': 'B' };
    const result = mergeDocuments(base, ours, theirs);
    expect(result.conflicts).toEqual([]);
    expect(result.document?.i18n.messages[locale]).toMatchObject({
      'merge.a': 'A',
      'merge.b': 'B',
    });
    theirs.i18n.messages[locale] = { ...theirs.i18n.messages[locale], 'merge.a': 'Different' };
    expect(mergeDocuments(base, ours, theirs).conflicts).toMatchObject([
      { path: `/i18n/messages/${locale}/merge.a`, kind: 'both-changed' },
    ]);
  });

  it('reports schema issues of an invalid merge result instead of returning it silently', () => {
    const ours = clone(),
      theirs = clone();
    const node = ours.flow.nodes[0];
    if (!node) throw new Error('fixture');
    // Each side is valid alone; together they reference a flow node nobody defines.
    ours.flow.edges.push({ id: 'dangling-edge', from: node.id, to: node.id });
    const bad = structuredClone(theirs) as unknown as { flow: { start: string } };
    bad.flow.start = 'no-such-node';
    const result = mergeDocuments(base, ours, bad as unknown as ScriptDocument);
    expect(Array.isArray(result.issues)).toBe(true);
    expect(result.conflicts).toEqual([]);
  });

  it('merges rules, data sources, scenarios, theme and flow edges by id', () => {
    const ours = clone(),
      theirs = clone();
    ours.rules.push({ id: 'rule-ours', when: { $expr: 'true' }, then: [] });
    theirs.rules.push({ id: 'rule-theirs', when: { $expr: 'true' }, then: [] });
    ours.testScenarios = [
      {
        id: 'scnOurs',
        name: 'Ours',
        synthetic: true,
        context: {},
        dataSources: {},
        steps: [],
        expected: { ended: false },
      },
    ] as never;
    theirs.testScenarios = [
      {
        id: 'scnTheirs',
        name: 'Theirs',
        synthetic: true,
        context: {},
        dataSources: {},
        steps: [],
        expected: { ended: false },
      },
    ] as never;
    theirs.theme = { tokens: {} } as never;
    const node = ours.flow.nodes[0];
    if (!node) throw new Error('fixture');
    ours.flow.edges.push({ id: 'edge-ours', from: node.id, to: node.id });
    theirs.flow.edges.push({ id: 'edge-theirs', from: node.id, to: node.id });
    const result = mergeDocuments(base, ours, theirs);
    expect(result.issues).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.document?.rules.map((r) => r.id)).toEqual(
      expect.arrayContaining(['rule-ours', 'rule-theirs']),
    );
    expect(result.document?.testScenarios?.map((x) => x.id).sort()).toEqual([
      'scnOurs',
      'scnTheirs',
    ]);
    expect(result.document?.flow.edges.map((e) => e.id)).toEqual(
      expect.arrayContaining(['edge-ours', 'edge-theirs']),
    );
    expect(result.document?.theme).toBeDefined();
  });

  it('merges subflows and data sources, and keeps a one-sided deletion of an untouched item', () => {
    const ours = clone(),
      theirs = clone();
    const flow = structuredClone(base.flow);
    ours.subflows = [{ ...flow, id: 'sub-ours' }];
    theirs.subflows = [{ ...flow, id: 'sub-theirs' }];
    ours.dataSources.push({
      id: 'dsOurs',
      ref: 'tenant-datasource:a',
      version: 1,
      inputs: {},
      outputs: {},
    } as never);
    const result = mergeDocuments(base, ours, theirs);
    expect(result.issues).toEqual([]);
    expect(result.document?.subflows.map((f) => f.id).sort()).toEqual(['sub-ours', 'sub-theirs']);
    expect(result.document?.dataSources.map((d) => d.id)).toContain('dsOurs');
    const registry = { type: 'scriptText', version: '1.0.0', integrity: 'sha256-AAAA' };
    ours.componentRegistry = [registry];
    expect(mergeDocuments(base, ours, clone()).document?.componentRegistry).toHaveLength(1);
    // Deleted by theirs while ours kept it unchanged: gone, no conflict.
    const gone = mergeDocuments(ours, ours, { ...clone(), componentRegistry: [] });
    expect(gone.conflicts).toEqual([]);
    expect(gone.document?.componentRegistry).toEqual([]);
  });

  it('resolves a page-level conflict inside a changed layout node deterministically', () => {
    const ours = clone(),
      theirs = clone();
    const a = firstPage(ours).layout,
      b = firstPage(theirs).layout;
    a.props = { ...a.props, hint: 'ours' };
    b.props = { ...b.props, hint: 'theirs' };
    const first = mergeDocuments(base, ours, theirs);
    expect(first.conflicts.map((c) => c.kind)).toEqual(['both-changed']);
    expect(mergeDocuments(base, ours, theirs)).toEqual(first);
  });
});
