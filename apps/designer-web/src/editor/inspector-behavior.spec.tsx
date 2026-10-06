import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { VariableSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import { Inspector } from './inspector.js';
import { EditorStore } from './store.js';

async function setup(readonly = false) {
  const base = new EditorStore(minimalScript());
  base.edit((doc) => {
    doc.variables.push(
      VariableSchema.parse({ key: 'syntheticFlag', type: 'boolean', scope: 'session' }),
    );
    doc.rules.push({
      id: 'synthetic-rule',
      when: { fact: 'vars.syntheticFlag', op: 'eq', value: true },
      then: [],
    });
  });
  const store = new EditorStore(
    base.getSnapshot().document,
    readonly ? new Set(['home']) : new Set(),
  );
  store.select('btn-next');
  const f = await mountDesigner(<Inspector store={store} />);
  const aside = within(screen.getByRole('complementary'));
  const tab = (key: string) =>
    fireEvent.mouseDown(aside.getByRole('tab', { name: f.label(`editor.${key}`) }), {
      button: 0,
      ctrlKey: false,
    });
  return { ...f, store, aside, tab };
}
async function choose(label: string, option: string, index = 0) {
  fireEvent.click(screen.getAllByRole('combobox', { name: label })[index]!);
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
it('edits localized component text and boolean properties', async () => {
  const f = await setup();
  const translations = f.aside
    .getAllByRole('textbox')
    .filter((input) => input.tagName === 'TEXTAREA');
  expect(translations).toHaveLength(2);
  fireEvent.change(translations[1]!, { target: { value: 'Synthetic label' } });
  expect(f.store.getSnapshot().document.i18n.messages['en']?.['common.next']).toBe(
    'Synthetic label',
  );
  const checkbox = f.aside.getAllByRole('checkbox')[0]!;
  fireEvent.click(checkbox);
  expect(Object.values(f.store.node('btn-next')!.props)).toContain(true);
});
it('attaches generated translation keys to a new heading in the same undoable edit', async () => {
  const store = new EditorStore(minimalScript());
  store.insert('heading', 'home-root');
  const id = store.getSnapshot().selection[0]!;
  const f = await mountDesigner(<Inspector store={store} />);
  const label = f.label('editor.componentNames.heading');
  expect(screen.getByText(label)).toBeTruthy();
  const fieldLabel = f.i18n.t('components.properties.textKey');
  const key = `editor.${id.replaceAll('-', '.')}.textKey`;
  fireEvent.change(screen.getByLabelText(`${fieldLabel} · TR`), {
    target: { value: 'Kargo desteği' },
  });
  expect(store.node(id)?.props['textKey']).toBe(key);
  expect(store.getSnapshot().document.i18n.messages['tr']?.[key]).toBe('Kargo desteği');
  fireEvent.change(screen.getByLabelText(`${fieldLabel} · EN`), {
    target: { value: 'Delivery support' },
  });
  expect(store.getSnapshot().document.i18n.messages['en']?.[key]).toBe('Delivery support');
  store.undo();
  expect(store.node(id)?.props['textKey']).toBe(key);
  expect(store.getSnapshot().document.i18n.messages['en']?.[key]).toBeUndefined();
  store.undo();
  expect(store.node(id)?.props['textKey']).toBeUndefined();
  expect(store.getSnapshot().document.i18n.messages['tr']?.[key]).toBeUndefined();
});
it('prioritizes heading content and keeps secondary settings in a collapsed advanced section', async () => {
  const store = new EditorStore(minimalScript());
  store.insert('heading', 'home-root');
  const f = await mountDesigner(<Inspector store={store} />);
  const advanced = screen.getByText(f.label('editor.advancedProperties')).closest('details');
  expect(advanced).toBeTruthy();
  expect(advanced?.hasAttribute('open')).toBe(false);
  expect(
    screen.getByLabelText(`${f.i18n.t('components.properties.textKey')} · TR`).closest('details'),
  ).toBeNull();
  expect(screen.getByLabelText(f.i18n.t('components.properties.url')).closest('details')).toBe(
    advanced,
  );
});
it('sets responsive styles, columns and removes inherited overrides', async () => {
  const f = await setup();
  f.tab('style');
  await choose(f.label('editor.styleLabels.padding'), 'lg');
  fireEvent.change(screen.getByLabelText(f.label('editor.columns')), { target: { value: '3' } });
  expect(f.store.node('btn-next')!.style?.base).toMatchObject({ padding: 'lg', columns: 3 });
  await choose(f.label('editor.styleLabels.padding'), f.label('editor.inherit'));
  expect(f.store.node('btn-next')!.style?.base?.padding).toBeUndefined();
});
it('adds, reorders and removes nested event actions', async () => {
  const f = await setup();
  f.tab('events');
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.addAction') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.addConditional') }));
  expect(f.store.node('btn-next')!.events['onPress']).toHaveLength(3);
  fireEvent.click(screen.getAllByRole('button', { name: f.label('editor.moveUp') })[2]!);
  expect(f.store.node('btn-next')!.events['onPress']?.[1]?.type).toBe('conditional');
  fireEvent.click(screen.getAllByRole('button', { name: f.label('editor.moveDown') })[1]!);
  expect(f.store.node('btn-next')!.events['onPress']?.[2]?.type).toBe('conditional');
  fireEvent.click(screen.getAllByRole('button', { name: f.label('editor.delete') })[2]!);
  expect(f.store.node('btn-next')!.events['onPress']).toHaveLength(2);
});
it('creates and removes two-way variable bindings', async () => {
  const f = await setup();
  f.tab('binding');
  await choose(f.label('editor.property'), 'disabled');
  await choose(f.label('editor.twoWay'), 'syntheticFlag');
  expect(f.store.node('btn-next')!.bindings).toEqual([
    { prop: 'disabled', variable: 'syntheticFlag' },
  ]);
  await choose(f.label('editor.twoWay'), f.label('editor.none'));
  expect(f.store.node('btn-next')!.bindings).toEqual([]);
});
it('attaches and clears rule references for component visibility', async () => {
  const f = await setup();
  f.tab('rules');
  await choose(f.label('editor.ruleReference'), 'synthetic-rule', 0);
  expect(f.store.node('btn-next')!.visibleWhen).toEqual({ $rule: 'synthetic-rule' });
  await choose(f.label('editor.ruleReference'), f.label('editor.none'), 0);
  expect(f.store.node('btn-next')!.visibleWhen).toBeUndefined();
});
it('disables properties on linked screens and shows an empty inspector with no selection', async () => {
  const f = await setup(true);
  expect(
    f.aside
      .getAllByRole('textbox')
      .every(
        (input) => (input as HTMLInputElement).disabled || input.closest('fieldset')?.disabled,
      ),
  ).toBe(true);
  f.store.selectParent();
  f.store.selectParent();
  await waitFor(() => {
    expect(screen.getByText(f.label('editor.selectHint'))).toBeTruthy();
  });
});
it('uses the declared icon enumeration instead of incompatible visual icon names', async () => {
  const f = await setup();
  act(() => {
    f.store.insert('outcomeSubmit', 'home-root');
  });
  const id = f.store.getSnapshot().selection[0]!;
  await choose(f.i18n.t('components.properties.iconKey'), 'next');
  expect(f.store.node(id)!.props['iconKey']).toBe('next');
  expect(f.store.getSnapshot().message).toBeNull();
});
it('edits JSON, enum and tone properties and preserves the last valid JSON value', async () => {
  const f = await setup();
  act(() => {
    f.store.insert('scriptText', 'home-root');
  });
  const id = f.store.getSnapshot().selection[0]!;
  const params = screen.getByLabelText(f.i18n.t('components.properties.params'));
  fireEvent.change(params, { target: { value: '{broken' } });
  fireEvent.blur(params);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(f.store.node(id)!.props['params']).toBeUndefined();
  fireEvent.change(params, { target: { value: '{"synthetic":"value"}' } });
  fireEvent.blur(params);
  expect(f.store.node(id)!.props['params']).toEqual({ synthetic: 'value' });
  await choose(f.i18n.t('components.properties.emphasis'), 'strong');
  expect(f.store.node(id)!.props['emphasis']).toBe('strong');
  await choose(f.i18n.t('components.properties.tone'), 'warning');
  expect(f.store.node(id)!.props['tone']).toBe('warning');
});
it('writes numeric limits and text input properties through their typed fields', async () => {
  const f = await setup();
  act(() => {
    f.store.insert('numberInput', 'home-root');
  });
  const id = f.store.getSnapshot().selection[0]!;
  fireEvent.change(screen.getByLabelText(f.i18n.t('components.properties.min')), {
    target: { value: '2' },
  });
  fireEvent.change(screen.getByLabelText(f.i18n.t('components.properties.max')), {
    target: { value: '10' },
  });
  expect(f.store.node(id)!.props).toMatchObject({ min: 2, max: 10 });
  act(() => {
    f.store.insert('image', 'home-root');
  });
  const image = f.store.getSnapshot().selection[0]!;
  fireEvent.change(screen.getByLabelText(f.i18n.t('components.properties.url')), {
    target: { value: 'https://synthetic.example.test/image.png' },
  });
  expect(f.store.node(image)!.props['url']).toBe('https://synthetic.example.test/image.png');
});
it('creates and updates a typed visibility rule through the visual builder', async () => {
  const f = await setup();
  f.tab('rules');
  fireEvent.click(screen.getAllByRole('button', { name: f.label('rules.addCondition') })[0]!);
  const node = f.store.node('btn-next')!;
  expect(node.visibleWhen).toEqual({ $rule: 'rule-btn-next-visible-when' });
  fireEvent.click(screen.getAllByRole('button', { name: f.label('rules.addCondition') })[0]!);
  expect(
    f.store.getSnapshot().document.rules.find((rule) => rule.id === 'rule-btn-next-visible-when')!
      .when,
  ).toHaveProperty('all');
  expect(
    f.store.getSnapshot().document.rules.filter((rule) => rule.id === 'rule-btn-next-visible-when'),
  ).toHaveLength(1);
});
// D-09: select options required hand-written JSON and failed with a message-less red box.
async function selectSetup() {
  const store = new EditorStore(minimalScript());
  store.insert('select', 'home-root');
  const id = store.getSnapshot().selection[0]!;
  const f = await mountDesigner(<Inspector store={store} />);
  const options = within(screen.getByRole('group', { name: f.label('editor.options.title') }));
  return { ...f, store, id, options };
}
it('edits select options as rows with localized labels instead of raw JSON', async () => {
  const f = await selectSetup();
  const before = ((f.store.node(f.id)!.props['options'] as unknown[] | undefined) ?? []).length;
  fireEvent.click(f.options.getByRole('button', { name: f.label('editor.options.add') }));
  const rows = f.options.getAllByRole('group', { name: /^#\d+$/ });
  expect(rows).toHaveLength(before + 1);
  const row = within(rows.at(-1)!);
  fireEvent.change(row.getByRole('textbox', { name: f.label('editor.options.value') }), {
    target: { value: 'gold' },
  });
  fireEvent.change(row.getByRole('textbox', { name: `${f.label('editor.options.label')} · TR` }), {
    target: { value: 'Altın' },
  });
  fireEvent.change(row.getByRole('textbox', { name: `${f.label('editor.options.label')} · EN` }), {
    target: { value: 'Gold' },
  });
  const doc = f.store.getSnapshot().document;
  const option = (f.store.node(f.id)!.props['options'] as { value: string; labelKey: string }[]).at(
    -1,
  )!;
  expect(option.value).toBe('gold');
  expect(doc.i18n.messages['tr']?.[option.labelKey]).toBe('Altın');
  expect(doc.i18n.messages['en']?.[option.labelKey]).toBe('Gold');
  fireEvent.click(f.options.getByRole('button', { name: f.label('editor.options.add') }));
  const last = within(f.options.getAllByRole('group', { name: /^#\d+$/ }).at(-1)!);
  fireEvent.click(last.getByRole('button', { name: f.label('editor.options.moveUp') }));
  expect((f.store.node(f.id)!.props['options'] as { value: string }[]).at(-1)?.value).toBe('gold');
  fireEvent.click(
    within(f.options.getAllByRole('group', { name: /^#\d+$/ }).at(-1)!).getByRole('button', {
      name: f.label('editor.options.remove'),
    }),
  );
  expect(
    (f.store.node(f.id)!.props['options'] as { value: string }[]).some((o) => o.value === 'gold'),
  ).toBe(false);
});
it('rejects a duplicate or empty option value with an explanation and keeps the document', async () => {
  const f = await selectSetup();
  fireEvent.click(f.options.getByRole('button', { name: f.label('editor.options.add') }));
  fireEvent.click(f.options.getByRole('button', { name: f.label('editor.options.add') }));
  const rows = f.options.getAllByRole('group', { name: /^#\d+$/ });
  const first = (f.store.node(f.id)!.props['options'] as { value: string }[])[0]!.value;
  fireEvent.change(
    within(rows.at(-1)!).getByRole('textbox', { name: f.label('editor.options.value') }),
    { target: { value: first } },
  );
  expect(await f.options.findByText(f.label('editor.options.duplicate'))).toBeTruthy();
  expect(
    (f.store.node(f.id)!.props['options'] as { value: string }[]).filter((o) => o.value === first),
  ).toHaveLength(1);
});
it('explains invalid JSON in JSON properties instead of a message-less error box', async () => {
  const store = new EditorStore(minimalScript());
  store.insert('heading', 'home-root');
  const f = await mountDesigner(<Inspector store={store} />);
  const params = screen.getByRole('textbox', { name: f.i18n.t('components.properties.params') });
  fireEvent.change(params, { target: { value: '{ not json' } });
  fireEvent.blur(params);
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(f.i18n.t('designer.editor.jsonInvalid', { example: '{}' }));
});
it('names all conditional groups and keeps a single condition source per group', async () => {
  const f = await setup();
  f.tab('rules');
  for (const key of ['visibleWhen', 'enabledWhen', 'requiredWhen']) {
    expect(screen.getByRole('group', { name: f.label(`editor.${key}`) })).toBeTruthy();
  }
  expect(screen.queryByText(f.label('rules.advancedLeaf'))).toBeNull();
});
// D-08: the inspector shows only the properties that apply to the selected component type.
it('shows only text-input relevant fields and hides raw translation keys', async () => {
  const store = new EditorStore(minimalScript());
  store.insert('textInput', 'home-root');
  const f = await mountDesigner(<Inspector store={store} />);
  const p = (key: string) => f.i18n.t(`components.properties.${key}`);
  expect(screen.getByLabelText(`${p('labelKey')} · TR`)).toBeTruthy();
  expect(screen.getByLabelText(`${p('labelKey')} · EN`)).toBeTruthy();
  for (const irrelevant of [
    'min',
    'max',
    'step',
    'currency',
    'mask',
    'checked',
    'options',
    'value',
  ])
    expect(screen.queryByLabelText(p(irrelevant)), irrelevant).toBeNull();
  // The raw i18n key input (same name as the group) is not offered; only TR/EN text is.
  expect(screen.queryByRole('textbox', { name: p('labelKey') })).toBeNull();
  const advanced = screen.getByText(f.label('editor.advancedProperties')).closest('details');
  expect(advanced?.querySelectorAll('input,textarea,select,[role=combobox]')).toHaveLength(1);
  expect(within(advanced!).getByLabelText(p('maxLength'))).toBeTruthy();
});
it('shows numeric bounds for number inputs', async () => {
  const store = new EditorStore(minimalScript());
  store.insert('numberInput', 'home-root');
  const f = await mountDesigner(<Inspector store={store} />);
  const p = (key: string) => f.i18n.t(`components.properties.${key}`);
  for (const key of ['min', 'max', 'step']) expect(screen.getByLabelText(p(key))).toBeTruthy();
  expect(screen.queryByLabelText(p('mask'))).toBeNull();
});
// D-09: field-level problems count as validation errors and clear when fixed or unmounted.
it('counts an invalid JSON property in the validation counter until it is fixed', async () => {
  const store = new EditorStore(minimalScript());
  store.insert('heading', 'home-root');
  const f = await mountDesigner(<Inspector store={store} />);
  const params = screen.getByRole('textbox', { name: f.i18n.t('components.properties.params') });
  expect(store.getSnapshot().fieldProblems).toBe(0);
  fireEvent.change(params, { target: { value: '{ not json' } });
  fireEvent.blur(params);
  expect(store.getSnapshot().fieldProblems).toBe(1);
  fireEvent.change(params, { target: { value: '{}' } });
  fireEvent.blur(params);
  expect(store.getSnapshot().fieldProblems).toBe(0);
});
it('counts a duplicate option value and removes the removed option label messages', async () => {
  const f = await selectSetup();
  fireEvent.click(f.options.getByRole('button', { name: f.label('editor.options.add') }));
  fireEvent.click(f.options.getByRole('button', { name: f.label('editor.options.add') }));
  const rows = f.options.getAllByRole('group', { name: /^#\d+$/ });
  const list = () => f.store.node(f.id)!.props['options'] as { value: string; labelKey: string }[];
  const first = list()[0]!.value;
  fireEvent.change(
    within(rows.at(-1)!).getByRole('textbox', { name: f.label('editor.options.value') }),
    { target: { value: first } },
  );
  expect(f.store.getSnapshot().fieldProblems).toBe(1);
  const removed = list()[1]!.labelKey;
  fireEvent.change(
    within(rows.at(-1)!).getAllByRole('textbox', {
      name: new RegExp(f.label('editor.options.label')),
    })[0]!,
    { target: { value: 'Temp' } },
  );
  expect(f.store.getSnapshot().document.i18n.messages['tr']?.[removed]).toBe('Temp');
  fireEvent.click(
    within(rows.at(-1)!).getByRole('button', { name: f.label('editor.options.remove') }),
  );
  expect(f.store.getSnapshot().fieldProblems).toBe(0);
  expect(f.store.getSnapshot().document.i18n.messages['tr']?.[removed]).toBeUndefined();
  expect(f.store.getSnapshot().document.i18n.messages['en']?.[removed]).toBeUndefined();
});
