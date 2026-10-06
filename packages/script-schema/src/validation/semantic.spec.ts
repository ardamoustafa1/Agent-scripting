import { describe, expect, it } from 'vitest';

import { minimalScript } from '../fixtures/minimal.js';
import { ScriptDocumentSchema } from '../schema/document.js';
import { applyJsonPatch, type JsonPatchOperation } from '../tree/json-patch.js';

import { literalMatchesType, validateSemantics, type SemanticOptions } from './semantic.js';

import type { ValidationIssue } from './issues.js';
import type { Variable } from '../schema/variable.js';

const BUTTON = '/pages/0/layout/children/0';
const ON_PRESS = `${BUTTON}/events/onPress/-`;

function check(
  operations: readonly JsonPatchOperation[],
  options?: SemanticOptions,
): ValidationIssue[] {
  return validateSemantics(
    ScriptDocumentSchema.parse(applyJsonPatch(minimalScript(), operations)),
    options,
  );
}
const codes = (issues: readonly ValidationIssue[]) => issues.map((issue) => issue.code);

const variable = (value: Record<string, unknown>): JsonPatchOperation => ({
  op: 'add',
  path: '/variables/-',
  value,
});
const withVariables: JsonPatchOperation = { op: 'add', path: '/variables', value: [] };
const page = (id: string): JsonPatchOperation => ({
  op: 'add',
  path: '/pages/-',
  value: { id, name: id, layout: { id: `${id}-root`, type: 'box' } },
});

describe('validateSemantics', () => {
  it('accepts the minimal document', () => {
    expect(check([])).toEqual([]);
  });

  describe('limits', () => {
    it('reports size, node count and depth', () => {
      expect(codes(check([], { limits: { maxBytes: 100 } }))).toEqual(['DOCUMENT_TOO_LARGE']);
      expect(codes(check([], { limits: { maxNodes: 1 } }))).toEqual(['NODE_COUNT_EXCEEDED']);
      expect(check([], { limits: { maxNodeDepth: 1 } })).toEqual([
        expect.objectContaining({
          code: 'NODE_DEPTH_EXCEEDED',
          path: BUTTON,
          params: { depth: 2, max: 1 },
        }),
      ]);
    });
  });

  describe('DUPLICATE_ID', () => {
    it.each<[string, JsonPatchOperation[], string]>([
      [
        'page',
        [
          {
            op: 'add',
            path: '/pages/-',
            value: { id: 'home', name: 'Again', layout: { id: 'other-root', type: 'box' } },
          },
        ],
        '/pages/1/id',
      ],
      [
        'node',
        [
          {
            op: 'add',
            path: '/pages/0/layout/children/-',
            value: { id: 'btn-next', type: 'text' },
          },
        ],
        '/pages/0/layout/children/1/id',
      ],
      [
        'variable',
        [
          withVariables,
          variable({ key: 'a', type: 'string', scope: 'session' }),
          variable({ key: 'a', type: 'number', scope: 'session' }),
        ],
        '/variables/1/key',
      ],
      [
        'dataSource',
        [
          { op: 'add', path: '/dataSources', value: [] },
          {
            op: 'add',
            path: '/dataSources/-',
            value: { id: 'x', ref: 'tenant-datasource:x', version: 1 },
          },
          {
            op: 'add',
            path: '/dataSources/-',
            value: { id: 'x', ref: 'tenant-datasource:y', version: 1 },
          },
        ],
        '/dataSources/1/id',
      ],
      [
        'rule',
        [
          {
            op: 'add',
            path: '/rules',
            value: [
              { id: 'r', when: { $expr: 'true' } },
              { id: 'r', when: { $expr: 'false' } },
            ],
          },
        ],
        '/rules/1/id',
      ],
      [
        'flow',
        [
          {
            op: 'add',
            path: '/subflows',
            value: [{ id: 'main', start: 's', nodes: [{ id: 's', type: 'end' }] }],
          },
        ],
        '/subflows/0/id',
      ],
      [
        'flowNode',
        [{ op: 'add', path: '/flow/nodes/-', value: { id: 'n-end', type: 'end' } }],
        '/flow/nodes/2/id',
      ],
      [
        'flowEdge',
        [{ op: 'add', path: '/flow/edges/-', value: { id: 'e1', from: 'n-home', to: 'n-end' } }],
        '/flow/edges/1/id',
      ],
      [
        'timer',
        [
          {
            op: 'add',
            path: '/pages/0/timers',
            value: [
              { id: 't', durationMs: 1000, onElapsed: [{ type: 'next' }] },
              { id: 't', durationMs: 2000, onElapsed: [{ type: 'next' }] },
            ],
          },
        ],
        '/pages/0/timers/1/id',
      ],
    ])('detects duplicate %s ids', (kind, operations, path) => {
      const duplicate = check(operations).find((issue) => issue.code === 'DUPLICATE_ID');
      expect(duplicate?.path).toBe(path);
      expect(duplicate?.params?.['kind']).toBe(kind);
    });
  });

  describe('variables', () => {
    it('reports undefined variables from every reference site', () => {
      const issues = check([
        {
          op: 'add',
          path: `${BUTTON}/bindings`,
          value: [{ prop: 'disabled', expression: 'vars.busy' }],
        },
        {
          op: 'add',
          path: '/pages/0/layout/children/-',
          value: { id: 'in-x', type: 'textInput', bindings: [{ variable: 'typed' }] },
        },
        {
          op: 'add',
          path: '/flow/nodes/-',
          value: { id: 'n-set', type: 'setVariable', variable: 'flowVar', value: 1 },
        },
        { op: 'add', path: '/flow/edges/-', value: { id: 'e2', from: 'n-set', to: 'n-end' } },
        { op: 'replace', path: '/flow/edges/0/to', value: 'n-set' },
        {
          op: 'add',
          path: '/dataSources',
          value: [
            {
              id: 'lookup',
              ref: 'tenant-datasource:lookup',
              version: 1,
              inputs: { q: { $expr: 'vars.query' } },
              outputs: { name: { path: '$.name', variable: 'outVar' } },
            },
          ],
        },
        {
          op: 'add',
          path: '/rules',
          value: [{ id: 'r', when: { fact: 'vars.factVar', op: 'exists' } }],
        },
      ]);
      expect(
        issues
          .filter((issue) => issue.code === 'VARIABLE_UNDEFINED')
          .map((issue) => issue.params?.['variable']),
      ).toEqual(['busy', 'typed', 'query', 'outVar', 'flowVar', 'factVar']);
    });

    it('rejects writes to global constants', () => {
      const issues = check([
        withVariables,
        variable({ key: 'limit', type: 'number', scope: 'global', default: 5 }),
        {
          op: 'add',
          path: ON_PRESS,
          value: { type: 'setVariable', variable: 'limit', value: { $expr: 'vars.limit + 1' } },
        },
        { op: 'add', path: `${BUTTON}/bindings`, value: [{ variable: 'limit' }] },
      ]);
      expect(codes(issues)).toEqual(['VARIABLE_READONLY', 'VARIABLE_READONLY']);
    });

    it('type-checks literal assignments and defaults, never expressions', () => {
      const issues = check([
        withVariables,
        variable({ key: 'count', type: 'number', scope: 'session', default: 'zero' }),
        {
          op: 'add',
          path: ON_PRESS,
          value: { type: 'setVariable', variable: 'count', value: 'one' },
        },
        {
          op: 'add',
          path: ON_PRESS,
          value: { type: 'setVariable', variable: 'count', value: null },
        },
        {
          op: 'add',
          path: ON_PRESS,
          value: { type: 'setVariable', variable: 'count', value: { $expr: "'text'" } },
        },
      ]);
      expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
        ['VARIABLE_TYPE_MISMATCH', '/variables/0/default'],
        ['VARIABLE_TYPE_MISMATCH', `${BUTTON}/events/onPress/1/variable`],
      ]);
    });

    it('checks enum values, PCI persistence and classification consistency', () => {
      const issues = check([
        withVariables,
        variable({ key: 'plan', type: 'enum', scope: 'session' }),
        variable({
          key: 'pan',
          type: 'string',
          scope: 'page',
          classification: 'pci',
          pii: true,
          persist: true,
        }),
        variable({ key: 'name', type: 'string', scope: 'session', classification: 'pii' }),
        variable({ key: 'flag', type: 'boolean', scope: 'session', pii: true }),
      ]);
      expect(codes(issues)).toEqual([
        'VARIABLE_ENUM_VALUES_MISSING',
        'VARIABLE_PCI_PERSISTED',
        'VARIABLE_CLASSIFICATION_MISMATCH',
        'VARIABLE_CLASSIFICATION_MISMATCH',
      ]);
      expect(issues[2]?.severity).toBe('warning');
    });

    it('flags classified data sent to sinks', () => {
      const issues = check([
        withVariables,
        variable({
          key: 'name',
          type: 'string',
          scope: 'session',
          classification: 'pii',
          pii: true,
        }),
        variable({ key: 'pan', type: 'string', scope: 'page', classification: 'pci', pii: true }),
        {
          op: 'add',
          path: ON_PRESS,
          value: { type: 'logEvent', event: 'a', data: { n: { $expr: 'vars.name' } } },
        },
        {
          op: 'add',
          path: ON_PRESS,
          value: { type: 'emitEvent', name: 'a', payload: { n: { $expr: 'vars.name' } } },
        },
        {
          op: 'add',
          path: ON_PRESS,
          value: { type: 'writeBackToPlatform', attributes: { n: { $expr: 'vars.name' } } },
        },
        {
          op: 'add',
          path: ON_PRESS,
          value: { type: 'submitOutcome', outcome: 'OK', notes: { $expr: 'vars.name' } },
        },
        {
          op: 'add',
          path: ON_PRESS,
          value: {
            type: 'showToast',
            messageKey: 'common.next',
            params: { p: { $expr: 'vars.pan' } },
          },
        },
      ]);
      expect(issues.map((issue) => [issue.severity, issue.params?.['sink']])).toEqual([
        ['warning', 'log'],
        ['warning', 'analytics'],
        ['error', 'display'],
      ]);
    });
  });

  describe('components, bindings and i18n', () => {
    it('reports unknown component types; registry and options extend the known set', () => {
      const op: JsonPatchOperation = {
        op: 'add',
        path: '/pages/0/layout/children/-',
        value: { id: 'gauge', type: 'acme.gauge' },
      };
      expect(check([op])).toEqual([
        expect.objectContaining({
          code: 'COMPONENT_TYPE_UNKNOWN',
          path: '/pages/0/layout/children/1/type',
        }),
      ]);
      expect(
        check([
          op,
          {
            op: 'add',
            path: '/componentRegistry',
            value: [{ type: 'acme.gauge', version: '1.0.0', integrity: 'sha256-abc' }],
          },
        ]),
      ).toEqual([]);
      expect(codes(check([], { componentTypes: ['box'] }))).toEqual(['COMPONENT_TYPE_UNKNOWN']);
    });

    it('reports duplicate bound props', () => {
      const issues = check([
        withVariables,
        variable({ key: 'a', type: 'string', scope: 'session' }),
        {
          op: 'add',
          path: `${BUTTON}/bindings`,
          value: [{ variable: 'a' }, { prop: 'value', expression: 'vars.a' }],
        },
      ]);
      expect(issues).toEqual([
        expect.objectContaining({
          code: 'BINDING_DUPLICATE_PROP',
          path: `${BUTTON}/bindings/1/prop`,
        }),
      ]);
    });

    it('rejects literal text props (configurable)', () => {
      const op: JsonPatchOperation = { op: 'add', path: `${BUTTON}/props/label`, value: 'Next' };
      expect(codes(check([op]))).toEqual(['I18N_LITERAL_TEXT']);
      expect(check([op], { literalTextProps: ['caption'] })).toEqual([]);
      expect(check([{ op: 'add', path: `${BUTTON}/props/label`, value: 3 }])).toEqual([]);
    });

    it('reports missing keys from every key site', () => {
      const issues = check([
        { op: 'add', path: '/pages/0/titleKey', value: 'k.title' },
        {
          op: 'add',
          path: `${BUTTON}/a11y`,
          value: { labelKey: 'k.label', descriptionKey: 'k.desc' },
        },
        { op: 'add', path: ON_PRESS, value: { type: 'showToast', messageKey: 'k.toast' } },
        {
          op: 'add',
          path: ON_PRESS,
          value: { type: 'transferHint', target: 'Q', reasonKey: 'k.reason' },
        },
        { op: 'add', path: ON_PRESS, value: { type: 'transferHint', target: 'Q' } },
        { op: 'add', path: '/flow/nodes/0/labelKey', value: 'k.flow' },
      ]);
      expect(issues.map((issue) => issue.params?.['key'])).toEqual([
        'k.title',
        'k.toast',
        'k.reason',
        'k.label',
        'k.desc',
        'k.flow',
      ]);
    });

    it('reports a missing default locale instead of every key', () => {
      expect(codes(check([{ op: 'replace', path: '/i18n/defaultLocale', value: 'de' }]))).toEqual([
        'I18N_DEFAULT_LOCALE_MISSING',
      ]);
    });

    it('summarizes untranslated keys per locale', () => {
      const issues = check([{ op: 'remove', path: '/i18n/messages/en/common.next' }]);
      expect(issues).toEqual([
        expect.objectContaining({
          code: 'I18N_TRANSLATION_MISSING',
          severity: 'warning',
          path: '/i18n/messages/en',
          params: { locale: 'en', count: 1, keys: 'common.next' },
        }),
      ]);
    });
  });

  describe('references', () => {
    it('reports broken references of every kind', () => {
      const issues = check([
        { op: 'add', path: ON_PRESS, value: { type: 'navigate', page: 'p-x' } },
        { op: 'add', path: ON_PRESS, value: { type: 'openModal', page: 'p-y' } },
        {
          op: 'add',
          path: ON_PRESS,
          value: {
            type: 'validatePage',
            page: 'p-z',
            onInvalid: [{ type: 'stopTimer', timer: 't-x' }],
          },
        },
        {
          op: 'add',
          path: ON_PRESS,
          value: {
            type: 'callDataSource',
            dataSource: 'nope',
            inputs: { a: { $expr: 'ds.gone.x' } },
          },
        },
        { op: 'add', path: ON_PRESS, value: { type: 'runSubflow', flow: 'main' } },
        { op: 'add', path: ON_PRESS, value: { type: 'maskField', node: 'n-x' } },
        { op: 'add', path: `${BUTTON}/enabledWhen`, value: { $rule: 'r-x' } },
        { op: 'add', path: `${BUTTON}/requiredWhen`, value: { $expr: 'true' } },
      ]);
      expect(codes(issues)).toEqual([
        'PAGE_REF_BROKEN',
        'PAGE_REF_BROKEN',
        'PAGE_REF_BROKEN',
        'TIMER_REF_BROKEN',
        'DATASOURCE_REF_BROKEN',
        'DATASOURCE_REF_BROKEN',
        'SUBFLOW_REF_BROKEN',
        'NODE_REF_BROKEN',
        'RULE_REF_BROKEN',
      ]);
    });

    it('checks data source fields against outputs and built-ins', () => {
      const ds: JsonPatchOperation = {
        op: 'add',
        path: '/dataSources',
        value: [
          {
            id: 'lookup',
            ref: 'tenant-datasource:lookup',
            version: 1,
            outputs: { name: { path: '$.name' } },
          },
        ],
      };
      const bind = (expression: string): JsonPatchOperation => ({
        op: 'add',
        path: `${BUTTON}/bindings`,
        value: [{ prop: 'p', expression }],
      });
      expect(check([ds, bind('ds.lookup.name + ds.lookup.status + ds.lookup')])).toEqual([]);
      expect(check([ds, bind('ds.lookup.balance')])).toEqual([
        expect.objectContaining({
          code: 'DATASOURCE_FIELD_UNKNOWN',
          params: { dataSource: 'lookup', field: 'balance' },
        }),
      ]);
    });
  });

  describe('flow graph', () => {
    it('reports a missing start without unreachable noise', () => {
      expect(codes(check([{ op: 'replace', path: '/flow/start', value: 'n-x' }]))).toEqual([
        'FLOW_START_MISSING',
        'PAGE_UNREACHABLE',
      ]);
    });

    it('reports broken edges on either end', () => {
      const issues = check([
        { op: 'add', path: '/flow/edges/-', value: { id: 'e2', from: 'n-x', to: 'n-end' } },
        { op: 'add', path: '/flow/edges/-', value: { id: 'e3', from: 'n-home', to: 'n-y' } },
      ]);
      expect(issues.map((issue) => issue.path)).toEqual(['/flow/edges/1/from', '/flow/edges/2/to']);
    });

    it('reports unreachable nodes, dead ends and missing error paths', () => {
      const issues = check([
        {
          op: 'add',
          path: '/dataSources',
          value: [{ id: 'lookup', ref: 'tenant-datasource:lookup', version: 1 }],
        },
        {
          op: 'add',
          path: '/flow/nodes/-',
          value: { id: 'n-ds', type: 'dataSource', dataSource: 'lookup' },
        },
        { op: 'add', path: '/flow/nodes/-', value: { id: 'n-orphan', type: 'decision' } },
        { op: 'replace', path: '/flow/edges/0/to', value: 'n-ds' },
        {
          op: 'add',
          path: '/flow/edges/-',
          value: { id: 'e2', from: 'n-ds', to: 'n-end', port: 'success' },
        },
      ]);
      expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
        ['FLOW_DATASOURCE_NO_ERROR_EDGE', '/flow/nodes/2'],
        ['FLOW_NODE_UNREACHABLE', '/flow/nodes/3'],
        ['FLOW_DEAD_END', '/flow/nodes/3'],
      ]);
    });

    it('rejects unbounded cycles and accepts bounded loops', () => {
      const loop: JsonPatchOperation = {
        op: 'add',
        path: '/flow/edges/-',
        value: { id: 'e-loop', from: 'n-home', to: 'n-home' },
      };
      expect(check([loop])).toEqual([
        expect.objectContaining({
          code: 'FLOW_CYCLE',
          path: '/flow/edges/1',
          params: { flow: 'main', nodes: 'n-home → n-home' },
        }),
      ]);
      expect(
        check([
          { ...loop, value: { id: 'e-loop', from: 'n-home', to: 'n-home', maxIterations: 3 } },
        ]),
      ).toEqual([]);
    });

    it('locates cycles inside subflows', () => {
      const issues = check([
        {
          op: 'add',
          path: '/subflows',
          value: [
            {
              id: 'sub',
              start: 'a',
              nodes: [
                { id: 'a', type: 'decision' },
                { id: 'b', type: 'decision' },
              ],
              edges: [
                { id: 'x1', from: 'a', to: 'b' },
                { id: 'x2', from: 'b', to: 'a' },
              ],
            },
          ],
        },
      ]);
      expect(issues).toEqual([
        expect.objectContaining({
          code: 'FLOW_CYCLE',
          path: '/subflows/0/edges/0',
          params: { flow: 'sub', nodes: 'a → b → a' },
        }),
      ]);
    });

    it('detects mutually recursive subflows', () => {
      const sub = (id: string, calls: string) => ({
        id,
        start: `${id}-call`,
        nodes: [
          { id: `${id}-call`, type: 'subflow', flow: calls },
          { id: `${id}-end`, type: 'end' },
        ],
        edges: [{ id: `${id}-e`, from: `${id}-call`, to: `${id}-end` }],
      });
      const issues = check([
        { op: 'add', path: '/subflows', value: [sub('one', 'two'), sub('two', 'one')] },
        { op: 'add', path: ON_PRESS, value: { type: 'runSubflow', flow: 'one' } },
      ]);
      expect(issues).toEqual([
        expect.objectContaining({
          code: 'SUBFLOW_CYCLE',
          path: '/subflows/0',
          params: { flows: 'one → two → one' },
        }),
      ]);
    });
  });

  describe('page reachability', () => {
    it('reaches pages through actions, modals, rules and subflows', () => {
      const issues = check([
        page('via-navigate'),
        page('via-modal'),
        page('via-rule'),
        page('via-subflow'),
        page('via-chain'),
        { op: 'add', path: ON_PRESS, value: { type: 'navigate', page: 'via-navigate' } },
        { op: 'add', path: ON_PRESS, value: { type: 'openModal', page: 'via-modal' } },
        { op: 'add', path: ON_PRESS, value: { type: 'runSubflow', flow: 'sub' } },
        { op: 'add', path: '/pages/1/onEnter', value: [{ type: 'navigate', page: 'via-chain' }] },
        {
          op: 'add',
          path: '/rules',
          value: [
            { id: 'r', when: { $expr: 'true' }, then: [{ type: 'navigate', page: 'via-rule' }] },
          ],
        },
        {
          op: 'add',
          path: '/subflows',
          value: [
            {
              id: 'sub',
              start: 's-page',
              nodes: [
                { id: 's-page', type: 'page', page: 'via-subflow' },
                { id: 's-end', type: 'end' },
              ],
              edges: [{ id: 's-e', from: 's-page', to: 's-end' }],
            },
          ],
        },
      ]);
      expect(issues).toEqual([]);
    });

    it('does not count references from unreachable pages or flow nodes', () => {
      const issues = check([
        page('island'),
        page('behind-island'),
        page('behind-dead-node'),
        {
          op: 'add',
          path: '/pages/1/onEnter',
          value: [{ type: 'navigate', page: 'behind-island' }],
        },
        {
          op: 'add',
          path: '/flow/nodes/-',
          value: { id: 'n-dead', type: 'page', page: 'behind-dead-node' },
        },
        { op: 'add', path: '/flow/edges/-', value: { id: 'e-dead', from: 'n-dead', to: 'n-end' } },
      ]);
      expect(
        issues
          .filter((issue) => issue.code === 'PAGE_UNREACHABLE')
          .map((issue) => issue.params?.['page']),
      ).toEqual(['island', 'behind-island', 'behind-dead-node']);
    });
  });
});

describe('literalMatchesType', () => {
  const v = (type: Variable['type'], enumValues?: string[]): Variable => ({
    key: 'x',
    type,
    scope: 'session',
    pii: false,
    classification: 'internal',
    persist: false,
    ...(enumValues === undefined ? {} : { enumValues }),
  });

  it.each<[Variable['type'], unknown, boolean]>([
    ['string', 'a', true],
    ['string', 1, false],
    ['number', 1.5, true],
    ['number', '1', false],
    ['boolean', false, true],
    ['boolean', 0, false],
    ['date', '2026-10-01', true],
    ['date', '2026-10-01T10:00:00Z', true],
    ['date', 'tomorrow', false],
    ['date', 20261001, false],
    ['array', [1], true],
    ['array', {}, false],
    ['object', { a: 1 }, true],
    ['object', [], false],
  ])('%s accepts %j → %s', (type, literal, expected) => {
    expect(literalMatchesType(v(type), literal as never)).toBe(expected);
  });

  it('checks enum membership and always accepts null', () => {
    expect(literalMatchesType(v('enum', ['a', 'b']), 'a')).toBe(true);
    expect(literalMatchesType(v('enum', ['a', 'b']), 'c')).toBe(false);
    expect(literalMatchesType(v('enum'), 'a')).toBe(false);
    expect(literalMatchesType(v('number'), null)).toBe(true);
  });
});

it('treats row, item and icon identity keys as metadata, not translation references', () => {
  const issues = check([
    { op: 'add', path: `${BUTTON}/props/rowKey`, value: 'customerId' },
    { op: 'add', path: `${BUTTON}/props/itemKey`, value: 'stableId' },
    { op: 'add', path: `${BUTTON}/props/iconKey`, value: 'FileText' },
  ]);
  expect(issues).toEqual([]);
});
