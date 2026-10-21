import { describe, expect, it } from 'vitest';

import { ACTION_TYPES, ScriptDocumentSchema, type Action } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import {
  ACTION_GROUPS,
  GROUPED_ACTION_TYPES,
  actionDetail,
  defaultAction,
  maskableNodes,
  timerNodes,
} from './action-catalog.js';

const isInput = (type: string) => type.endsWith('Input');
function richDocument() {
  const source = minimalScript();
  source.pages.push({
    id: 'details',
    name: 'Details',
    layout: {
      id: 'details-root',
      type: 'box',
      children: [
        { id: 'in-tracking', type: 'textInput', props: { labelKey: 'common.next' } },
        { id: 'in-plain', type: 'textInput' },
        { id: 'call-timer', type: 'timer' },
      ],
    },
  });
  return ScriptDocumentSchema.parse({
    ...source,
    variables: [
      { key: 'shared', type: 'string', scope: 'global', default: 'x' },
      {
        key: 'reason',
        type: 'enum',
        scope: 'session',
        enumValues: ['late', 'damaged'],
        classification: 'internal',
      },
    ],
    dataSources: [
      { id: 'lookup', ref: 'tenant-datasource:lookup', version: 1, inputs: {}, outputs: {} },
    ],
    subflows: [
      { id: 'farewell', name: 'Farewell', start: 'f-end', nodes: [{ id: 'f-end', type: 'end' }] },
    ],
  });
}
const context = (document = richDocument(), pageId?: string) => ({
  document,
  messageKey: () => 'msg.synthetic',
  isInput,
  pageId,
});

describe('action groups', () => {
  it('lists every action type exactly once', () => {
    expect([...GROUPED_ACTION_TYPES].sort()).toEqual([...ACTION_TYPES].sort());
    expect(new Set(GROUPED_ACTION_TYPES).size).toBe(GROUPED_ACTION_TYPES.length);
    expect(ACTION_GROUPS.every((group) => group.types.length > 0)).toBe(true);
  });
});

describe('defaultAction', () => {
  it('builds a valid action for every type from a document that has what it needs', () => {
    for (const type of ACTION_TYPES) {
      const result = defaultAction(type, context());
      expect(result, type).toHaveProperty('action.type', type);
    }
  });

  it('fills defaults from the document instead of asking for JSON', () => {
    const doc = richDocument();
    // Global variables are read-only; the first writable one is chosen and enums start valid.
    expect(defaultAction('setVariable', context(doc))).toEqual({
      action: expect.objectContaining({ variable: 'reason', value: 'late' }) as unknown,
    });
    // Navigation prefers another page than the one being edited.
    expect(defaultAction('navigate', context(doc, 'home'))).toEqual({
      action: expect.objectContaining({ page: 'details' }) as unknown,
    });
    expect(defaultAction('openModal', context(doc, 'details'))).toEqual({
      action: expect.objectContaining({ page: 'home' }) as unknown,
    });
    expect(defaultAction('callDataSource', context(doc))).toEqual({
      action: expect.objectContaining({ dataSource: 'lookup' }) as unknown,
    });
    expect(defaultAction('runSubflow', context(doc))).toEqual({
      action: expect.objectContaining({ flow: 'farewell' }) as unknown,
    });
    expect(defaultAction('startTimer', context(doc))).toEqual({
      action: expect.objectContaining({ timer: 'call-timer' }) as unknown,
    });
    expect(defaultAction('maskField', context(doc))).toEqual({
      action: expect.objectContaining({ node: 'in-tracking', masked: true }) as unknown,
    });
    expect(defaultAction('showToast', context(doc))).toEqual({
      action: expect.objectContaining({ messageKey: 'msg.synthetic' }) as unknown,
    });
  });

  it('starts personal and non-internal values empty rather than with a typed default', () => {
    const doc = ScriptDocumentSchema.parse({
      ...minimalScript(),
      variables: [
        { key: 'income', type: 'number', scope: 'session', classification: 'pii', pii: true },
      ],
    });
    expect(defaultAction('setVariable', context(doc))).toEqual({
      action: expect.objectContaining({ variable: 'income', value: '' }) as unknown,
    });
    const internal = ScriptDocumentSchema.parse({
      ...minimalScript(),
      variables: [{ key: 'count', type: 'number', scope: 'session', classification: 'internal' }],
    });
    expect(defaultAction('setVariable', context(internal))).toEqual({
      action: expect.objectContaining({ variable: 'count', value: 0 }) as unknown,
    });
  });

  it('names the missing prerequisite when the document lacks it', () => {
    // A saved document always has a page; an editor mid-edit (all pages removed) may not.
    const empty = { ...ScriptDocumentSchema.parse(minimalScript()), pages: [] };
    expect(defaultAction('setVariable', context(empty))).toEqual({ need: 'variable' });
    expect(defaultAction('callDataSource', context(empty))).toEqual({ need: 'dataSource' });
    expect(defaultAction('navigate', context(empty))).toEqual({ need: 'page' });
    expect(defaultAction('runSubflow', context(empty))).toEqual({ need: 'subflow' });
    expect(defaultAction('stopTimer', context(empty))).toEqual({ need: 'timer' });
    expect(defaultAction('maskField', context(empty))).toEqual({ need: 'node' });
  });
});

describe('component lookups', () => {
  it('lists inputs with their label and timers in document order', () => {
    const doc = richDocument();
    expect(maskableNodes(doc, isInput)).toEqual([
      { id: 'in-tracking', type: 'textInput', labelKey: 'common.next' },
      { id: 'in-plain', type: 'textInput', labelKey: undefined },
    ]);
    expect(timerNodes(doc)).toEqual([{ id: 'call-timer', type: 'timer' }]);
  });
});

describe('actionDetail', () => {
  const doc = richDocument();
  const detail = (action: Action, message: (key: string) => string = () => '') =>
    actionDetail(action, doc, message);

  it('summarizes each action by what it acts on, with readable names', () => {
    expect(detail({ type: 'setVariable', variable: 'reason', value: 'late' })).toBe('reason');
    expect(detail({ type: 'callDataSource', dataSource: 'lookup' })).toBe('lookup');
    expect(detail({ type: 'navigate', page: 'details' })).toBe('Details');
    expect(detail({ type: 'openModal', page: 'absent' })).toBe('absent');
    expect(detail({ type: 'validatePage', page: 'home' })).toBe('Home');
    expect(detail({ type: 'validatePage', page: 'absent' })).toBe('absent');
    expect(detail({ type: 'validatePage' })).toBeUndefined();
    expect(detail({ type: 'submitOutcome', outcome: 'SALE_OK' })).toBe('SALE_OK');
    expect(detail({ type: 'setDisposition', code: 'DONE' })).toBe('DONE');
    expect(detail({ type: 'setDisposition', code: 'DONE', subCode: 'A' })).toBe('DONE / A');
    expect(detail({ type: 'writeBackToPlatform', attributes: {} })).toBeUndefined();
    expect(
      detail({ type: 'writeBackToPlatform', attributes: { a: 1, b: 2 } } as unknown as Action),
    ).toBe('a, b');
    expect(detail({ type: 'transferHint', target: 'queue' })).toBe('queue');
    expect(detail({ type: 'runSubflow', flow: 'farewell' })).toBe('Farewell');
    expect(detail({ type: 'runSubflow', flow: 'absent' })).toBe('absent');
    expect(detail({ type: 'emitEvent', name: 'sale.done' })).toBe('sale.done');
    expect(detail({ type: 'logEvent', event: 'note', level: 'info' })).toBe('note');
    expect(detail({ type: 'next' })).toBeUndefined();
  });

  it('quotes toast text and shortens long messages', () => {
    const toast = { type: 'showToast', messageKey: 'msg', tone: 'info' } as Action;
    expect(detail(toast)).toBeUndefined();
    expect(detail(toast, () => 'Saved')).toBe('“Saved”');
    const long = 'x'.repeat(60);
    expect(detail(toast, () => long)).toBe(`“${'x'.repeat(39)}…”`);
  });
});
