import { describe, expect, it } from 'vitest';

import { minimalScript } from '../fixtures/minimal.js';
import { ScriptDocumentSchema } from '../schema/document.js';

import { dataMap, newDataFlows } from './data-map.js';

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
