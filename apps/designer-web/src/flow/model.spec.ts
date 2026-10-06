import { describe, expect, it } from 'vitest';

import { minimalScript } from '@verbis/script-schema/fixtures';

import { EditorStore } from '../editor/store.js';

import { importSubflow } from './import.js';
import {
  addFlowNode,
  connectFlow,
  mutateFlow,
  flowProblems,
  createScreenSubflow,
  flowNodeLabel,
  removeFlowElements,
} from './model.js';

describe('flow document transactions', () => {
  it('adds Start and connects the previous entry in one undo step', () => {
    const store = new EditorStore(minimalScript());
    const before = store.getSnapshot().document;
    addFlowNode(store, 'main', 'start', 'entry');
    expect(store.getSnapshot().document.flow.start).toBe('entry');
    expect(store.getSnapshot().document.flow.edges).toContainEqual({
      id: 'edge-entry',
      from: 'entry',
      to: 'n-home',
    });
    store.undo();
    expect(store.getSnapshot().document).toEqual(before);
  });
  it('rejects duplicate else exits without committing partial state', () => {
    const store = new EditorStore(minimalScript());
    addFlowNode(store, 'main', 'decision', 'choice');
    connectFlow(store, 'main', 'choice', 'n-end', 'else', 'fallback');
    const before = store.getSnapshot().document;
    expect(() => {
      connectFlow(store, 'main', 'choice', 'n-home', 'else', 'duplicate');
    }).toThrow();
    expect(store.getSnapshot().document).toBe(before);
    expect(() => {
      connectFlow(store, 'main', 'n-end', 'n-home', null, 'invalid');
    }).toThrow();
  });
  it('maps unreachable and missing fallback warnings onto node badges', () => {
    const store = new EditorStore(minimalScript());
    addFlowNode(store, 'main', 'decision', 'choice');
    const doc = store.getSnapshot().document;
    expect(flowProblems(doc, doc.flow, store.issues()).get('choice')).toContain(
      'designer.flow.missingElse',
    );
  });
  it('groups layout and notes in a single history transaction', () => {
    const store = new EditorStore(minimalScript());
    const before = store.getSnapshot().document;
    mutateFlow(store, 'main', (flow) => {
      flow.designer = {
        groups: [{ id: 'group', label: 'Group', nodes: ['n-home', 'n-end'] }],
        notes: [{ id: 'note', text: 'Review', position: { x: 0, y: 0 } }],
      };
      for (const node of flow.nodes) node.position = { x: 40, y: 80 };
    });
    store.undo();
    expect(store.getSnapshot().document).toEqual(before);
    store.redo();
    expect(store.getSnapshot().document.flow.designer?.notes).toHaveLength(1);
  });
  it('imports a source with fresh internal IDs and retains pinned contents', () => {
    const store = new EditorStore(minimalScript());
    let id = 0;
    const original = store.getSnapshot().document;
    const flowId = importSubflow(store, original, () => `copy-${++id}`);
    const doc = store.getSnapshot().document;
    const copied = doc.subflows.find((f) => f.id === flowId);
    expect(copied?.start).not.toBe(original.flow.start);
    expect(copied?.edges[0]?.from).toBe(copied?.start);
    expect(doc.pages).toHaveLength(2);
    store.undo();
    expect(store.getSnapshot().document).toEqual(original);
  });
  it('reuses an existing screen in an embedded subflow', () => {
    const store = new EditorStore(minimalScript());
    createScreenSubflow(store, 'home', 'child');
    expect(store.getSnapshot().document.subflows[0]?.nodes[0]).toEqual({
      id: 'child-page',
      type: 'page',
      page: 'home',
    });
    expect(store.getSnapshot().document.pages).toHaveLength(1);
    store.undo();
    expect(store.getSnapshot().document.subflows).toHaveLength(0);
  });
  it('rejects dependency conflicts atomically', () => {
    const store = new EditorStore(minimalScript());
    const before = store.getSnapshot().document;
    const source = structuredClone(before);
    source.i18n.messages['tr']!['common.next'] = 'Conflicting';
    expect(() => importSubflow(store, source)).toThrow('VERBIS_IMPORT_CONFLICT');
    expect(store.getSnapshot().document).toBe(before);
  });
});

it('keeps invalid flow operations atomic, including missing screens and endpoints', () => {
  const store = new EditorStore(minimalScript());
  const before = store.getSnapshot().document;
  expect(() => {
    addFlowNode(store, 'missing', 'end', 'new');
  }).toThrow('VERBIS_FLOW');
  expect(() => {
    connectFlow(store, 'missing', 'n-home', 'n-end', null, 'new');
  }).toThrow('VERBIS_FLOW');
  expect(() => {
    mutateFlow(store, 'missing', () => undefined);
  }).toThrow('VERBIS_FLOW');
  expect(() => {
    createScreenSubflow(store, 'missing', 'new');
  }).toThrow('VERBIS_FLOW_PAGE');
  expect(() => {
    connectFlow(store, 'main', 'missing', 'n-end', null, 'new');
  }).toThrow('VERBIS_FLOW_CONNECTION');
  expect(() => {
    connectFlow(store, 'main', 'n-home', 'missing', null, 'new');
  }).toThrow('VERBIS_FLOW_CONNECTION');
  expect(store.getSnapshot().document).toBe(before);
});

it('creates and connects embedded flow nodes without changing the main flow', () => {
  const store = new EditorStore(minimalScript());
  createScreenSubflow(store, 'home', 'child');
  const main = store.getSnapshot().document.flow;
  addFlowNode(store, 'child', 'transfer', 'handoff');
  expect(() => {
    addFlowNode(store, 'child', 'subflow', 'recursive');
  }).toThrow();
  addFlowNode(store, 'main', 'subflow', 'embedded');
  addFlowNode(store, 'child', 'page', 'second-page');
  addFlowNode(store, 'child', 'decision', 'choice');
  connectFlow(store, 'child', 'choice', 'handoff', 'condition', 'conditional');
  connectFlow(store, 'child', 'choice', 'child-end', 'else', 'fallback');
  addFlowNode(store, 'child', 'start', 'entry');
  expect(() => {
    connectFlow(store, 'child', 'second-page', 'entry', null, 'invalid');
  }).toThrow('VERBIS_FLOW_CONNECTION');
  expect(store.getSnapshot().document.flow.nodes.slice(0, main.nodes.length)).toEqual(main.nodes);
  const child = store.getSnapshot().document.subflows[0]!;
  expect(child.nodes.find((n) => n.id === 'handoff')).toMatchObject({
    type: 'transfer',
    target: 'queue',
  });
  expect(child.edges.find((e) => e.id === 'conditional')).toMatchObject({
    when: { $expr: 'true' },
    default: false,
  });
  expect(
    flowProblems(store.getSnapshot().document, child, store.issues()).get('choice'),
  ).not.toContain('designer.flow.missingElse');
});

// D-15
describe('flow canvas data (D-15)', () => {
  it('labels page nodes with the page name, not the flow node id', () => {
    const doc = minimalScript();
    const page = doc.pages[0]!;
    page.name = 'Teşekkürler';
    const node = doc.flow.nodes.find((n) => n.type === 'page')!;
    expect(flowNodeLabel(doc as never, node)).toBe('Teşekkürler');
    const end = doc.flow.nodes.find((n) => n.type === 'end')!;
    expect(flowNodeLabel(doc as never, end)).toBe(end.id);
  });
  it('deletes the orphaned condition rule with its edge, but keeps rules referenced elsewhere', () => {
    const store = new EditorStore(minimalScript());
    store.edit((d) => {
      d.rules.push({ id: 'rule-e1', when: { $expr: 'true' }, then: [] });
      d.rules.push({ id: 'shared', when: { $expr: 'true' }, then: [] });
      d.flow.edges[0]!.when = { $rule: 'rule-e1' };
    });
    removeFlowElements(store, 'main', [], 'e1');
    const doc = store.getSnapshot().document;
    expect(doc.flow.edges).toHaveLength(0);
    expect(doc.rules.map((r) => r.id)).toEqual(['shared']);
    store.undo();
    expect(store.getSnapshot().document.rules.map((r) => r.id)).toEqual(['rule-e1', 'shared']);
  });
  it('keeps a derived rule that another element still references', () => {
    const store = new EditorStore(minimalScript());
    store.edit((d) => {
      d.rules.push({ id: 'rule-e1', when: { $expr: 'true' }, then: [] });
      d.flow.edges[0]!.when = { $rule: 'rule-e1' };
      d.flow.nodes.push({ id: 'n-other', type: 'end' });
      d.pages[0]!.layout.visibleWhen = { $rule: 'rule-e1' };
    });
    removeFlowElements(store, 'main', [], 'e1');
    expect(store.getSnapshot().document.rules.map((r) => r.id)).toEqual(['rule-e1']);
  });
  it('removes nodes with their edges and refuses to remove the start node', () => {
    const store = new EditorStore(minimalScript());
    expect(() => {
      removeFlowElements(store, 'main', ['n-home'], null);
    }).toThrow('VERBIS_FLOW_START_IMMUTABLE');
    removeFlowElements(store, 'main', ['n-end'], null);
    expect(store.getSnapshot().document.flow.nodes.map((n) => n.id)).toEqual(['n-home']);
    expect(store.getSnapshot().document.flow.edges).toEqual([]);
  });
});
