import { useEffect, useMemo } from 'react';

import { Runtime, ScriptRenderer, type RendererProps } from '@verbis/core-runtime';
import { en, tr } from '@verbis/i18n';
import { NodeSchema, ScriptDocumentSchema, type NodeInput } from '@verbis/script-schema';

import { createComponentRegistry, LIBRARY_DEFINITIONS } from './catalog.js';
import { ComponentProvider } from './environment.js';

function flat(input: object, prefix = 'components'): Record<string, string> {
  return Object.fromEntries(
    (Object.entries(input) as [string, unknown][]).flatMap(([key, value]) =>
      typeof value === 'string'
        ? [[`${prefix}.${key}`, value]]
        : typeof value === 'object' && value !== null
          ? Object.entries(flat(value, `${prefix}.${key}`))
          : [],
    ),
  );
}
export function sampleProps(type: string): Record<string, unknown> {
  const common = {
    labelKey: 'components.field',
    titleKey: 'components.sample.title',
    descriptionKey: 'components.sample.description',
  };
  if (['tcknInput', 'vknInput', 'ibanInput', 'creditCardInput'].includes(type)) return common;
  if (['scriptText', 'richContent', 'text', 'heading', 'alert', 'callout'].includes(type))
    return {
      ...common,
      textKey: 'components.sample.script',
      mustRead: type === 'scriptText',
      blocks:
        type === 'richContent'
          ? [
              { tag: 'strong', textKey: 'components.sample.title' },
              { tag: 'p', textKey: 'components.sample.script' },
            ]
          : [],
    };
  if (['tabs', 'accordion', 'stepper', 'wizard'].includes(type))
    return {
      ...common,
      items: [
        { value: 'first', labelKey: 'components.sample.first' },
        { value: 'second', labelKey: 'components.sample.second' },
      ],
    };
  if (type === 'repeater') return { ...common, arrayVariable: 'items' };
  if (
    [
      'lookup',
      'autoComplete',
      'dataGrid',
      'table',
      'keyValueList',
      'customerCard',
      'timeline',
      'chart',
    ].includes(type)
  )
    return {
      ...common,
      ds: 'lookup',
      trigger: 'manual',
      columns: [
        { field: 'name', labelKey: 'components.sample.first' },
        { field: 'amount', labelKey: 'components.value' },
      ],
      labelField: 'name',
      valueField: type === 'chart' ? 'amount' : 'id',
    };
  if (
    [
      'select',
      'multiSelect',
      'radioGroup',
      'checkboxGroup',
      'checkbox',
      'toggle',
      'dispositionPicker',
      'buttonGroup',
      'objectionHandler',
      'checklist',
    ].includes(type)
  )
    return {
      ...common,
      options: [
        {
          value: 'first',
          labelKey: 'components.sample.first',
          responseKey: 'components.sample.answer',
        },
        {
          value: 'second',
          labelKey: 'components.sample.second',
          responseKey: 'components.sample.answer',
        },
      ],
    };
  if (type === 'signature') return common;
  return common;
}
export function fixtureDocument(type: string): unknown {
  const definition = LIBRARY_DEFINITIONS.find((d) => d.type === type);
  if (!definition) throw new Error('Unknown fixture component');
  const bound = [
    'textInput',
    'textArea',
    'maskedInput',
    'phoneInput',
    'emailInput',
    'currencyInput',
    'numberInput',
    'datePicker',
    'timePicker',
    'rating',
    'slider',
    'toggle',
    'checkbox',
    'select',
    'multiSelect',
    'radioGroup',
    'checkboxGroup',
    'addressInput',
    'note',
    'signature',
    'tcknInput',
    'vknInput',
    'ibanInput',
    'creditCardInput',
    'explicitConsent',
  ].includes(type);
  const numeric = ['currencyInput', 'numberInput', 'rating', 'slider'].includes(type),
    bool = ['toggle', 'checkbox', 'explicitConsent'].includes(type),
    array = ['multiSelect', 'checkboxGroup'].includes(type),
    object = type === 'addressInput';
  const node: NodeInput = {
    id: 'sample',
    type,
    props: sampleProps(type) as NodeInput['props'],
    bindings: bound ? [{ prop: 'value', variable: 'field' }] : [],
    events: {},
  };
  if (definition.designerMeta.acceptsChildren === '*')
    node.children = [
      {
        id: 'child-first',
        type: 'scriptText',
        props: {
          textKey: 'components.sample.script',
          ...(type === 'repeater' ? { itemPath: 'name' } : {}),
        },
      },
      {
        id: 'child-second',
        type: 'textInput',
        props: {
          labelKey: 'components.field',
          ...(type === 'repeater' ? { itemPath: 'name' } : {}),
        },
      },
    ];
  return {
    schemaVersion: '1.1.0',
    id: '01928f3a-0000-7000-8000-0000000000ff',
    meta: { name: 'Component fixture' },
    variables: [
      { key: 'name', type: 'string', scope: 'session', default: 'Demo', classification: 'public' },
      { key: 'query', type: 'string', scope: 'session', default: '', classification: 'public' },
      {
        key: 'field',
        type: numeric
          ? 'number'
          : bool
            ? 'boolean'
            : array
              ? 'array'
              : object
                ? 'object'
                : 'string',
        scope: 'session',
        default: numeric ? 3 : bool ? false : array ? [] : object ? {} : '',
        classification: type === 'creditCardInput' ? 'pci' : 'public',
        pii: type === 'creditCardInput',
      },
      {
        key: 'items',
        type: 'array',
        scope: 'session',
        default: [
          { id: 'first', name: 'Demo A' },
          { id: 'second', name: 'Demo B' },
        ],
        classification: 'public',
      },
    ],
    dataSources: [
      {
        id: 'lookup',
        ref: 'tenant-datasource:lookup',
        version: 1,
        inputs: { query: { $expr: 'vars.query' } },
        outputs: { rows: { path: '$.rows' } },
      },
    ],
    pages: [
      {
        id: 'home',
        name: 'Home',
        layout: { id: 'page-root', type: 'box', children: [node] },
        timers: [
          {
            id: 'clock',
            durationMs: 60000,
            onElapsed: [{ type: 'setVariable', variable: 'name', value: 'Demo' }],
          },
        ],
      },
    ],
    flow: {
      id: 'main',
      start: 'page',
      nodes: [
        { id: 'page', type: 'page', page: 'home' },
        { id: 'end', type: 'end' },
      ],
      edges: [{ id: 'done', from: 'page', to: 'end' }],
    },
    i18n: { defaultLocale: 'tr', messages: { tr: flat(tr.components), en: flat(en.components) } },
  };
}
export function createFixtureRuntime(type: string): Runtime {
  return new Runtime({
    document: ScriptDocumentSchema.parse(fixtureDocument(type)),
    registry: createComponentRegistry(),
    ports: {
      sessionEvent: () => undefined,
      dataSource: () =>
        Promise.resolve({
          rows: [
            { id: 'first', name: 'Demo A', amount: 12, date: '2026-10-02', description: 'Demo' },
            { id: 'second', name: 'Demo B', amount: 24, date: '2026-10-02', description: 'Demo' },
          ],
        }),
      command: () => Promise.resolve(),
    },
    simulation: true,
    simulationPorts: {
      dataSource: () =>
        Promise.resolve({
          rows: [
            { id: 'first', name: 'Demo A', amount: 12 },
            { id: 'second', name: 'Demo B', amount: 24 },
          ],
        }),
    },
  });
}
export function ComponentExample({
  type,
  props = {},
}: {
  type: string;
  props?: Record<string, unknown>;
}) {
  const key = JSON.stringify(props);
  const runtime = useMemo(() => {
    const doc = ScriptDocumentSchema.parse(fixtureDocument(type));
    const page = doc.pages[0];
    if (!page) throw new Error('VERBIS_FIXTURE_PAGE');
    const layout = NodeSchema.parse(page.layout);
    Object.assign(layout.children?.[0]?.props ?? {}, JSON.parse(key) as unknown);
    page.layout = layout;
    const instance = new Runtime({
      document: doc,
      registry: createComponentRegistry(),
      ports: { sessionEvent: () => undefined },
      simulation: true,
      simulationPorts: {
        dataSource: () =>
          Promise.resolve({
            rows: [
              { id: 'first', name: 'Demo A', amount: 12 },
              { id: 'second', name: 'Demo B', amount: 24 },
            ],
          }),
      },
    });
    instance.executor.debugger.resume();
    return instance;
  }, [type, key]);
  useEffect(
    () => () => {
      runtime.dispose();
    },
    [runtime],
  );
  return (
    <ComponentProvider
      environment={{
        mediaOrigins: [],
        frameOrigins: [],
        knowledgeOrigins: [],
        features: ['signature'],
        now: () => Date.now(),
        scheduleCallback: () => Promise.resolve(),
      }}
    >
      <ScriptRenderer runtime={runtime} />
    </ComponentProvider>
  );
}
export function syntheticRendererProps(runtime: Runtime, type: string): RendererProps {
  const page = runtime.page('home'),
    node = page.layout.children?.[0];
  if (!node) throw new Error('Missing fixture node');
  return {
    runtime,
    node,
    props: runtime.registry
      .get(type)
      .propsSchema.parse({ ...runtime.registry.get(type).defaults, ...node.props }),
    enabled: true,
    required: false,
    emit: () => Promise.resolve(),
    write: (prop, value) => {
      const binding = node.bindings.find((b) => b.prop === prop && 'variable' in b);
      if (binding && 'variable' in binding) runtime.store.setVariable(binding.variable, value);
    },
  };
}
