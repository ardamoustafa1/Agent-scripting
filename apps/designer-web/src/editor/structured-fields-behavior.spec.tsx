import { act, fireEvent, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { VariableSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import { Inspector } from './inspector.js';
import { EditorStore } from './store.js';

async function mount(type: string) {
  const store = new EditorStore(minimalScript());
  store.edit((doc) => {
    doc.variables.push(
      VariableSchema.parse({ key: 'musteriAdi', type: 'string', scope: 'session', default: '' }),
      VariableSchema.parse({ key: 'rows', type: 'array', scope: 'session', default: [] }),
    );
  });
  act(() => {
    store.insert(type, 'home-root');
  });
  const id = store.getSnapshot().selection[0]!;
  const f = await mountDesigner(<Inspector store={store} />);
  return { ...f, store, id };
}
async function choose(name: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

it('writes rich text as typed blocks with bilingual text and variables, never JSON', async () => {
  const f = await mount('richContent');
  expect(screen.queryByRole('textbox', { name: /JSON|blocks/i })).toBeNull();
  const blocks = screen.getByRole('group', { name: f.label('editor.blocks.title') });
  fireEvent.click(within(blocks).getByRole('button', { name: f.label('editor.blocks.add') }));
  const [block] = f.store.node(f.id)!.props['blocks'] as { tag: string; textKey: string }[];
  expect(block?.tag).toBe('p');
  const text = `${f.label('editor.blocks.text')} 1 · TR`;
  fireEvent.change(screen.getByRole('textbox', { name: text }), {
    target: { value: 'Sayın {musteriAdi}' },
  });
  expect(f.store.getSnapshot().document.i18n.messages['tr']?.[block!.textKey]).toBe(
    'Sayın {musteriAdi}',
  );
  expect(f.store.node(f.id)!.bindings).toContainEqual({
    prop: 'params',
    expression: '{ musteriAdi: vars.musteriAdi }',
  });
  await choose(f.label('editor.blocks.format'), f.label('editor.blocks.tags.h3'));
  expect((f.store.node(f.id)!.props['blocks'] as { tag: string }[])[0]?.tag).toBe('h3');
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.blocks.remove') }));
  expect(f.store.node(f.id)!.props['blocks']).toEqual([]);
  expect(f.store.getSnapshot().document.i18n.messages['tr']?.[block!.textKey]).toBeUndefined();
});
it('defines data grid columns as rows and rejects an invalid field name', async () => {
  const f = await mount('dataGrid');
  const columns = screen.getByRole('group', { name: f.label('editor.gridColumns.title') });
  fireEvent.click(within(columns).getByRole('button', { name: f.label('editor.gridColumns.add') }));
  const field = screen.getByRole('textbox', { name: f.label('editor.gridColumns.field') });
  fireEvent.change(field, { target: { value: '1 hatalı' } });
  expect(screen.getByText(f.label('editor.gridColumns.invalid'))).toBeTruthy();
  fireEvent.change(field, { target: { value: 'siparis.no' } });
  fireEvent.change(
    screen.getByRole('textbox', { name: `${f.label('editor.gridColumns.label')} · TR` }),
    { target: { value: 'Sipariş no' } },
  );
  await choose(
    f.label('editor.gridColumns.format'),
    f.label('editor.gridColumns.formats.currency'),
  );
  const [column] = f.store.node(f.id)!.props['columns'] as {
    field: string;
    labelKey: string;
    format: string;
  }[];
  expect(column).toMatchObject({ field: 'siparis.no', format: 'currency' });
  expect(f.store.getSnapshot().document.i18n.messages['tr']?.[column!.labelKey]).toBe('Sipariş no');
  expect(
    screen.getByRole('combobox', { name: f.label('editor.gridColumns.currency') }),
  ).toBeTruthy();
});
it('asks for a button confirmation through a switch and text, and picks list variables by name', async () => {
  const f = await mount('actionButton');
  fireEvent.click(screen.getByText(f.label('editor.advancedProperties')));
  fireEvent.click(screen.getByRole('checkbox', { name: f.label('editor.confirmField.enable') }));
  const confirm = f.store.node(f.id)!.props['confirm'] as { titleKey: string };
  fireEvent.change(
    screen.getByRole('textbox', { name: `${f.label('editor.confirmField.title')} · TR` }),
    { target: { value: 'Emin misiniz?' } },
  );
  expect(f.store.getSnapshot().document.i18n.messages['tr']?.[confirm.titleKey]).toBe(
    'Emin misiniz?',
  );
  fireEvent.click(screen.getByRole('checkbox', { name: f.label('editor.confirmField.enable') }));
  expect(f.store.node(f.id)!.props['confirm']).toBeUndefined();
  act(() => {
    f.store.insert('repeater', 'home-root');
  });
  const repeater = f.store.getSnapshot().selection[0]!;
  await choose(f.i18n.t('components.properties.arrayVariable'), 'rows');
  expect(f.store.node(repeater)!.props['arrayVariable']).toBe('rows');
});
