import { describe, expect, it } from 'vitest';

import { minimalScript } from '../fixtures/minimal.js';
import { ScriptDocumentSchema } from '../schema/document.js';

import { dataMap, newDataFlows, type DataDestination, type DataMapEntry } from './data-map.js';

function document(edit: (doc: Record<string, unknown> & ReturnType<typeof minimalScript>) => void) {
  const input = minimalScript() as Record<string, unknown> & ReturnType<typeof minimalScript>;
  input.variables = [
    {
      key: 'tckn',
      type: 'string',
      scope: 'session',
      classification: 'pii',
      source: 'interaction.attributes.tckn',
    },
    { key: 'pan', type: 'string', scope: 'session', classification: 'pci' },
    { key: 'segment', type: 'string', scope: 'session', classification: 'internal' },
    { key: 'email', type: 'string', scope: 'session', pii: true, persist: true },
  ];
  edit(input);
  return ScriptDocumentSchema.parse(input);
}

describe('dataMap', () => {
  it('lists only personal and card data, with origins and persistence', () => {
    const map = dataMap(
      document((doc) => {
        doc.pages[0]!.layout.children = [
          {
            id: 'email-input',
            type: 'textInput',
            props: { labelKey: 'common.next' },
            bindings: [{ prop: 'value', variable: 'email' }],
          },
        ];
      }),
    );
    expect(map.map((entry) => [entry.variable, entry.classification, entry.persisted])).toEqual([
      ['tckn', 'pii', false],
      ['pan', 'pci', false],
      ['email', 'pii', true],
    ]);
    expect(map[0]?.origins).toEqual([{ kind: 'context', path: 'interaction.attributes.tckn' }]);
    expect(map[2]?.origins).toEqual([{ kind: 'agentInput', node: 'email-input' }]);
  });

  it('finds every destination, including integrations that receive the value', () => {
    const map = dataMap(
      document((doc) => {
        doc.dataSources = [
          {
            id: 'crm',
            ref: 'tenant-datasource:crm',
            version: 1,
            inputs: { customerId: { $expr: 'vars.tckn' } },
            outputs: { mail: { path: '$.email', variable: 'email' } },
          },
          { id: 'fraud', ref: 'tenant-datasource:fraud', version: 1, outputs: {} },
        ];
        doc.pages[0]!.layout.children = [
          {
            id: 'show',
            type: 'text',
            bindings: [{ prop: 'text', expression: 'vars.tckn' }],
          },
          {
            id: 'btn',
            type: 'button',
            props: { labelKey: 'common.next' },
            events: {
              onPress: [
                {
                  type: 'callDataSource',
                  dataSource: 'fraud',
                  inputs: { id: { $expr: 'vars.tckn' } },
                },
                { type: 'writeBackToPlatform', attributes: { national: { $expr: 'vars.tckn' } } },
                {
                  type: 'logEvent',
                  event: 'customer.checked',
                  data: { who: { $expr: 'vars.tckn' } },
                },
              ],
            },
          },
        ];
      }),
    );
    const tckn = map.find((entry) => entry.variable === 'tckn')!;
    expect(
      tckn.destinations
        .map((d) => (d.kind === 'integration' ? `integration:${d.id}` : d.kind))
        .sort(),
    ).toEqual(['integration:crm', 'integration:fraud', 'log', 'platform', 'screen']);
    const email = map.find((entry) => entry.variable === 'email')!;
    expect(email.origins).toEqual([{ kind: 'dataSource', id: 'crm' }]);
  });

  it('is empty for a script without sensitive data', () => {
    expect(dataMap(ScriptDocumentSchema.parse(minimalScript()))).toEqual([]);
  });
});

describe('newDataFlows', () => {
  it('reports destinations a new version adds, once per variable and target', () => {
    const before = dataMap(document(() => undefined));
    const after = dataMap(
      document((doc) => {
        doc.pages[0]!.layout.children = [
          {
            id: 'btn',
            type: 'button',
            props: { labelKey: 'common.next' },
            events: {
              onPress: [
                { type: 'emitEvent', name: 'seen', payload: { a: { $expr: 'vars.tckn' } } },
                { type: 'emitEvent', name: 'again', payload: { b: { $expr: 'vars.tckn' } } },
              ],
            },
          },
        ];
      }),
    );
    expect(newDataFlows(before, after)).toEqual([
      { variable: 'tckn', destination: expect.objectContaining({ kind: 'analytics' }) as unknown },
    ]);
    expect(newDataFlows(after, after)).toEqual([]);
  });
});

describe('dataMap precision', () => {
  const press = (actions: unknown[]) => [
    {
      id: 'btn',
      type: 'button',
      props: { labelKey: 'common.next' },
      events: { onPress: actions },
    },
  ];

  it('reports each sink kind with its exact location and nothing for plain internal reads', () => {
    const map = dataMap(
      document((doc) => {
        doc.pages[0]!.layout.children = press([
          { type: 'showToast', messageKey: 'common.next', params: { who: { $expr: 'vars.tckn' } } },
          { type: 'logEvent', event: 'checked', data: { who: { $expr: 'vars.tckn' } } },
          { type: 'emitEvent', name: 'seen', payload: { who: { $expr: 'vars.tckn' } } },
          { type: 'writeBackToPlatform', attributes: { who: { $expr: 'vars.tckn' } } },
          { type: 'setVariable', variable: 'segment', value: { $expr: 'vars.segment' } },
        ]) as never;
      }),
    );
    const prefix = '/pages/0/layout/children/0/events/onPress';
    expect(map.find((entry) => entry.variable === 'tckn')?.destinations).toEqual([
      { kind: 'toast', path: `${prefix}/0/params/who/$expr` },
      { kind: 'log', path: `${prefix}/1/data/who/$expr` },
      { kind: 'analytics', path: `${prefix}/2/payload/who/$expr` },
      { kind: 'platform', path: `${prefix}/3/attributes/who/$expr` },
    ]);
    expect(map.find((entry) => entry.variable === 'pan')?.destinations).toEqual([]);
  });

  it('marks a variable computed by a script action, but not one set by bindings or outputs', () => {
    const map = dataMap(
      document((doc) => {
        doc.dataSources = [
          {
            id: 'crm',
            ref: 'tenant-datasource:crm',
            version: 1,
            outputs: { mail: { path: '$.email', variable: 'email' } },
          },
        ] as never;
        doc.pages[0]!.layout.children = [
          {
            id: 'pan-input',
            type: 'textInput',
            props: { labelKey: 'common.next' },
            bindings: [{ prop: 'value', variable: 'pan' }],
            events: { onPress: [{ type: 'setVariable', variable: 'tckn', value: 'x' }] },
          },
        ] as never;
      }),
    );
    expect(map.find((entry) => entry.variable === 'pan')?.origins).toEqual([
      { kind: 'agentInput', node: 'pan-input' },
    ]);
    expect(map.find((entry) => entry.variable === 'tckn')?.origins).toEqual([
      { kind: 'context', path: 'interaction.attributes.tckn' },
      { kind: 'script' },
    ]);
    expect(map.find((entry) => entry.variable === 'email')?.origins).toEqual([
      { kind: 'dataSource', id: 'crm' },
    ]);
  });

  it('attributes a data source input to that data source by position, and an action input to its target', () => {
    const map = dataMap(
      document((doc) => {
        doc.dataSources = [
          { id: 'first', ref: 'tenant-datasource:first', version: 1, outputs: {} },
          {
            id: 'second',
            ref: 'tenant-datasource:second',
            version: 1,
            inputs: { id: { $expr: 'vars.tckn' } },
            outputs: {},
          },
        ] as never;
        doc.pages[0]!.layout.children = press([
          {
            type: 'callDataSource',
            dataSource: 'first',
            inputs: { id: { $expr: 'vars.pan' } },
          },
        ]) as never;
      }),
    );
    expect(map.find((entry) => entry.variable === 'tckn')?.destinations).toEqual([
      { kind: 'integration', id: 'second', path: '/dataSources/1/inputs/id/$expr' },
    ]);
    expect(map.find((entry) => entry.variable === 'pan')?.destinations).toEqual([
      {
        kind: 'integration',
        id: 'first',
        path: '/pages/0/layout/children/0/events/onPress/0/inputs/id/$expr',
      },
    ]);
  });
});

describe('newDataFlows precision', () => {
  const entry = (variable: string, destinations: DataDestination[]): DataMapEntry => ({
    variable,
    classification: 'pii',
    origins: [],
    destinations,
    persisted: false,
  });
  const to = (id: string, path = '/p'): DataDestination => ({ kind: 'integration', id, path });

  it('tells integrations apart by id and reports a new integration once', () => {
    const before = [entry('tckn', [to('crm')])];
    const after = [entry('tckn', [to('crm', '/q'), to('fraud', '/a'), to('fraud', '/b')])];
    expect(newDataFlows(before, after)).toEqual([
      { variable: 'tckn', destination: to('fraud', '/a') },
    ]);
  });

  it('reports everything for a variable that did not exist before, and nothing when destinations vanish', () => {
    const screen: DataDestination = { kind: 'screen', path: '/s' };
    expect(newDataFlows([], [entry('pan', [screen, to('crm')])])).toEqual([
      { variable: 'pan', destination: screen },
      { variable: 'pan', destination: to('crm') },
    ]);
    expect(newDataFlows([entry('pan', [screen])], [entry('pan', [])])).toEqual([]);
  });
});
