import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { VariableSchema, findNode } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { EditorStore } from '../editor/store.js';
import { mountDesigner } from '../fixtures.spec.helpers.js';
import { scriptId } from '../test-fixtures.js';

import { SubflowImport } from './import-dialog.js';
import { VariableManager, displayValue } from './variable-manager.js';

async function choose(name: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
it('creates collision-free variables, validates defaults, edits enum type and privacy classification', async () => {
  const store = new EditorStore(minimalScript());
  store.edit((doc) => {
    doc.variables.push(
      VariableSchema.parse({ key: 'variable1', type: 'string', scope: 'session' }),
    );
  });
  const f = await mountDesigner(<VariableManager store={store} />);
  fireEvent.click(screen.getByRole('button', { name: f.label('variables.add') }));
  const dialog = await screen.findByRole('dialog');
  const change = (key: string, value: string) =>
    fireEvent.change(within(dialog).getByLabelText(f.label(key)), { target: { value } });
  change('variables.name', 'syntheticChoice');
  // The initial value is a typed field; no JSON is ever typed.
  expect(within(dialog).queryByRole('textbox', { name: /JSON/ })).toBeNull();
  // D-12: nothing exists until Apply succeeds.
  expect(store.getSnapshot().document.variables.map((v) => v.key)).toEqual(['variable1']);
  await choose(f.label('workspace.kind'), f.label('variables.types.enum'));
  change('variables.enum', 'alpha,beta');
  const initial = within(dialog).getByRole('combobox', { name: f.label('variables.default') });
  expect(initial.textContent).toBe('alpha');
  await choose(f.label('variables.default'), 'beta');
  await choose(f.label('workspace.scope'), f.label('variables.scopes.page'));
  await choose(f.label('workspace.classification'), f.label('variables.classifications.pci'));
  // Card data never keeps an initial value; the field gives way to an explanation.
  expect(within(dialog).queryByRole('combobox', { name: f.label('variables.default') })).toBeNull();
  expect(within(dialog).getByText(f.label('variables.sensitiveDefault'))).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('editor.apply') }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(store.getSnapshot().document.variables.at(-1)).toMatchObject({
    key: 'syntheticChoice',
    type: 'enum',
    enumValues: ['alpha', 'beta'],
    default: null,
    scope: 'page',
    classification: 'pci',
    pii: true,
    persist: false,
  });
  fireEvent.click(screen.getByRole('button', { name: /show all rows/i }));
  expect(screen.getByText('••••')).toBeTruthy();
});
it('renames a variable and its bindings atomically, classifies PII and types its initial value', async () => {
  const store = new EditorStore(minimalScript());
  store.edit((doc) => {
    doc.variables.push(
      VariableSchema.parse({ key: 'amount', type: 'number', scope: 'session', default: 1 }),
    );
    findNode(doc, 'btn-next')!.node.bindings.push({
      prop: 'disabled',
      expression: 'vars.amount > 0',
    });
  });
  const f = await mountDesigner(<VariableManager store={store} />);
  fireEvent.click(screen.getByRole('button', { name: /show all rows/i }));
  fireEvent.click(screen.getByRole('button', { name: 'amount' }));
  await screen.findByRole('dialog');
  // A number variable gets a number field, so a wrongly typed initial value cannot be entered.
  const initial = screen.getByRole('spinbutton', { name: f.label('variables.default') });
  expect(initial.getAttribute('value')).toBe('1');
  fireEvent.change(initial, { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText(f.label('variables.name')), {
    target: { value: 'total' },
  });
  // One privacy control: the data class (no separate PII checkbox asking the same thing).
  expect(screen.queryByRole('checkbox')).toBeNull();
  await choose(f.label('workspace.classification'), f.label('variables.classifications.pii'));
  await choose(f.label('workspace.classification'), f.label('variables.classifications.internal'));
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.apply') }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(store.node('btn-next')!.bindings[0]).toEqual({
    prop: 'disabled',
    expression: 'vars.total > 0',
  });
  expect(store.getSnapshot().document.variables[0]).toMatchObject({
    key: 'total',
    default: 2,
    classification: 'internal',
    pii: false,
  });
});
it('prevents variable changes that affect a linked page', async () => {
  const base = new EditorStore(minimalScript());
  base.edit((doc) => {
    doc.variables.push(VariableSchema.parse({ key: 'locked', type: 'boolean', scope: 'session' }));
    findNode(doc, 'btn-next')!.node.bindings.push({
      prop: 'disabled',
      expression: 'vars.locked',
    });
  });
  const store = new EditorStore(base.getSnapshot().document, new Set(['home']));
  const before = store.getSnapshot().document;
  const f = await mountDesigner(<VariableManager store={store} />);
  fireEvent.click(screen.getByRole('button', { name: /show all rows/i }));
  fireEvent.click(screen.getByRole('button', { name: 'locked' }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.apply') }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(store.getSnapshot().document).toBe(before);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
it('prevents variable editing in read-only mode', async () => {
  const f = await mountDesigner(
    <VariableManager store={new EditorStore(minimalScript())} readOnly />,
  );
  expect(
    screen.getByRole('button', { name: f.label('variables.add') }).hasAttribute('disabled'),
  ).toBe(true);
});
it('reuses a local screen as an embedded subflow in one undo transaction', async () => {
  const store = new EditorStore(minimalScript()),
    imported = vi.fn();
  const f = await mountDesigner(
    <SubflowImport store={store} disabled={false} onImported={imported} />,
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('flow.import') }));
  await screen.findByRole('dialog');
  expect(
    screen.getByRole('button', { name: f.label('editor.apply') }).hasAttribute('disabled'),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: f.label('flow.reuseScreen') }));
  expect(imported).toHaveBeenCalledOnce();
  expect(store.getSnapshot().document.subflows[0]?.nodes[0]).toMatchObject({
    type: 'page',
    page: 'home',
  });
  store.undo();
  expect(store.getSnapshot().document.subflows).toHaveLength(0);
});
it.each([200, 503])('imports a pinned source version and handles HTTP %s', async (status) => {
  const store = new EditorStore(minimalScript()),
    imported = vi.fn();
  const source = {
    id: scriptId,
    number: 2,
    version: 1,
    state: 'published',
    document: new EditorStore(minimalScript()).getSnapshot().document,
    screens: [],
  };
  const f = await mountDesigner(
    <SubflowImport store={store} disabled={false} onImported={imported} />,
    {
      [`/v1/scripts/${scriptId}/versions/2`]:
        status === 200 ? source : Response.json({}, { status }),
    },
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('flow.import') }));
  await screen.findByRole('dialog');
  fireEvent.change(screen.getByLabelText(f.label('flow.sourceScript')), {
    target: { value: scriptId },
  });
  fireEvent.change(screen.getByLabelText(f.label('flow.sourceVersion')), {
    target: { value: '2' },
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.apply') }));
  if (status === 200) {
    await waitFor(() => {
      expect(imported).toHaveBeenCalledOnce();
    });
    expect(store.getSnapshot().document.subflows).toHaveLength(1);
    expect(store.getSnapshot().document.pages).toHaveLength(2);
  } else {
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(imported).not.toHaveBeenCalled();
    expect(store.getSnapshot().document.pages).toHaveLength(1);
  }
});
it('shows localized variable type, scope and classification labels instead of raw enums', async () => {
  const store = new EditorStore(minimalScript());
  store.edit((doc) => {
    doc.variables.push(
      VariableSchema.parse({
        key: 'syntheticAmount',
        type: 'number',
        scope: 'interaction',
        classification: 'internal',
      }),
    );
  });
  const f = await mountDesigner(<VariableManager store={store} />);
  const showAll = screen.queryByRole('button', { name: /show all rows/i });
  if (showAll) fireEvent.click(showAll);
  const table = screen.getByRole('table');
  for (const key of ['types.number', 'scopes.interaction', 'classifications.internal']) {
    expect(f.label(`variables.${key}`)).not.toBe(`designer.variables.${key}`);
    expect(within(table).getByText(f.label(`variables.${key}`))).toBeTruthy();
  }
  expect(within(table).queryByText('interaction')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'syntheticAmount' }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('combobox', { name: f.label('workspace.kind') }));
  for (const type of ['string', 'number', 'boolean', 'date', 'object', 'array', 'enum'])
    expect(
      await screen.findByRole('option', { name: f.label(`variables.types.${type}`) }),
    ).toBeTruthy();
});
// D-12: the add dialog edits a draft; cancelling must not leave residual variables.
it('adds nothing when the add dialog is cancelled and titles it "add"', async () => {
  const store = new EditorStore(minimalScript());
  const f = await mountDesigner(<VariableManager store={store} />);
  for (let i = 0; i < 3; i++) {
    fireEvent.click(screen.getByRole('button', { name: f.label('variables.add') }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(f.label('variables.add'))).toBeTruthy();
    expect(within(dialog).queryByText(f.label('variables.edit'))).toBeNull();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  }
  expect(store.getSnapshot().document.variables).toHaveLength(0);
  expect(store.getSnapshot().history).toBe(0);
});
it('explains which field failed: invalid name, taken name, empty enum', async () => {
  const store = new EditorStore(minimalScript());
  store.edit((doc) => {
    doc.variables.push(VariableSchema.parse({ key: 'taken', type: 'string', scope: 'session' }));
  });
  const f = await mountDesigner(<VariableManager store={store} />);
  fireEvent.click(screen.getByRole('button', { name: f.label('variables.add') }));
  const dialog = await screen.findByRole('dialog');
  const apply = () =>
    fireEvent.click(within(dialog).getByRole('button', { name: f.label('editor.apply') }));
  const change = (key: string, value: string) =>
    fireEvent.change(within(dialog).getByLabelText(f.label(key)), { target: { value } });
  const field = (key: string) => within(dialog).getByLabelText(f.label(key));
  change('variables.name', 'bad name!');
  apply();
  expect(field('variables.name').getAttribute('aria-invalid')).toBe('true');
  expect(within(dialog).getByText(f.label('variables.errors.name'))).toBeTruthy();
  change('variables.name', 'taken');
  apply();
  expect(within(dialog).getByText(f.label('variables.errors.nameTaken'))).toBeTruthy();
  change('variables.name', 'fresh');
  await choose(f.label('workspace.kind'), f.label('variables.types.enum'));
  change('variables.enum', ' , ');
  apply();
  expect(within(dialog).getByText(f.label('variables.errors.enumEmpty'))).toBeTruthy();
  expect(field('variables.name').getAttribute('aria-invalid')).not.toBe('true');
  expect(store.getSnapshot().document.variables).toHaveLength(1);
  change('variables.enum', 'ok');
  apply();
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(store.getSnapshot().document.variables.map((v) => v.key)).toEqual(['taken', 'fresh']);
});

it('explains an empty variable list and still lets the designer add the first variable', async () => {
  const store = new EditorStore(minimalScript());
  const f = await mountDesigner(<VariableManager store={store} />);
  expect(screen.getByText(f.label('variables.emptyTitle'))).toBeTruthy();
  expect(screen.getByText(f.label('variables.intro'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: f.label('variables.add') }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
});
it('pre-fills a variable from call data and rejects a source outside the runtime context', async () => {
  const store = new EditorStore(minimalScript());
  const f = await mountDesigner(<VariableManager store={store} />);
  fireEvent.click(screen.getByRole('button', { name: f.label('variables.add') }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(f.label('variables.addDescription'))).toBeTruthy();
  const change = (key: string, value: string) =>
    fireEvent.change(within(dialog).getByLabelText(f.label(key)), { target: { value } });
  change('variables.name', 'callerNumber');
  change('variables.source', 'window.location');
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('editor.apply') }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    f.label('variables.errors.source'),
  );
  expect(store.getSnapshot().document.variables).toEqual([]);
  change('variables.source', ' interaction.ani ');
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('editor.apply') }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(store.getSnapshot().document.variables).toEqual([
    expect.objectContaining({ key: 'callerNumber', source: 'interaction.ani' }),
  ]);
  fireEvent.click(screen.getByRole('button', { name: /show all rows/i }));
  fireEvent.click(screen.getByRole('button', { name: 'callerNumber' }));
  const edit = await screen.findByRole('dialog');
  fireEvent.change(within(edit).getByLabelText(f.label('variables.source')), {
    target: { value: '' },
  });
  fireEvent.click(within(edit).getByRole('button', { name: f.label('editor.apply') }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(store.getSnapshot().document.variables[0]?.source).toBeUndefined();
});

it('opens a legacy PII-flagged internal variable as personal data instead of dropping the flag', async () => {
  const store = new EditorStore(minimalScript());
  store.edit((doc) => {
    doc.variables.push(
      VariableSchema.parse({
        key: 'legacy',
        type: 'string',
        scope: 'session',
        classification: 'internal',
        pii: true,
      }),
    );
  });
  const f = await mountDesigner(<VariableManager store={store} />);
  fireEvent.click(screen.getByRole('button', { name: /show all rows/i }));
  fireEvent.click(screen.getByRole('button', { name: 'legacy' }));
  const dialog = await screen.findByRole('dialog');
  expect(
    within(dialog).getByRole('combobox', { name: f.label('workspace.classification') }).textContent,
  ).toBe(f.label('variables.classifications.pii'));
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('editor.apply') }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(store.getSnapshot().document.variables[0]).toMatchObject({
    classification: 'pii',
    pii: true,
  });
});
it('shows initial values as authors read them, never as JSON', () => {
  const t = (key: string) =>
    ({ 'designer.value.yes': 'Evet', 'designer.value.no': 'Hayır' })[key] ?? key;
  expect(displayValue('', t)).toBe('—');
  expect(displayValue(null, t)).toBe('—');
  expect(displayValue('Ankara', t)).toBe('Ankara');
  expect(displayValue(true, t)).toBe('Evet');
  expect(displayValue([1, 'a'], t)).toBe('1, a');
  expect(displayValue({}, t)).toBe('—');
});

it('stores a display name for empty-value placeholders and drops a blank one', async () => {
  const store = new EditorStore(minimalScript());
  const f = await mountDesigner(<VariableManager store={store} />);
  fireEvent.click(screen.getByRole('button', { name: f.label('variables.add') }));
  const dialog = await screen.findByRole('dialog');
  const change = (key: string, value: string) =>
    fireEvent.change(within(dialog).getByLabelText(f.label(key)), { target: { value } });
  change('variables.name', 'customerName');
  change('variables.displayName', '  müşteri adı  ');
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('editor.apply') }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(store.getSnapshot().document.variables[0]).toMatchObject({
    key: 'customerName',
    description: 'müşteri adı',
  });
  fireEvent.click(screen.getByRole('button', { name: /show all rows/i }));
  fireEvent.click(screen.getByRole('button', { name: 'customerName' }));
  const edit = await screen.findByRole('dialog');
  fireEvent.change(within(edit).getByLabelText(f.label('variables.displayName')), {
    target: { value: '   ' },
  });
  fireEvent.click(within(edit).getByRole('button', { name: f.label('editor.apply') }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(store.getSnapshot().document.variables[0]?.description).toBeUndefined();
});
