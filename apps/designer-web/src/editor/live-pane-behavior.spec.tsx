import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { minimalScript } from '@verbis/script-schema/fixtures';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import { LivePane } from './live-pane.js';
import { EditorStore } from './store.js';

async function mount(store = new EditorStore(minimalScript())) {
  const f = await mountDesigner(<LivePane store={store} />);
  const t = (key: string, options: Record<string, unknown> = {}) =>
    f.i18n.t(`designer.live.${key}`, options);
  const pane = within(await screen.findByRole('region', { name: t('title') }));
  return { ...f, t, pane, store };
}

it('runs the draft live and reports where the agent is', async () => {
  const { t, pane } = await mount();
  expect(pane.getByRole('heading', { name: t('title') })).toBeTruthy();
  expect(pane.getByText(t('live'))).toBeTruthy();
  await waitFor(() => {
    expect(pane.getByText(t('page', { page: 'Home' }))).toBeTruthy();
  });
});

it('offers device, language and theme as single-choice segments', async () => {
  const { t, pane, i18n } = await mount();
  const devices = pane.getByRole('radiogroup', { name: t('device') });
  const phone = within(devices).getByRole('radio', { name: t('devices.phone') });
  const desktop = within(devices).getByRole('radio', { name: t('devices.desktop') });
  expect(phone.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(desktop);
  expect(desktop.getAttribute('aria-checked')).toBe('true');
  expect(phone.getAttribute('aria-checked')).toBe('false');
  // Clicking the active item must not leave the group without a choice.
  fireEvent.click(desktop);
  expect(desktop.getAttribute('aria-checked')).toBe('true');

  const language = pane.getByRole('radiogroup', { name: t('language') });
  const english = within(language).getByRole('radio', { name: i18n.t('common.locale.en') });
  fireEvent.click(english);
  expect(english.getAttribute('aria-checked')).toBe('true');
  const themes = pane.getByRole('radiogroup', { name: t('theme') });
  expect(within(themes).getAllByRole('radio')).toHaveLength(3);
});

it('hot-reloads edits while keeping the agent on their page', async () => {
  const { t, pane, store } = await mount();
  await waitFor(() => {
    expect(pane.getByText(t('page', { page: 'Home' }))).toBeTruthy();
  });
  act(() => {
    store.edit((doc) => {
      if (doc.pages[0]) doc.pages[0].name = 'Welcome';
    });
  });
  await waitFor(() => {
    expect(pane.getByText(t('page', { page: 'Welcome' }))).toBeTruthy();
  });
  expect(screen.getByRole('region', { name: t('title') }).getAttribute('data-result')).toBe(
    'reloaded',
  );
});

it('pauses with guidance when the draft cannot run, and resumes once fixed', async () => {
  const { t, pane, store } = await mount();
  act(() => {
    store.edit((doc) => {
      doc.flow.start = 'n-missing';
    });
  });
  await waitFor(() => {
    expect(pane.getByText(t('failed'))).toBeTruthy();
  });
  expect(pane.getByText(t('paused'))).toBeTruthy();
  act(() => {
    store.edit((doc) => {
      doc.flow.start = 'n-home';
    });
  });
  await waitFor(() => {
    expect(pane.getByText(t('page', { page: 'Home' }))).toBeTruthy();
  });
});

it('start over runs the flow again', async () => {
  const { t, pane } = await mount();
  await waitFor(() => {
    expect(pane.getByText(t('page', { page: 'Home' }))).toBeTruthy();
  });
  fireEvent.click(pane.getByRole('button', { name: t('restart') }));
  await waitFor(() => {
    expect(screen.getByRole('region', { name: t('title') }).getAttribute('data-result')).toBe(
      'started',
    );
  });
});
