import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import { Runtime } from '@verbis/core-runtime';
import { createI18n, type I18nInstance } from '@verbis/i18n';
import { ScriptDocumentSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';
import { UiProvider } from '@verbis/ui';

import { editorRegistry } from '../editor/store.js';

import { AgentFrame } from './agent-frame.js';

let i18n: I18nInstance;
const engines: Runtime[] = [];
beforeAll(async () => {
  i18n = await createI18n('en');
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  for (const runtime of engines.splice(0)) runtime.dispose();
});

async function mount() {
  const source = minimalScript();
  const home = source.pages[0]!;
  home.layout.children = [
    {
      id: 'notice',
      type: 'scriptText',
      props: { textKey: 'notice.text', titleKey: 'notice.title', mustRead: true },
    },
    {
      id: 'in-reference',
      type: 'textInput',
      props: { labelKey: 'notice.reference' },
      bindings: [{ variable: 'reference' }],
      requiredWhen: { $expr: 'true' },
    },
  ];
  home.mandatory = true;
  source.pages.push({
    id: 'done',
    name: 'Done',
    layout: { id: 'done-root', type: 'box', children: [] },
  });
  source.flow.nodes.splice(1, 0, { id: 'n-done', type: 'page', page: 'done' });
  source.flow.edges = [
    { id: 'e1', from: 'n-home', to: 'n-done' },
    { id: 'e2', from: 'n-done', to: 'n-end' },
  ];
  source.variables = [{ key: 'reference', type: 'string', scope: 'session', default: '' }];
  const texts = {
    'notice.text': 'We record this call.',
    'notice.title': 'Recording notice',
    'notice.reference': 'Reference',
  };
  for (const locale of ['tr', 'en']) Object.assign(source.i18n.messages[locale] ?? {}, texts);
  const runtime = new Runtime({
    document: ScriptDocumentSchema.parse(source),
    registry: editorRegistry,
    session: { locale: 'en' },
    ports: { sessionEvent: () => undefined },
  });
  engines.push(runtime);
  await runtime.start();
  render(
    <UiProvider i18n={i18n}>
      <AgentFrame runtime={runtime} />
    </UiProvider>,
  );
  return runtime;
}

it('lists required notices beside the script and keeps the count live', async () => {
  const runtime = await mount();
  const side = screen.getByRole('complementary', { name: i18n.t('agent.desktop.compliance') });
  expect(
    within(side).getByRole('heading', { name: `${i18n.t('agent.desktop.compliance')} (1)` }),
  ).toBeTruthy();
  expect(within(side).getByText('Recording notice')).toBeTruthy();
  act(() => {
    runtime.store.set('runtime.read.notice', true);
  });
  expect(
    within(side).getByRole('heading', { name: i18n.t('agent.desktop.compliance') }),
  ).toBeTruthy();
});

it('refuses to move on from an invalid page and says so, then moves when it is valid', async () => {
  const runtime = await mount();
  const footer = () => within(document.querySelector<HTMLElement>('.pv-agent-footer')!);
  fireEvent.click(footer().getByRole('button', { name: i18n.t('agent.desktop.next') }));
  // The field says what is missing; the frame says the step did not happen.
  expect(await screen.findByText(i18n.t('runtime.error'))).toBeTruthy();
  expect(runtime.store.get('runtime.page')).toBe('home');
  act(() => {
    runtime.store.setVariable('reference', 'R-1');
    runtime.store.set('runtime.read.notice', true);
  });
  fireEvent.click(footer().getByRole('button', { name: i18n.t('agent.desktop.next') }));
  await waitFor(() => {
    expect(runtime.store.get('runtime.page')).toBe('done');
  });
  expect(screen.getByText(i18n.t('agent.desktop.step', { number: 2 }))).toBeTruthy();
  expect(screen.getByText(i18n.t('agent.desktop.trail', { count: 1 }))).toBeTruthy();
  fireEvent.click(footer().getByRole('button', { name: i18n.t('agent.desktop.back') }));
  await waitFor(() => {
    expect(runtime.store.get('runtime.page')).toBe('home');
  });
});
