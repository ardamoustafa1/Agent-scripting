import { describe, expect, it } from 'vitest';

import { minimalScript } from '../fixtures/minimal.js';

import { ACTION_TYPES, ActionSchema, type ActionInput } from './actions.js';
import { DataSourceRefSchema } from './data-source.js';
import { ScriptDocumentSchema } from './document.js';
import { FlowEdgeSchema, FlowNodeSchema, FlowSchema } from './flow.js';
import { BindingSchema, NodeSchema, ResponsiveStyleSchema } from './node.js';
import { PageSchema, TimerSchema } from './page.js';
import {
  ConditionSchema,
  ExpressionSchema,
  I18nKeySchema,
  LocaleSchema,
  ValueSchema,
} from './primitives.js';
import { PredicateSchema, RuleSchema } from './rule.js';
import { VariableSchema } from './variable.js';

/** One valid sample per action type; the test asserts this stays exhaustive. */
const SAMPLE_ACTIONS: Record<(typeof ACTION_TYPES)[number], ActionInput> = {
  setVariable: { type: 'setVariable', variable: 'x', value: { $expr: 'vars.y + 1' } },
  callDataSource: {
    type: 'callDataSource',
    dataSource: 'lookup',
    inputs: { id: 'abc' },
    onSuccess: [{ type: 'next' }],
    onError: [{ type: 'showToast', messageKey: 'err.lookup' }],
  },
  navigate: { type: 'navigate', page: 'offer' },
  next: { type: 'next' },
  back: { type: 'back' },
  showToast: { type: 'showToast', messageKey: 'toast.saved', tone: 'success', params: { n: 1 } },
  openModal: { type: 'openModal', page: 'terms' },
  closeModal: { type: 'closeModal' },
  validatePage: { type: 'validatePage', page: 'consent', onInvalid: [{ type: 'back' }] },
  submitOutcome: { type: 'submitOutcome', outcome: 'SALE_OK', notes: { $expr: 'vars.note' } },
  setDisposition: { type: 'setDisposition', code: 'PTP', subCode: 'PTP_NEW' },
  writeBackToPlatform: { type: 'writeBackToPlatform', attributes: { 'crm.result': 'ok' } },
  transferHint: { type: 'transferHint', target: 'TECH_SUPPORT', reasonKey: 'transfer.reason' },
  runSubflow: { type: 'runSubflow', flow: 'verify-otp' },
  conditional: {
    type: 'conditional',
    if: { $rule: 'r-vip' },
    then: [{ type: 'next' }],
    else: [{ type: 'sequence', actions: [{ type: 'back' }] }],
  },
  sequence: { type: 'sequence', actions: [{ type: 'next' }] },
  parallel: {
    type: 'parallel',
    actions: [{ type: 'emitEvent', name: 'a.b' }, { type: 'closeModal' }],
  },
  emitEvent: { type: 'emitEvent', name: 'offer.accepted', payload: { product: 'gold' } },
  startTimer: { type: 'startTimer', timer: 'offer-timer' },
  stopTimer: { type: 'stopTimer', timer: 'offer-timer' },
  maskField: { type: 'maskField', node: 'in-pan', masked: false },
  logEvent: { type: 'logEvent', level: 'warn', event: 'verify.failed', data: { attempt: 2 } },
};

describe('ActionSchema', () => {
  it('covers exactly the documented action set', () => {
    expect([...ACTION_TYPES].sort()).toEqual(Object.keys(SAMPLE_ACTIONS).sort());
    expect(ACTION_TYPES).toHaveLength(22);
  });

  it.each(Object.entries(SAMPLE_ACTIONS))('accepts %s', (_type, action) => {
    expect(ActionSchema.safeParse(action).success).toBe(true);
  });

  it('applies defaults', () => {
    expect(ActionSchema.parse({ type: 'showToast', messageKey: 'a.b' })).toEqual({
      type: 'showToast',
      messageKey: 'a.b',
      tone: 'info',
    });
    expect(ActionSchema.parse({ type: 'maskField', node: 'in-x' })).toMatchObject({ masked: true });
    expect(ActionSchema.parse({ type: 'logEvent', event: 'x' })).toMatchObject({ level: 'info' });
  });

  it.each([
    ['unknown type', { type: 'eval', code: 'alert(1)' }],
    ['missing discriminator', { page: 'x' }],
    ['unknown key (strict)', { type: 'next', url: 'https://evil.example' }],
    ['raw URL navigation', { type: 'navigate', page: 'https://evil.example' }],
    ['bad variable key', { type: 'setVariable', variable: 'my-var', value: 1 }],
    ['nested invalid action', { type: 'sequence', actions: [{ type: 'nope' }] }],
    ['bad outcome code', { type: 'setDisposition', code: 'has space' }],
    ['bad event name', { type: 'emitEvent', name: 'Bad Name' }],
    ['bad platform attribute', { type: 'writeBackToPlatform', attributes: { '1x': 'a' } }],
  ])('rejects %s', (_label, action) => {
    expect(ActionSchema.safeParse(action).success).toBe(false);
  });
});

describe('primitives', () => {
  it('validates expressions', () => {
    expect(ExpressionSchema.safeParse('vars.a > 1').success).toBe(true);
    expect(ExpressionSchema.safeParse('   ').success).toBe(false);
    expect(ExpressionSchema.safeParse('x'.repeat(2001)).success).toBe(false);
  });

  it('distinguishes expressions from literals in values', () => {
    expect(ValueSchema.parse({ $expr: 'vars.a' })).toEqual({ $expr: 'vars.a' });
    expect(ValueSchema.parse({ a: [1, 'b', null] })).toEqual({ a: [1, 'b', null] });
    expect(ValueSchema.safeParse(undefined).success).toBe(false);
  });

  it('accepts expression or rule conditions only', () => {
    expect(ConditionSchema.safeParse({ $rule: 'r-a' }).success).toBe(true);
    expect(ConditionSchema.safeParse({ $expr: 'true' }).success).toBe(true);
    expect(ConditionSchema.safeParse(true).success).toBe(false);
    expect(ConditionSchema.safeParse({ $rule: 'r-a', $expr: 'true' }).success).toBe(false);
  });

  it.each(['offer.title', 'nps.score10', 'a'])('accepts i18n key %s', (key) => {
    expect(I18nKeySchema.safeParse(key).success).toBe(true);
  });

  it.each(['', 'Hello world', 'a..b', '.a', 'a.'])('rejects i18n key %j', (key) => {
    expect(I18nKeySchema.safeParse(key).success).toBe(false);
  });

  it('validates locales', () => {
    expect(LocaleSchema.safeParse('en-GB').success).toBe(true);
    expect(LocaleSchema.safeParse('english').success).toBe(false);
  });
});

describe('NodeSchema', () => {
  it('parses a recursive tree with defaults', () => {
    const node = NodeSchema.parse({
      id: 'root',
      type: 'box',
      children: [{ id: 'child', type: 'text' }],
    });
    expect(node.children?.[0]).toEqual({
      id: 'child',
      type: 'text',
      props: {},
      bindings: [],
      events: {},
    });
  });

  it('rejects unknown keys, positional ids and bad event names', () => {
    expect(NodeSchema.safeParse({ id: 'a', type: 'box', html: '<b>' }).success).toBe(false);
    expect(NodeSchema.safeParse({ id: '0', type: 'box' }).success).toBe(false);
    expect(NodeSchema.safeParse({ id: 'a', type: 'box', events: { click: [] } }).success).toBe(
      false,
    );
    expect(NodeSchema.safeParse({ id: 'a', type: 'Box' }).success).toBe(false);
    expect(
      NodeSchema.safeParse({ id: 'a', type: 'box', children: [{ id: 'b', type: 1 }] }).success,
    ).toBe(false);
  });

  it('accepts namespaced third-party component types', () => {
    expect(NodeSchema.safeParse({ id: 'gauge', type: 'acme.creditGauge' }).success).toBe(true);
  });

  it('accepts shortcuts and rejects arbitrary strings', () => {
    expect(
      NodeSchema.safeParse({ id: 'a', type: 'button', a11y: { shortcut: 'Ctrl+Shift+S' } }).success,
    ).toBe(true);
    expect(
      NodeSchema.safeParse({ id: 'a', type: 'button', a11y: { shortcut: 'F12' } }).success,
    ).toBe(true);
    expect(
      NodeSchema.safeParse({ id: 'a', type: 'button', a11y: { shortcut: 'press it' } }).success,
    ).toBe(false);
  });
});

describe('ResponsiveStyleSchema', () => {
  it('accepts tokens per breakpoint', () => {
    expect(
      ResponsiveStyleSchema.safeParse({
        base: { direction: 'column', gap: 'sm' },
        md: { direction: 'row' },
        xl: { columns: 4, tone: 'primary' },
      }).success,
    ).toBe(true);
  });

  it.each([
    ['raw color', { base: { color: '#ff0000' } }],
    ['raw CSS length', { base: { gap: '12px' } }],
    ['unknown breakpoint', { xxl: { gap: 'sm' } }],
    ['out-of-range columns', { base: { columns: 13 } }],
  ])('rejects %s', (_label, style) => {
    expect(ResponsiveStyleSchema.safeParse(style).success).toBe(false);
  });
});

describe('BindingSchema', () => {
  it('parses one-way and two-way bindings', () => {
    expect(BindingSchema.parse({ prop: 'disabled', expression: 'vars.busy' })).toEqual({
      prop: 'disabled',
      expression: 'vars.busy',
    });
    expect(BindingSchema.parse({ variable: 'customerName' })).toEqual({
      prop: 'value',
      variable: 'customerName',
    });
  });

  it('rejects a binding that is both or neither', () => {
    expect(BindingSchema.safeParse({ prop: 'value', expression: 'x', variable: 'x' }).success).toBe(
      false,
    );
    expect(BindingSchema.safeParse({ prop: 'value' }).success).toBe(false);
  });
});

describe('VariableSchema', () => {
  it('applies safe defaults', () => {
    expect(VariableSchema.parse({ key: 'note', type: 'string', scope: 'session' })).toEqual({
      key: 'note',
      type: 'string',
      scope: 'session',
      pii: false,
      classification: 'internal',
      persist: false,
    });
  });

  it.each([
    ['kebab key', { key: 'customer-name', type: 'string', scope: 'session' }],
    ['unknown scope', { key: 'a', type: 'string', scope: 'tenant' }],
    [
      'secret classification',
      { key: 'a', type: 'string', scope: 'session', classification: 'secret' },
    ],
    ['bad source', { key: 'a', type: 'string', scope: 'session', source: 'window.location' }],
  ])('rejects %s', (_label, variable) => {
    expect(VariableSchema.safeParse(variable).success).toBe(false);
  });
});

describe('DataSourceRefSchema', () => {
  it('applies policy defaults', () => {
    const ds = DataSourceRefSchema.parse({
      id: 'lookup',
      ref: 'tenant-datasource:lookup',
      version: 1,
    });
    expect(ds.policy).toEqual({ trigger: 'manual', timeoutMs: 5000, cacheTtlSec: 0 });
    expect(ds.inputs).toEqual({});
  });

  it.each([
    ['inline URL', { id: 'a', ref: 'https://api.example/x', version: 1 }],
    ['inline credentials', { id: 'a', ref: 'tenant-datasource:a', version: 1, apiKey: 'k' }],
    [
      'bad JSONPath',
      { id: 'a', ref: 'tenant-datasource:a', version: 1, outputs: { x: { path: 'data.x' } } },
    ],
    [
      'timeout too long',
      { id: 'a', ref: 'tenant-datasource:a', version: 1, policy: { timeoutMs: 60000 } },
    ],
  ])('rejects %s', (_label, ds) => {
    expect(DataSourceRefSchema.safeParse(ds).success).toBe(false);
  });
});

describe('PageSchema / TimerSchema', () => {
  it('defaults lists and mandatory', () => {
    const page = PageSchema.parse({ id: 'p', name: 'P', layout: { id: 'p-root', type: 'box' } });
    expect(page).toMatchObject({ onEnter: [], onLeave: [], mandatory: false, timers: [] });
  });

  it('bounds timers', () => {
    expect(
      TimerSchema.safeParse({ id: 't', durationMs: 500, onElapsed: [{ type: 'next' }] }).success,
    ).toBe(false);
    expect(TimerSchema.safeParse({ id: 't', durationMs: 5000, onElapsed: [] }).success).toBe(false);
  });
});

describe('Flow schemas', () => {
  it.each([
    { id: 'n', type: 'page', page: 'p' },
    { id: 'n', type: 'decision' },
    { id: 'n', type: 'dataSource', dataSource: 'lookup' },
    { id: 'n', type: 'setVariable', variable: 'x', value: 1 },
    { id: 'n', type: 'subflow', flow: 'f' },
    { id: 'n', type: 'end', outcome: 'DONE', position: { x: 1, y: 2 } },
  ])('accepts flow node $type', (node) => {
    expect(FlowNodeSchema.safeParse(node).success).toBe(true);
  });

  it('rejects unknown node types and bad loop bounds', () => {
    expect(FlowNodeSchema.safeParse({ id: 'n', type: 'script' }).success).toBe(false);
    expect(
      FlowEdgeSchema.safeParse({ id: 'e', from: 'a', to: 'b', maxIterations: 0 }).success,
    ).toBe(false);
  });

  it('defaults edges and limits', () => {
    expect(
      FlowSchema.parse({ id: 'f', start: 'n', nodes: [{ id: 'n', type: 'end' }] }),
    ).toMatchObject({
      edges: [],
      limits: { maxSteps: 200 },
    });
  });
});

describe('Rule schemas', () => {
  it('parses nested predicates', () => {
    const when = {
      all: [
        { fact: 'interaction.channel', op: 'eq', value: 'voice' },
        {
          any: [
            { fact: 'vars.segment', op: 'in', value: ['gold'] },
            { not: { $expr: 'vars.blocked' } },
          ],
        },
      ],
    };
    expect(PredicateSchema.parse(when)).toEqual(when);
    expect(RuleSchema.parse({ id: 'r', when }).then).toEqual([]);
  });

  it.each([
    ['empty all', { all: [] }],
    ['unknown operator', { fact: 'vars.a', op: 'like', value: 1 }],
    ['fact outside the allow-list', { fact: 'window.location', op: 'eq', value: 1 }],
    ['mixed keys', { all: [{ $expr: 'true' }], any: [{ $expr: 'true' }] }],
  ])('rejects %s', (_label, predicate) => {
    expect(PredicateSchema.safeParse(predicate).success).toBe(false);
  });
});

describe('ScriptDocumentSchema', () => {
  it('parses the minimal document and applies defaults', () => {
    const doc = ScriptDocumentSchema.parse(minimalScript());
    expect(doc).toMatchObject({
      variables: [],
      dataSources: [],
      subflows: [],
      rules: [],
      componentRegistry: [],
    });
    expect(doc.meta).toEqual({ name: 'Minimal', tags: [], channels: [], capabilities: [] });
  });

  it('only parses the current schema version', () => {
    expect(
      ScriptDocumentSchema.safeParse({ ...minimalScript(), schemaVersion: '0.9.0' }).success,
    ).toBe(false);
  });

  it('requires a UUIDv7 id, at least one page and no unknown keys', () => {
    expect(
      ScriptDocumentSchema.safeParse({
        ...minimalScript(),
        id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      }).success,
    ).toBe(false);
    expect(ScriptDocumentSchema.safeParse({ ...minimalScript(), pages: [] }).success).toBe(false);
    expect(ScriptDocumentSchema.safeParse({ ...minimalScript(), script: 'alert(1)' }).success).toBe(
      false,
    );
  });

  it('validates theme overrides and registry entries', () => {
    const doc = {
      ...minimalScript(),
      theme: { tokens: { density: 'compact' } },
      componentRegistry: [{ type: 'acme.gauge', version: '1.2.0', integrity: 'sha384-abc+/=' }],
    };
    expect(ScriptDocumentSchema.parse(doc).theme).toEqual({
      mode: 'inherit',
      tokens: { density: 'compact' },
    });
    expect(
      ScriptDocumentSchema.safeParse({
        ...doc,
        componentRegistry: [{ type: 'acme.gauge', version: '1', integrity: 'md5-x' }],
      }).success,
    ).toBe(false);
  });
});
