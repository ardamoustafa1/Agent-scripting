import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';
import { type Predicate, DataSourceRefSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { EditorStore } from '../editor/store.js';
import { mountDesigner } from '../fixtures.spec.helpers.js';
import { campaignId } from '../test-fixtures.js';

import { AssignmentRule } from './assignment-rule.js';
import { RuleBuilder } from './builder.js';
import { operators, ruleFields, type RuleField } from './fields.js';
import { RuleManager } from './manager.js';

const fields: RuleField[] = [
  { path: 'vars.amount', label: 'amount', type: 'number' },
  { path: 'vars.ready', label: 'ready', type: 'boolean' },
  { path: 'vars.date', label: 'date', type: 'date' },
  { path: 'vars.name', label: 'name', type: 'string' },
];
function Harness({ initial }: { initial: Predicate }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <RuleBuilder value={value} onChange={setValue} fields={fields} />
      <output data-testid="predicate">{JSON.stringify(value)}</output>
    </>
  );
}
function predicate(): unknown {
  return JSON.parse(screen.getByTestId('predicate').textContent) as unknown;
}
async function choose(name: string, option: string, index = 0) {
  fireEvent.click(screen.getAllByRole('combobox', { name })[index]!);
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
it('preserves the entered choices when changing In to Not in', async () => {
  const f = await mountDesigner(
    <Harness initial={{ fact: 'vars.name', op: 'in', value: ['A', 'B'] }} />,
  );
  await choose(f.label('rules.operator'), f.label('rules.ops.notIn'));
  expect(predicate()).toEqual({ fact: 'vars.name', op: 'notIn', value: ['A', 'B'] });
  expect(screen.getByLabelText<HTMLTextAreaElement>(f.label('rules.value')).value).toBe(
    '["A","B"]',
  );
});
it('returns to a numeric operand when changing Between to Greater than', async () => {
  const f = await mountDesigner(
    <Harness initial={{ fact: 'vars.amount', op: 'between', value: [10, 20] }} />,
  );
  await choose(f.label('rules.operator'), f.label('rules.ops.gt'));
  expect(predicate()).toEqual({ fact: 'vars.amount', op: 'gt', value: 0 });
  expect(screen.getByLabelText<HTMLInputElement>(f.label('rules.value')).type).toBe('number');
});
it('returns to a string operand when changing In to Equals', async () => {
  const f = await mountDesigner(
    <Harness initial={{ fact: 'vars.name', op: 'in', value: ['A', 'B'] }} />,
  );
  await choose(f.label('rules.operator'), f.label('rules.ops.eq'));
  expect(predicate()).toEqual({ fact: 'vars.name', op: 'eq', value: '' });
});
it('refreshes a JSON operand after undo or another document update', async () => {
  function RefreshHarness() {
    const [value, setValue] = useState<Predicate>({
      fact: 'vars.amount',
      op: 'between',
      value: [0, 1],
    });
    return (
      <>
        <RuleBuilder value={value} fields={fields} onChange={setValue} />
        <button
          onClick={() => {
            setValue({ fact: 'vars.amount', op: 'between', value: [10, 20] });
          }}
        >
          Replace predicate
        </button>
      </>
    );
  }
  const f = await mountDesigner(<RefreshHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Replace predicate' }));
  expect(screen.getByLabelText<HTMLTextAreaElement>(f.label('rules.value')).value).toBe('[10,20]');
});
it('edits typed conditions, switches AND/OR, and removes nested conditions', async () => {
  const f = await mountDesigner(
    <Harness initial={{ all: [{ fact: 'vars.amount', op: 'gt', value: 5 }] }} />,
  );
  fireEvent.change(screen.getByLabelText(f.label('rules.value')), { target: { value: '12' } });
  expect(predicate()).toEqual({ all: [{ fact: 'vars.amount', op: 'gt', value: 12 }] });
  await choose(f.label('rules.field'), 'ready');
  await choose(f.label('rules.value'), 'true');
  expect(predicate()).toEqual({ all: [{ fact: 'vars.ready', op: 'eq', value: true }] });
  await choose(f.label('rules.logic'), f.label('rules.any'));
  fireEvent.click(screen.getByRole('button', { name: f.label('rules.addCondition') }));
  expect((predicate() as { any: unknown[] }).any).toHaveLength(2);
  fireEvent.click(screen.getAllByRole('button', { name: f.label('editor.delete') })[1]!);
  expect((predicate() as { any: unknown[] }).any).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: f.label('rules.addGroup') }));
  expect((predicate() as { any: unknown[] }).any[1]).toEqual({
    all: [{ fact: 'vars.amount', op: 'eq', value: '' }],
  });
});
it('validates JSON ranges without corrupting the last accepted predicate', async () => {
  const f = await mountDesigner(<Harness initial={{ fact: 'vars.amount', op: 'eq', value: 1 }} />);
  await choose(f.label('rules.operator'), f.label('rules.ops.between'));
  const input = screen.getByLabelText(f.label('rules.value'));
  fireEvent.change(input, { target: { value: '[' } });
  fireEvent.blur(input);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(predicate()).toEqual({ fact: 'vars.amount', op: 'between', value: [0, 1] });
  fireEvent.change(input, { target: { value: '[10,20]' } });
  fireEvent.blur(input);
  expect(predicate()).toEqual({ fact: 'vars.amount', op: 'between', value: [10, 20] });
  expect(screen.queryByRole('alert')).toBeNull();
});
it.each(['empty', 'dateRange', 'in', 'exists'])(
  'constructs structured %s predicates',
  async (op) => {
    const isDate = op === 'dateRange';
    const f = await mountDesigner(
      <Harness
        initial={{ fact: isDate ? 'vars.date' : 'vars.name', op: 'eq', value: 'synthetic' }}
      />,
    );
    await choose(f.label('rules.operator'), f.label(`rules.ops.${op}`));
    if (op === 'empty')
      expect(predicate()).toEqual({
        any: [
          { fact: 'vars.name', op: 'eq', value: null },
          { fact: 'vars.name', op: 'eq', value: '' },
        ],
      });
    if (op === 'dateRange') expect((predicate() as { all: unknown[] }).all).toHaveLength(2);
    if (op === 'in') expect(predicate()).toEqual({ fact: 'vars.name', op: 'in', value: [] });
    if (op === 'exists') expect(screen.queryByLabelText(f.label('rules.value'))).toBeNull();
  },
);
it('retains unknown facts and propagates edits through NOT', async () => {
  const f = await mountDesigner(
    <Harness initial={{ not: { fact: 'unknown.field', op: 'eq', value: null } }} />,
  );
  fireEvent.change(screen.getByLabelText(f.label('rules.value')), {
    target: { value: 'synthetic' },
  });
  expect(predicate()).toEqual({ not: { fact: 'unknown.field', op: 'eq', value: 'synthetic' } });
});
it('creates a rule and edits its description and conditions in the real editor store', async () => {
  const store = new EditorStore(minimalScript());
  const f = await mountDesigner(<RuleManager store={store} />);
  fireEvent.click(screen.getByRole('button', { name: f.label('rules.add') }));
  fireEvent.change(screen.getByLabelText(f.label('rules.description')), {
    target: { value: 'Synthetic rule' },
  });
  fireEvent.change(screen.getByLabelText(f.label('rules.value')), { target: { value: 'chat' } });
  expect(store.getSnapshot().document.rules.at(-1)).toMatchObject({
    description: 'Synthetic rule',
    when: { all: [{ fact: 'interaction.channel', op: 'eq', value: 'chat' }] },
  });
});
it.each([200, 409, 412, 500])(
  'saves assignment rules with version/CSRF and handles status %s',
  async (status) => {
    const path = `/v1/assignments/${campaignId}`,
      row = {
        id: campaignId,
        version: 7,
        expression: { fact: 'interaction.channel', op: 'eq', value: 'voice' },
      };
    const f = await mountDesigner(<AssignmentRule id={campaignId} ab={status === 412} />, {
      [path]: row,
      [`PATCH ${path}`]:
        status === 200 ? row : Response.json({ code: 'VERBIS_SYNTHETIC' }, { status }),
    });
    fireEvent.click(screen.getByRole('button'));
    const dialog = await screen.findByRole('dialog');
    const apply = await within(dialog).findByRole('button', { name: f.label('editor.apply') });
    fireEvent.click(apply);
    await waitFor(() => {
      expect(f.requests.some((r) => r.method === 'PATCH')).toBe(true);
    });
    const request = f.requests.find((r) => r.method === 'PATCH')!;
    expect(request.body).toEqual({ expression: row.expression });
    expect(new Headers(request.init?.headers).get('if-match')).toBe('"7"');
    expect(new Headers(request.init?.headers).get('x-csrf-token')).toBe('synthetic-csrf-only');
    if (status === 200)
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
    else {
      expect(await screen.findByRole('alert')).toBeTruthy();
      await waitFor(() => {
        expect(apply.hasAttribute('disabled')).toBe(status === 409 || status === 412);
      });
    }
  },
);
it('hides assignment mutations when permissions are absent', async () => {
  const f = await mountDesigner(
    <AssignmentRule id={campaignId} ab={false} />,
    {},
    { ability: createAbility([]) },
  );
  expect(screen.queryByRole('button')).toBeNull();
  expect(f.requests).toHaveLength(0);
});
it('enumerates typed source and data-source facts without duplicate paths', () => {
  const doc = new EditorStore(minimalScript()).getSnapshot().document;
  doc.variables.push({
    key: 'amount',
    type: 'number',
    source: 'interaction.channel',
    scope: 'session',
    pii: false,
    persist: true,
    classification: 'internal',
  });
  doc.dataSources.push(
    DataSourceRefSchema.parse({
      id: 'synthetic',
      ref: 'tenant-datasource:synthetic',
      version: 1,
      outputs: {
        known: { path: '$.known', variable: 'amount' },
        missing: { path: '$.missing', variable: 'absent' },
      },
    }),
  );
  const facts = ruleFields(doc);
  expect(facts.filter((f) => f.path === 'interaction.channel')).toHaveLength(1);
  expect(facts.find((f) => f.path === 'ds.synthetic.known')?.type).toBe('number');
  expect(facts.find((f) => f.path === 'ds.synthetic.missing')?.type).toBe('unknown');
  for (const type of ['date', 'number', 'boolean', 'array', 'object', 'unknown'] as const)
    expect(operators(type)).toContain('exists');
});

it('keeps legacy assignment expressions visible but requires conversion before saving', async () => {
  const path = `/v1/assignments/${campaignId}`;
  const f = await mountDesigner(<AssignmentRule id={campaignId} ab={false} />, {
    [path]: { id: campaignId, version: 1, expression: { not: { $expr: 'false' } } },
  });
  fireEvent.click(screen.getByRole('button'));
  const dialog = await screen.findByRole('dialog');
  expect(
    await within(dialog).findByText(f.label('rules.routingExpressionsUnsupported')),
  ).toBeTruthy();
  const save = within(dialog).getByRole('button', { name: f.label('editor.apply') });
  expect(save.hasAttribute('disabled')).toBe(true);
  expect(within(dialog).queryByRole('button', { name: f.label('rules.advanced') })).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('rules.visual') }));
  expect(save.hasAttribute('disabled')).toBe(false);
});
