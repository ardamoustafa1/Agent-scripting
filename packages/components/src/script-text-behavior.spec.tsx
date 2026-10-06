import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import type { Runtime } from '@verbis/core-runtime';
import { createI18n, type I18nInstance } from '@verbis/i18n';
import { UiProvider } from '@verbis/ui';

import { ComponentProvider } from './environment.js';
import { ScriptContent, interpolateText, templateDependencies } from './script-text.js';
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
function mount(type: string, props: Record<string, unknown> = {}, bound = true) {
  const runtime = createFixtureRuntime(type);
  engines.push(runtime);
  const component = syntheticRendererProps(runtime, type),
    write = vi.fn(),
    emit = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <UiProvider i18n={i18n}>
      <ComponentProvider
        environment={{
          knowledgeOrigins: ['https://knowledge.example.test'],
          mediaOrigins: [],
          frameOrigins: [],
          features: [],
          now: Date.now,
        }}
      >
        <ScriptContent
          {...component}
          props={{ ...component.props, ...props }}
          node={{
            ...component.node,
            bindings: bound
              ? [
                  { prop: 'value', variable: 'field' },
                  { prop: 'acknowledged', variable: 'field' },
                ]
              : [],
          }}
          write={write}
          emit={emit}
        />
      </ComponentProvider>
    </UiProvider>,
  );
  return { runtime, component, write, emit, view };
}
it.each([true, false])(
  'checks and unchecks checklist choices while retaining other selections (bound=%s)',
  async (bound) => {
    const f = mount('checklist', { value: ['first'] }, bound);
    fireEvent.click(screen.getByRole('checkbox', { name: i18n.t('components.sample.first') }));
    await waitFor(() => {
      expect(f.emit).toHaveBeenCalledWith('onChange');
    });
    if (bound) expect(f.write).toHaveBeenCalledWith('value', []);
    else expect(f.write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: i18n.t('components.sample.second') }));
    if (bound) expect(f.write).toHaveBeenLastCalledWith('value', ['first', 'second']);
  },
);
it('shows objection responses, supports optional navigation and tolerates missing response text', async () => {
  const f = mount('objectionHandler', {
    options: [
      {
        value: 'first',
        labelKey: 'components.next',
        responseKey: 'components.sample.answer',
        page: 'home',
      },
      { value: 'second', labelKey: 'components.back' },
    ],
  });
  const navigate = vi.spyOn(f.runtime, 'navigate').mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('components.next') }));
  await waitFor(() => {
    expect(f.emit).toHaveBeenCalledWith('onPress');
  });
  expect(navigate).toHaveBeenCalledWith('home');
  expect(screen.getByText(i18n.t('components.sample.answer'))).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('components.back') }));
  await waitFor(() => {
    expect(f.emit).toHaveBeenCalledTimes(2);
  });
  expect(navigate).toHaveBeenCalledOnce();
});
it('opens only approved knowledge origins with no opener or referrer', () => {
  const empty = mount('knowledgeLink');
  expect(screen.getByText(i18n.t('components.unconfigured'))).toBeDefined();
  empty.view.unmount();
  mount('knowledgeLink', { url: 'https://knowledge.example.test/article' });
  const link = screen.getByRole('link');
  expect(link.getAttribute('href')).toBe('https://knowledge.example.test/article');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  expect(link.getAttribute('referrerpolicy')).toBe('no-referrer');
});
it.each([true, false])(
  'records must-read acknowledgments and clears them again (bound=%s)',
  async (bound) => {
    const f = mount('scriptText', { mustRead: true }, bound),
      record = vi.spyOn(f.runtime, 'recordInput');
    const checkbox = screen.getByRole('checkbox', { name: i18n.t('components.readConfirmed') });
    fireEvent.click(checkbox);
    await waitFor(() => {
      expect(f.emit).toHaveBeenCalledWith('onRead');
    });
    expect(record).toHaveBeenCalledWith({ type: 'read', node: 'sample', acknowledged: true });
    expect(f.runtime.store.get('runtime.read.sample')).toBe(true);
    if (bound) expect(f.write).toHaveBeenCalledWith('acknowledged', true);
    else expect(f.write).not.toHaveBeenCalled();
    fireEvent.click(checkbox);
    expect(f.runtime.store.get('runtime.read.sample')).toBe(false);
    expect(record).toHaveBeenLastCalledWith({ type: 'read', node: 'sample', acknowledged: false });
  },
);
it('supports structured list blocks and escapes interpolated scalars and nested item data', () => {
  const f = mount('scriptText', {
    mustRead: false,
    blocks: [
      { tag: 'li', textKey: 'components.sample.title' },
      { tag: 'strong', textKey: 'components.sample.description' },
    ],
  });
  expect(screen.getByRole('listitem')).toBeDefined();
  expect(templateDependencies('{{name}} {{vars.name}} {{item.name}}')).toEqual([
    'vars.name',
    'vars.name',
  ]);
  f.runtime.store.setVariable('name', '<script>synthetic</script>');
  expect(interpolateText('{{name}}', f.component, undefined, true)).toBe(
    '&lt;script&gt;synthetic&lt;/script&gt;',
  );
  expect(
    interpolateText('{{item.customer.name}}', f.component, { customer: { name: 'Synthetic' } }),
  ).toBe('Synthetic');
  expect(() => interpolateText('x'.repeat(16385), f.component)).toThrow('VERBIS_TEMPLATE_LIMIT');
  f.runtime.store.setVariable('name', 'pci', 'pci');
  expect(() => interpolateText('{{name}}', f.component)).toThrow('VERBIS_SENSITIVE_DISPLAY');
});
it('keeps failed component events from producing unhandled rejections', async () => {
  const f = mount('checklist');
  f.emit.mockRejectedValue(new Error('synthetic downstream error'));
  fireEvent.click(screen.getAllByRole('checkbox')[0]!);
  await waitFor(() => {
    expect(f.emit).toHaveBeenCalledWith('onChange');
  });
});
