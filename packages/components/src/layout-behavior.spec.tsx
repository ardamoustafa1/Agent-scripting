import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import { runScenario, type Runtime } from '@verbis/core-runtime';
import { createI18n, type I18nInstance } from '@verbis/i18n';
import { NodeSchema, TestScenarioSchema } from '@verbis/script-schema';
import { UiProvider } from '@verbis/ui';

import { LayoutComponent } from './layout.js';
import { createFixtureRuntime, syntheticRendererProps } from './test-fixtures.js';

let i18n: I18nInstance;
const engines: Runtime[] = [];
beforeAll(async () => {
  i18n = await createI18n();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  engines.splice(0).forEach((runtime) => {
    runtime.dispose();
  });
  vi.restoreAllMocks();
});
function mount(type: string, props: Record<string, unknown> = {}, enabled = true) {
  const runtime = createFixtureRuntime(type);
  engines.push(runtime);
  const component = syntheticRendererProps(runtime, type),
    write = vi.fn(),
    emit = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <UiProvider i18n={i18n}>
      <LayoutComponent
        {...component}
        props={{ ...component.props, ...props }}
        node={{ ...component.node, bindings: [{ prop: 'value', variable: 'field' }] }}
        write={write}
        emit={emit}
        enabled={enabled}
      >
        <p>First panel content</p>
        <p>Second panel content</p>
      </LayoutComponent>
    </UiProvider>,
  );
  return { runtime, write, emit, view };
}
it('switches bound tabs, emits changes and respects disabled items', async () => {
  const f = mount('tabs');
  const second = screen.getByRole('tab', { name: i18n.t('components.sample.second') });
  fireEvent.mouseDown(second, { button: 0, ctrlKey: false });
  fireEvent.click(second);
  await waitFor(() => {
    expect(screen.getByText('Second panel content')).toBeDefined();
  });
  expect(f.write).toHaveBeenCalledWith('value', 'second');
  expect(f.emit).toHaveBeenCalledWith('onChange');
  f.view.unmount();
  mount('tabs', {
    items: [
      { value: 'first', labelKey: 'components.sample.first' },
      { value: 'second', labelKey: 'components.sample.second', disabled: true },
    ],
  });
  expect(
    screen.getByRole('tab', { name: i18n.t('components.sample.second') }).getAttribute('disabled'),
  ).not.toBeNull();
});
it('expands accordion content and blocks disabled panels', async () => {
  mount('accordion', {
    items: [
      { value: 'first', labelKey: 'components.sample.first' },
      { value: 'second', labelKey: 'components.sample.second', disabled: true },
    ],
  });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('components.sample.first') }));
  expect(await screen.findByText('First panel content')).toBeDefined();
  expect(
    screen
      .getByRole('button', { name: i18n.t('components.sample.second') })
      .getAttribute('disabled'),
  ).not.toBeNull();
});
it.each(['wizard', 'stepper'])(
  'validates before advancing %s, stops at the last step, and allows returning',
  async (type) => {
    const f = mount(type),
      next = screen.getByRole('button', { name: i18n.t('components.next') }),
      back = screen.getByRole('button', { name: i18n.t('components.back') });
    act(() => {
      f.runtime.store.set('runtime.page', 'home');
    });
    const validate = vi
      .spyOn(f.runtime.validation, 'page')
      .mockResolvedValueOnce([{ node: 'field', messageKey: 'runtime.required' }])
      .mockResolvedValue([]);
    expect(back.getAttribute('disabled')).not.toBeNull();
    fireEvent.click(next);
    await waitFor(() => {
      expect(validate).toHaveBeenCalledOnce();
    });
    expect(screen.getByText('First panel content')).toBeDefined();
    expect(f.emit).not.toHaveBeenCalled();
    fireEvent.click(next);
    await screen.findByText('Second panel content');
    expect(next.getAttribute('disabled')).not.toBeNull();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    fireEvent.click(back);
    await screen.findByText('First panel content');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
    expect(f.emit).toHaveBeenCalledTimes(2);
  },
);
it('opens and closes a modal through its accessible controls', async () => {
  const f = mount('modal', { open: false });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button'));
  await screen.findByRole('dialog');
  expect(screen.getByText('First panel content')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('ui.close') }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(f.emit).not.toHaveBeenCalled();
});
it('updates repeater rows by stable identity while preserving sibling fields and applying row limits', () => {
  const f = mount('repeater', { limit: 1 });
  const input = screen.getByRole('textbox');
  expect(input.getAttribute('value')).toBe('Demo A');
  fireEvent.change(input, { target: { value: 'Changed synthetic row' } });
  expect(f.runtime.store.variable('items')).toEqual([
    { id: 'first', name: 'Changed synthetic row' },
    { id: 'second', name: 'Demo B' },
  ]);
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
});
it('records and replays repeater edits using document node identities and the complete array value', async () => {
  const f = mount('repeater');
  const record = vi.spyOn(f.runtime, 'recordInput');
  fireEvent.change(screen.getAllByRole('textbox')[0]!, {
    target: { value: 'Recorded synthetic parcel' },
  });
  const steps = record.mock.calls.map(([step]) => step);
  expect(steps[0]).toEqual({
    type: 'variable',
    variable: 'items',
    value: [
      { id: 'first', name: 'Recorded synthetic parcel' },
      { id: 'second', name: 'Demo B' },
    ],
  });
  const scenario = TestScenarioSchema.parse({
    id: 'repeaterRecording',
    name: 'Repeater recording',
    synthetic: true,
    context: {},
    dataSources: {},
    steps,
    expected: { variables: { items: f.runtime.store.variable('items') } },
  });
  const result = await runScenario(f.runtime.document, f.runtime.registry, scenario);
  expect(result.passed).toBe(true);
});
it('prevents edits in a disabled repeater', () => {
  const f = mount('repeater', { disabled: true });
  fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Attempted edit' } });
  expect(f.runtime.store.variable('items')).toEqual([
    { id: 'first', name: 'Demo A' },
    { id: 'second', name: 'Demo B' },
  ]);
});

it('creates missing nested repeater paths without mutating sibling fields and renders nested child IDs uniquely', () => {
  const runtime = createFixtureRuntime('repeater');
  engines.push(runtime);
  const component = syntheticRendererProps(runtime, 'repeater');
  const child = NodeSchema.parse({
    id: 'nested-group',
    type: 'box',
    children: [
      {
        id: 'nested-input',
        type: 'textInput',
        props: { itemPath: 'profile.name', labelKey: 'components.field' },
      },
    ],
  });
  render(
    <UiProvider i18n={i18n}>
      <LayoutComponent {...component} node={{ ...component.node, children: [child] }} />
    </UiProvider>,
  );
  fireEvent.change(screen.getAllByRole('textbox')[0]!, {
    target: { value: 'Nested synthetic value' },
  });
  expect(runtime.store.variable('items')).toEqual([
    { id: 'first', name: 'Demo A', profile: { name: 'Nested synthetic value' } },
    { id: 'second', name: 'Demo B' },
  ]);
  expect(document.getElementById('sample-first-nested-group')).not.toBeNull();
  expect(document.getElementById('sample-second-nested-group')).not.toBeNull();
});
