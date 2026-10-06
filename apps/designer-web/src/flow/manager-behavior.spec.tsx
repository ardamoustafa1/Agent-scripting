import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { VariableSchema, findNode } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { EditorStore } from '../editor/store.js';
import { mountDesigner } from '../fixtures.spec.helpers.js';
import { scriptId } from '../test-fixtures.js';

import { SubflowImport } from './import-dialog.js';
import { VariableManager } from './variable-manager.js';

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
  change('variables.default', '{');
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('editor.apply') }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(store.getSnapshot().document.variables.at(-1)?.key).toBe('variable2');
  await choose(f.label('workspace.kind'), 'enum');
  change('variables.enum', 'alpha,beta');
  change('variables.default', '"alpha"');
  await choose(f.label('workspace.scope'), 'page');
  await choose(f.label('workspace.classification'), 'pci');
  change('variables.default', 'null');
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
it('renames a variable and its bindings atomically, toggles PII and rejects wrong typed defaults', async () => {
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
  fireEvent.change(screen.getByLabelText(f.label('variables.default')), {
    target: { value: '"invalid"' },
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.apply') }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.change(screen.getByLabelText(f.label('variables.default')), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText(f.label('variables.name')), {
    target: { value: 'total' },
  });
  fireEvent.click(screen.getByLabelText(f.label('variables.pii')));
  fireEvent.click(screen.getByLabelText(f.label('variables.pii')));
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
