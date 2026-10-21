import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';

import {
  ACTION_TYPES,
  ActionSchema,
  ScriptDocumentSchema,
  VariableSchema,
  type Action,
  type ScriptDocument,
} from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import { ACTION_GROUPS, defaultAction } from './action-catalog.js';
import { ActionFields, conditionToPredicate, predicateToCondition } from './actions.js';

function documentFixture(extra: (doc: ScriptDocument) => void = () => undefined) {
  const input = minimalScript();
  input.pages.push({
    id: 'details',
    name: 'Ayrıntılar',
    layout: { id: 'details-root', type: 'box' },
  });
  const doc = ScriptDocumentSchema.parse(input);
  doc.variables.push(
    VariableSchema.parse({ key: 'amount', type: 'number', scope: 'session', default: 0 }),
    VariableSchema.parse({ key: 'vip', type: 'boolean', scope: 'session', default: false }),
    VariableSchema.parse({
      key: 'segment',
      type: 'enum',
      scope: 'session',
      enumValues: ['gold', 'silver'],
      default: 'gold',
    }),
    VariableSchema.parse({ key: 'customerName', type: 'string', scope: 'session', default: '' }),
  );
  extra(doc);
  return doc;
}
function Harness({ initial, doc }: { initial: Action; doc: ScriptDocument }) {
  const [action, change] = useState(initial);
  const [document, setDocument] = useState(doc);
  return (
    <>
      <ActionFields
        action={action}
        onChange={change}
        context={{
          document,
          message: (key, locale) => document.i18n.messages[locale]?.[key] ?? '',
          editMessage: (key, locale, text) => {
            setDocument((current) => {
              const next = structuredClone(current);
              next.i18n.messages[locale] = { ...next.i18n.messages[locale], [key]: text };
              return next;
            });
          },
          newMessageKey: () => 'editor.synthetic.message',
          isInput: (type) => type.endsWith('Input'),
          pageId: 'home',
        }}
      />
      <output data-testid="action">{JSON.stringify(action)}</output>
      <output data-testid="messages">{JSON.stringify(document.i18n.messages)}</output>
    </>
  );
}
const action = () =>
  JSON.parse(screen.getByTestId('action').textContent) as Record<string, unknown>;
async function choose(name: string | RegExp, option: string | RegExp) {
  fireEvent.click(screen.getByRole('combobox', { name }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

it('groups every action type exactly once', () => {
  const grouped = ACTION_GROUPS.flatMap((group) => group.types);
  expect([...grouped].sort()).toEqual([...ACTION_TYPES].sort());
});
it('builds a valid action from the document for every type, or names what is missing', () => {
  const doc = documentFixture();
  const ctx = {
    document: doc,
    messageKey: () => 'editor.synthetic.message',
    isInput: (type: string) => type.endsWith('Input'),
    pageId: 'home',
  };
  const missing: string[] = [];
  for (const type of ACTION_TYPES) {
    const result = defaultAction(type, ctx);
    if ('need' in result) missing.push(`${type}:${result.need}`);
    else expect(ActionSchema.parse(result.action).type).toBe(type);
  }
  // The fixture has no data source, subflow, timer or input field.
  expect(missing.sort()).toEqual(
    [
      'callDataSource:dataSource',
      'runSubflow:subflow',
      'startTimer:timer',
      'stopTimer:timer',
      'maskField:node',
    ].sort(),
  );
  expect(defaultAction('navigate', ctx)).toEqual({
    action: { type: 'navigate', page: 'details' },
  });
});
it('switches type through readable, grouped names without asking for JSON', async () => {
  const f = await mountDesigner(<Harness initial={{ type: 'next' }} doc={documentFixture()} />);
  const type = screen.getByRole('combobox', { name: f.label('editor.actionType') });
  expect(type.textContent).toBe(f.label('actions.names.next'));
  fireEvent.click(type);
  expect(await screen.findByText(f.label('actions.groups.outcome'))).toBeTruthy();
  expect(screen.queryByRole('option', { name: /^setVariable$/ })).toBeNull();
  fireEvent.click(
    screen.getByRole('option', { name: new RegExp(f.label('actions.names.setVariable')) }),
  );
  expect(action()).toEqual({ type: 'setVariable', variable: 'amount', value: 0 });
  expect(screen.queryByRole('textbox', { name: /JSON/ })).toBeNull();
  await choose(f.label('editor.actionType'), new RegExp(f.label('actions.names.callDataSource')));
  expect(screen.getByText(f.label('actions.needs.dataSource'))).toBeTruthy();
  expect(action()['type']).toBe('setVariable');
});
it('edits a set-variable value with a control that matches the variable type', async () => {
  const f = await mountDesigner(
    <Harness
      initial={ActionSchema.parse({ type: 'setVariable', variable: 'amount', value: 1 })}
      doc={documentFixture()}
    />,
  );
  fireEvent.change(screen.getByRole('spinbutton', { name: f.label('value.fixedValue') }), {
    target: { value: '42' },
  });
  expect(action()['value']).toBe(42);
  await choose(f.label('actions.fields.variable'), /^vip/);
  await choose(f.label('value.fixedValue'), f.label('value.yes'));
  expect(action()).toMatchObject({ variable: 'vip', value: true });
  await choose(f.label('actions.fields.variable'), /^segment/);
  expect(action()).toMatchObject({ variable: 'segment', value: 'gold' });
  await choose(f.label('value.fixedValue'), 'silver');
  expect(action()['value']).toBe('silver');
  await choose(f.label('value.mode'), f.label('value.modes.variable'));
  await choose(f.label('value.sourceVariable'), /^customerName/);
  expect(action()['value']).toEqual({ $expr: 'vars.customerName' });
});
it('writes a bilingual message with inserted variables and keeps its params in sync', async () => {
  const f = await mountDesigner(
    <Harness
      initial={ActionSchema.parse({ type: 'showToast', messageKey: 'editor.synthetic.message' })}
      doc={documentFixture()}
    />,
  );
  const tr = screen.getByRole('textbox', { name: `${f.label('actions.fields.message')} · TR` });
  fireEvent.change(tr, { target: { value: 'Teşekkürler' } });
  await choose(
    f.i18n.t('designer.textVariables.insert', {
      field: `${f.label('actions.fields.message')} · TR`,
    }),
    '{customerName}',
  );
  await waitFor(() => {
    expect(JSON.parse(screen.getByTestId('messages').textContent)).toMatchObject({
      tr: { 'editor.synthetic.message': 'Teşekkürler {customerName}' },
    });
  });
  expect(action()['params']).toEqual({ customerName: { $expr: 'vars.customerName' } });
  fireEvent.change(tr, { target: { value: 'Teşekkürler' } });
  expect(action()['params']).toBeUndefined();
});
it('keeps an invalid outcome code local until it is valid and records an early exit', async () => {
  const f = await mountDesigner(
    <Harness
      initial={ActionSchema.parse({ type: 'submitOutcome', outcome: 'COMPLETED' })}
      doc={documentFixture()}
    />,
  );
  const code = screen.getByRole('textbox', { name: f.label('actions.fields.outcome') });
  fireEvent.change(code, { target: { value: 'geçersiz kod' } });
  expect(screen.getByText(f.label('actions.codeInvalid'))).toBeTruthy();
  expect(action()['outcome']).toBe('COMPLETED');
  fireEvent.change(code, { target: { value: 'WRONG_PARTY' } });
  expect(action()['outcome']).toBe('WRONG_PARTY');
  expect(screen.queryByText(f.label('actions.codeInvalid'))).toBeNull();
  await choose(
    f.label('actions.fields.completion'),
    new RegExp(f.label('actions.completion.early')),
  );
  expect(action()).toMatchObject({ outcome: 'WRONG_PARTY', completion: 'early' });
});
it('builds a condition visually and stores it as an expression that reopens visually', async () => {
  const f = await mountDesigner(
    <Harness
      initial={ActionSchema.parse({
        type: 'conditional',
        if: { $expr: 'true' },
        then: [],
        else: [],
      })}
      doc={documentFixture()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('rules.addCondition') }));
  const stored = action()['if'] as { $expr: string };
  expect(stored.$expr).toContain('vars.amount');
  // Reopening converts the expression back to the visual builder (one leaf inside a group).
  expect(conditionToPredicate(stored)).toMatchObject({ all: [{ fact: 'vars.amount' }] });
  expect(predicateToCondition(conditionToPredicate(stored))).toEqual(stored);
  const lists = screen.getAllByRole('group', { name: /./ });
  const then = lists.find((group) =>
    within(group).queryByText(f.label('actions.fields.then'), { selector: 'legend' }),
  )!;
  fireEvent.click(within(then).getByRole('button', { name: f.label('editor.addAction') }));
  expect(action()['then']).toEqual([{ type: 'next' }]);
});
it('adds, renames and fills platform write-back fields', async () => {
  const f = await mountDesigner(
    <Harness
      initial={ActionSchema.parse({ type: 'writeBackToPlatform', attributes: {} })}
      doc={documentFixture()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('actions.addAttribute') }));
  expect(action()['attributes']).toEqual({ attribute1: '' });
  fireEvent.change(screen.getByRole('textbox', { name: f.label('actions.fields.attribute') }), {
    target: { value: 'customer.segment' },
  });
  expect(action()['attributes']).toEqual({ 'customer.segment': '' });
  await choose(f.label('value.mode'), f.label('value.modes.variable'));
  await choose(f.label('value.sourceVariable'), /^segment/);
  expect(action()['attributes']).toEqual({ 'customer.segment': { $expr: 'vars.segment' } });
  fireEvent.click(screen.getByRole('button', { name: f.label('actions.removeAttribute') }));
  expect(action()['attributes']).toEqual({});
});
it('adds, reorders and removes nested actions with readable summaries', async () => {
  const f = await mountDesigner(
    <Harness
      initial={ActionSchema.parse({
        type: 'sequence',
        actions: [{ type: 'navigate', page: 'details' }, { type: 'next' }],
      })}
      doc={documentFixture()}
    />,
  );
  expect(
    screen.getByText(`${f.label('actions.names.navigate')} · Ayrıntılar`, { selector: 'strong' }),
  ).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: f.label('editor.moveDown') })[0]!);
  expect(action()['actions']).toEqual([{ type: 'next' }, { type: 'navigate', page: 'details' }]);
  fireEvent.click(screen.getAllByRole('button', { name: f.label('editor.delete') })[0]!);
  expect(action()['actions']).toEqual([{ type: 'navigate', page: 'details' }]);
});
