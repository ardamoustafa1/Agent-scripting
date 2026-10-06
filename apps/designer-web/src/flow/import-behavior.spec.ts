import { expect, it } from 'vitest';

import { ScriptDocumentSchema } from '@verbis/script-schema';
import { VALID_FIXTURES, minimalScript } from '@verbis/script-schema/fixtures';

import { EditorStore } from '../editor/store.js';

import { importSubflow } from './import.js';

it.each(Object.entries(VALID_FIXTURES))(
  'pins all dependencies of %s and undoes the entire import',
  (_name, input) => {
    const store = new EditorStore(minimalScript());
    const before = store.getSnapshot().document;
    const source = ScriptDocumentSchema.parse(input);
    const original = structuredClone(source);
    let id = 0;
    const flowId = importSubflow(store, source, () => `synthetic-import-${++id}`);
    const result = store.getSnapshot().document;
    const imported = result.subflows.find((f) => f.id === flowId)!;
    expect(imported).toBeTruthy();
    expect(imported.nodes.map((n) => n.id)).not.toContain(source.flow.start);
    expect(imported.nodes.some((n) => n.id === imported.start)).toBe(true);
    for (const edge of imported.edges) {
      expect(imported.nodes.some((n) => n.id === edge.from)).toBe(true);
      expect(imported.nodes.some((n) => n.id === edge.to)).toBe(true);
    }
    expect(result.variables).toEqual(source.variables);
    expect(result.dataSources).toEqual(source.dataSources);
    expect(result.pages).toHaveLength(before.pages.length + source.pages.length);
    expect(source).toEqual(original);
    store.undo();
    expect(store.getSnapshot().document).toEqual(before);
    store.redo();
    expect(store.getSnapshot().document).toEqual(result);
  },
);
it('rejects conflicting variable and integration definitions without leaving partial dependencies', () => {
  const original = ScriptDocumentSchema.parse(VALID_FIXTURES['collections']);
  for (const kind of ['variable', 'integration'] as const) {
    const store = new EditorStore(original);
    const source = structuredClone(original);
    if (kind === 'variable') source.variables[0]!.description = 'Conflicting synthetic description';
    else source.dataSources[0]!.version += 1;
    const before = store.getSnapshot().document;
    expect(() => importSubflow(store, source)).toThrow('VERBIS_IMPORT_CONFLICT');
    expect(store.getSnapshot().document).toBe(before);
    expect(store.getSnapshot().history).toBe(0);
  }
});
it('remaps nested actions, timers, rule references, subflows and designer annotations together', () => {
  const source = ScriptDocumentSchema.parse(minimalScript());
  source.pages[0]!.timers = [
    {
      id: 'source-timer',
      durationMs: 1000,
      repeat: false,
      autoStart: false,
      onElapsed: [{ type: 'navigate', page: 'home' }],
    },
  ];
  source.pages[0]!.onEnter = [
    {
      type: 'sequence',
      actions: [
        {
          type: 'conditional',
          if: { $rule: 'source-rule' },
          then: [{ type: 'startTimer', timer: 'source-timer' }],
          else: [{ type: 'stopTimer', timer: 'source-timer' }],
        },
      ],
    },
  ];
  source.pages[0]!.layout.children!.push({
    id: 'source-media',
    type: 'timer',
    props: { timer: 'source-timer' },
    bindings: [],
    events: {},
    style: { base: {} },
  });
  source.pages[0]!.onLeave = [
    { type: 'maskField', node: 'btn-next', masked: true },
    { type: 'validatePage', onInvalid: [{ type: 'navigate', page: 'home' }] },
  ];
  source.rules = [
    {
      id: 'source-rule',
      when: { fact: 'interaction.channel', op: 'eq', value: 'voice' },
      then: [{ type: 'navigate', page: 'home' }],
      else: [{ type: 'runSubflow', flow: 'source-subflow' }],
    },
  ];
  source.pages[0]!.layout.children![0]!['visibleWhen'] = { $rule: 'source-rule' };
  source.pages[0]!.layout.children![0]!['enabledWhen'] = { $rule: 'source-rule' };
  source.pages[0]!.layout.children![0]!['requiredWhen'] = { $rule: 'source-rule' };
  source.subflows = [
    {
      id: 'source-subflow',
      start: 'source-end',
      nodes: [{ id: 'source-end', type: 'end' }],
      edges: [],
      limits: { maxSteps: 200 },
    },
  ];
  source.flow.nodes.push({ id: 'source-call', type: 'subflow', flow: 'source-subflow' });
  source.flow.designer = {
    groups: [{ id: 'source-group', label: 'Synthetic group', nodes: ['n-home', 'n-end'] }],
    notes: [{ id: 'source-note', text: 'Synthetic note', position: { x: 10, y: 20 } }],
  };
  const store = new EditorStore(minimalScript());
  let id = 0;
  const mainId = importSubflow(store, source, () => `synthetic-remap-${++id}`);
  const result = store.getSnapshot().document;
  const page = result.pages[1]!,
    rule = result.rules[0]!,
    main = result.subflows.find((flow) => flow.id === mainId)!;
  expect(page.timers[0]!.id).not.toBe('source-timer');
  expect(page.layout.children![1]!['props']).toMatchObject({ timer: page.timers[0]!.id });
  expect(page.onLeave[0]).toMatchObject({ node: page.layout.children![0]!['id'] });
  expect(page.timers[0]!.onElapsed).toEqual([{ type: 'navigate', page: page.id }]);
  expect(page.layout.children![0]!['visibleWhen']).toEqual({ $rule: rule.id });
  expect(rule.then).toEqual([{ type: 'navigate', page: page.id }]);
  const child = result.subflows.find((flow) => flow.id !== mainId)!;
  expect(rule.else).toEqual([{ type: 'runSubflow', flow: child.id }]);
  expect(main.nodes.find((node) => node.type === 'subflow')).toMatchObject({ flow: child.id });
  expect(main.designer!.groups[0]!.nodes).toEqual(main.nodes.slice(0, 2).map((node) => node.id));
  expect(main.designer!.notes[0]!.id).not.toBe('source-note');
  expect(JSON.stringify(page.onEnter)).toContain(page.timers[0]!.id);
  expect(JSON.stringify(page.onEnter)).not.toContain('source-timer');
  expect(source.pages[0]!.timers[0]!.id).toBe('source-timer');
});
