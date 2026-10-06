import { describe, expect, it } from 'vitest';

import { minimalScript } from '../fixtures/minimal.js';
import { ActionSchema } from '../schema/actions.js';
import { ScriptDocumentSchema } from '../schema/document.js';

import { collect, type Reference } from './collect.js';

type Expected = Reference & { path: string };
const read = (path: string, sink?: 'display' | 'platform' | 'analytics' | 'log'): Expected => ({
  kind: 'variableRead',
  id: 'customer',
  path,
  ...(sink ? { sink } : {}),
});
const write = (path: string): Extract<Reference, { kind: 'variableWrite' }> & { path: string } => ({
  kind: 'variableWrite',
  id: 'answer',
  path,
});
const expr = { $expr: 'vars.customer' };
const cases: [string, unknown, Expected[]][] = [
  [
    'literal write',
    { type: 'setVariable', variable: 'answer', value: null },
    [{ ...write('variable'), literal: null }],
  ],
  [
    'expression write',
    { type: 'setVariable', variable: 'answer', value: expr },
    [write('variable'), read('value/$expr')],
  ],
  [
    'data source',
    {
      type: 'callDataSource',
      dataSource: 'lookup',
      inputs: { key: expr },
      onSuccess: [{ type: 'navigate', page: 'success' }],
      onError: [{ type: 'openModal', page: 'failure' }],
    },
    [
      { kind: 'dataSource', id: 'lookup', path: 'dataSource' },
      read('inputs/key/$expr'),
      { kind: 'page', id: 'success', path: 'onSuccess/0/page' },
      { kind: 'page', id: 'failure', path: 'onError/0/page' },
    ],
  ],
  [
    'validation',
    { type: 'validatePage', page: 'form', onInvalid: [{ type: 'navigate', page: 'invalid' }] },
    [
      { kind: 'page', id: 'form', path: 'page' },
      { kind: 'page', id: 'invalid', path: 'onInvalid/0/page' },
    ],
  ],
  [
    'toast',
    { type: 'showToast', messageKey: 'notice.saved', params: { name: expr } },
    [
      { kind: 'i18n', id: 'notice.saved', path: 'messageKey' },
      read('params/name/$expr', 'display'),
    ],
  ],
  [
    'outcome',
    { type: 'submitOutcome', outcome: 'SALE', notes: expr },
    [read('notes/$expr', 'platform')],
  ],
  [
    'write back',
    { type: 'writeBackToPlatform', attributes: { name: expr } },
    [read('attributes/name/$expr', 'platform')],
  ],
  [
    'transfer',
    { type: 'transferHint', target: 'sales', reasonKey: 'reason.sales' },
    [{ kind: 'i18n', id: 'reason.sales', path: 'reasonKey' }],
  ],
  [
    'subflow',
    { type: 'runSubflow', flow: 'child' },
    [{ kind: 'subflow', id: 'child', path: 'flow' }],
  ],
  [
    'condition',
    {
      type: 'conditional',
      if: { $rule: 'eligible' },
      then: [{ type: 'startTimer', timer: 'clock' }],
      else: [{ type: 'stopTimer', timer: 'clock' }],
    },
    [
      { kind: 'rule', id: 'eligible', path: 'if/$rule' },
      { kind: 'timer', id: 'clock', path: 'then/0/timer' },
      { kind: 'timer', id: 'clock', path: 'else/0/timer' },
    ],
  ],
  [
    'expression condition',
    { type: 'conditional', if: expr, then: [{ type: 'maskField', node: 'input' }] },
    [read('if/$expr'), { kind: 'node', id: 'input', path: 'then/0/node' }],
  ],
  ...(['sequence', 'parallel'] as const).map((type): [string, unknown, Expected[]] => [
    type,
    { type, actions: [{ type: 'setVariable', variable: 'answer', value: expr }] },
    [write('actions/0/variable'), read('actions/0/value/$expr')],
  ]),
  [
    'analytics',
    { type: 'emitEvent', name: 'offer.accepted', payload: { name: expr } },
    [read('payload/name/$expr', 'analytics')],
  ],
  [
    'log',
    { type: 'logEvent', event: 'offer.accepted', data: { name: expr } },
    [read('data/name/$expr', 'log')],
  ],
  ...(['next', 'back', 'closeModal'] as const).map((type): [string, unknown, Expected[]] => [
    type,
    { type },
    [],
  ]),
  ['disposition', { type: 'setDisposition', code: 'DONE' }, []],
  ['implicit page', { type: 'validatePage' }, []],
  ['unlabelled transfer', { type: 'transferHint', target: 'sales' }, []],
];
describe('cross-reference collection', () => {
  it.each(cases)(
    '%s preserves every reference, pointer and security sink',
    (_name, input, expected) => {
      const doc = ScriptDocumentSchema.parse(minimalScript());
      doc.pages[0]!.onEnter = [ActionSchema.parse(input)];
      const base = '/pages/0/onEnter/0/';
      expect(collect(doc, []).refs.filter((ref) => ref.path.startsWith(base))).toEqual(
        expected.map((ref) => ({ ...ref, path: base + ref.path, context: 'page:home' })),
      );
    },
  );
  it('does not treat nested literal objects and arrays as expressions', () => {
    const doc = ScriptDocumentSchema.parse(minimalScript());
    doc.pages[0]!.onEnter = [
      ActionSchema.parse({
        type: 'setVariable',
        variable: 'answer',
        value: { label: 'vars.customer', nested: [null, true, 0] },
      }),
    ];
    expect(collect(doc, []).refs.filter((ref) => ref.path.startsWith('/pages/0/onEnter'))).toEqual([
      {
        kind: 'variableWrite',
        id: 'answer',
        literal: { label: 'vars.customer', nested: [null, true, 0] },
        path: '/pages/0/onEnter/0/variable',
        context: 'page:home',
      },
    ]);
  });
  it('distinguishes display labels, identifiers, expression reads and two-way writes', () => {
    const input = minimalScript();
    input.pages[0]!.layout = {
      id: 'root',
      type: 'box',
      props: {
        rowKey: 'row.id',
        itemKey: 'item.id',
        iconKey: 'icon.id',
        labelKey: 'label.name',
        title: 'Literal title',
        count: 12,
      },
      bindings: [
        { prop: 'value', variable: 'answer' },
        { prop: 'disabled', expression: 'vars.customer' },
      ],
      a11y: { labelKey: 'a11y.label', descriptionKey: 'a11y.description' },
      visibleWhen: { $rule: 'visible' },
      enabledWhen: { $expr: 'vars.customer' },
      requiredWhen: { $rule: 'required' },
      children: [{ id: 'child', type: 'text', props: { text: 'Literal child' } }],
    };
    const result = collect(ScriptDocumentSchema.parse(input), ['title', 'text']);
    expect(result.refs.filter((ref) => ref.path.startsWith('/pages/0/layout'))).toEqual([
      {
        kind: 'i18n',
        id: 'label.name',
        path: '/pages/0/layout/props/labelKey',
        context: 'page:home',
      },
      {
        kind: 'variableWrite',
        id: 'answer',
        path: '/pages/0/layout/bindings/0/variable',
        context: 'page:home',
      },
      {
        kind: 'variableRead',
        id: 'customer',
        path: '/pages/0/layout/bindings/1/expression',
        context: 'page:home',
      },
      {
        kind: 'rule',
        id: 'visible',
        path: '/pages/0/layout/visibleWhen/$rule',
        context: 'page:home',
      },
      {
        kind: 'variableRead',
        id: 'customer',
        path: '/pages/0/layout/enabledWhen/$expr',
        context: 'page:home',
      },
      {
        kind: 'rule',
        id: 'required',
        path: '/pages/0/layout/requiredWhen/$rule',
        context: 'page:home',
      },
      {
        kind: 'i18n',
        id: 'a11y.label',
        path: '/pages/0/layout/a11y/labelKey',
        context: 'page:home',
      },
      {
        kind: 'i18n',
        id: 'a11y.description',
        path: '/pages/0/layout/a11y/descriptionKey',
        context: 'page:home',
      },
    ]);
    expect(result.literalText).toEqual([
      { path: '/pages/0/layout/props/title', prop: 'title' },
      { path: '/pages/0/layout/children/0/props/text', prop: 'text' },
    ]);
    expect(result.nodes.map(({ node, ...rest }) => ({ id: node.id, ...rest }))).toEqual([
      { id: 'root', path: '/pages/0/layout', depth: 1, pageId: 'home' },
      { id: 'child', path: '/pages/0/layout/children/0', depth: 2, pageId: 'home' },
    ]);
  });
});

it('preserves global, flow and subflow contexts, including nested predicates and data mappings', () => {
  const input = minimalScript();
  input.dataSources = [
    {
      id: 'lookup',
      ref: 'tenant-datasource:lookup',
      version: 1,
      inputs: { customer: { $expr: 'vars.customer' }, literal: 42 },
      outputs: { answer: { path: '$.answer', variable: 'answer' }, ignored: { path: '$.ignored' } },
    },
  ];
  input.rules = [
    {
      id: 'rule',
      when: {
        all: [
          { fact: 'vars.customer', op: 'exists' },
          { any: [{ $expr: 'ds.lookup.answer > 0' }, { not: { $expr: 'vars.blocked' } }] },
        ],
      },
      then: [{ type: 'setVariable', variable: 'answer', value: 1 }],
      else: [{ type: 'runSubflow', flow: 'child' }],
    },
  ];
  input.subflows = [
    {
      id: 'child',
      start: 'set',
      nodes: [
        {
          id: 'set',
          type: 'setVariable',
          variable: 'answer',
          value: { $expr: 'vars.customer' },
          labelKey: 'flow.set',
        },
        { id: 'literal', type: 'setVariable', variable: 'answer', value: false },
        { id: 'service', type: 'dataSource', dataSource: 'lookup' },
        { id: 'nested', type: 'subflow', flow: 'nested' },
        { id: 'transfer', type: 'transfer', target: 'sales', reasonKey: 'reason.sales' },
        { id: 'decision', type: 'decision' },
        { id: 'end', type: 'end' },
      ],
      edges: [{ id: 'edge', from: 'set', to: 'end', when: { $rule: 'rule' } }],
    },
  ];
  const refs = collect(ScriptDocumentSchema.parse(input), []).refs;
  expect(refs.filter((ref) => ref.path.startsWith('/dataSources'))).toEqual([
    {
      kind: 'variableRead',
      id: 'customer',
      path: '/dataSources/0/inputs/customer/$expr',
      context: 'rules',
    },
    {
      kind: 'variableWrite',
      id: 'answer',
      path: '/dataSources/0/outputs/answer/variable',
      context: 'rules',
    },
  ]);
  expect(refs.filter((ref) => ref.path.startsWith('/subflows'))).toEqual([
    { kind: 'i18n', id: 'flow.set', path: '/subflows/0/nodes/0/labelKey', context: 'flow:child' },
    {
      kind: 'variableWrite',
      id: 'answer',
      path: '/subflows/0/nodes/0/variable',
      context: 'flow:child',
    },
    {
      kind: 'variableRead',
      id: 'customer',
      path: '/subflows/0/nodes/0/value/$expr',
      context: 'flow:child',
    },
    {
      kind: 'variableWrite',
      id: 'answer',
      literal: false,
      path: '/subflows/0/nodes/1/variable',
      context: 'flow:child',
    },
    {
      kind: 'dataSource',
      id: 'lookup',
      path: '/subflows/0/nodes/2/dataSource',
      context: 'flow:child',
    },
    { kind: 'subflow', id: 'nested', path: '/subflows/0/nodes/3/flow', context: 'flow:child' },
    {
      kind: 'i18n',
      id: 'reason.sales',
      path: '/subflows/0/nodes/4/reasonKey',
      context: 'flow:child',
    },
    { kind: 'rule', id: 'rule', path: '/subflows/0/edges/0/when/$rule', context: 'flow:child' },
  ]);
  expect(refs.filter((ref) => ref.path.startsWith('/rules'))).toEqual([
    { kind: 'variableRead', id: 'customer', path: '/rules/0/when/all/0/fact', context: 'rules' },
    {
      kind: 'dataSource',
      id: 'lookup',
      field: 'answer',
      path: '/rules/0/when/all/1/any/0/$expr',
      context: 'rules',
    },
    {
      kind: 'variableRead',
      id: 'blocked',
      path: '/rules/0/when/all/1/any/1/not/$expr',
      context: 'rules',
    },
    {
      kind: 'variableWrite',
      id: 'answer',
      literal: 1,
      path: '/rules/0/then/0/variable',
      context: 'rules',
    },
    { kind: 'subflow', id: 'child', path: '/rules/0/else/0/flow', context: 'rules' },
  ]);
});
