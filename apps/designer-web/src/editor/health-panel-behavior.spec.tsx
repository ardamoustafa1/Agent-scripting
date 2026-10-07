import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { VariableSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import { HealthPanel } from './health-panel.js';
import { EditorStore } from './store.js';

import type { IssueTarget } from './health.js';

function storeWithFindings() {
  const store = new EditorStore(minimalScript());
  store.edit((doc) => {
    doc.pages[0]?.layout.children?.push({
      id: 'customer-name',
      type: 'textInput',
      props: {},
      bindings: [],
      events: {},
    });
    doc.variables.push(
      VariableSchema.parse({ key: 'syntheticId', type: 'string', scope: 'session', pii: true }),
    );
  });
  return store;
}

async function mount(store: EditorStore, onNavigate = vi.fn<(target: IssueTarget) => void>()) {
  const f = await mountDesigner(
    <HealthPanel
      store={store}
      document={store.getSnapshot().document}
      fieldProblems={0}
      onNavigate={onNavigate}
    />,
  );
  const t = (key: string, options: Record<string, unknown> = {}) =>
    f.i18n.t(`designer.health.${key}`, options);
  return { ...f, t, onNavigate };
}

it('summarises a clean script as excellent in an accessible trigger', async () => {
  const { t } = await mount(new EditorStore(minimalScript()));
  const trigger = screen.getByRole('button', {
    name: t('trigger', { score: 100, grade: t('grades.excellent') }),
  });
  fireEvent.click(trigger);
  const sheet = await screen.findByRole('dialog', { name: t('title') });
  expect(within(sheet).getByText(t('clean'))).toBeTruthy();
  expect(within(sheet).getAllByText(t('noIssues'))).toHaveLength(6);
});

it('groups findings by category and navigates to the component after closing', async () => {
  const { t, onNavigate, i18n } = await mount(storeWithFindings());
  fireEvent.click(screen.getByRole('button', { name: new RegExp(t('title')) }));
  const sheet = await screen.findByRole('dialog', { name: t('title') });

  const accessibility = within(sheet).getByRole('list', {
    name: new RegExp(t('categories.accessibility')),
  });
  expect(within(accessibility).getByText(i18n.t('designer.preview.lintLabel'))).toBeTruthy();
  const privacy = within(sheet).getByRole('list', { name: new RegExp(t('categories.privacy')) });
  expect(
    within(privacy).getByText(t('issues.unusedSensitive', { variable: 'syntheticId' })),
  ).toBeTruthy();

  const place = t('locations.node', {
    page: 'Home',
    component: i18n.t('designer.editor.componentNames.textInput'),
  });
  fireEvent.click(within(accessibility).getByRole('button', { name: t('goTo', { place }) }));
  await waitFor(() => {
    expect(onNavigate).toHaveBeenCalledWith({
      mode: 'screen',
      pageId: 'home',
      nodeId: 'customer-name',
    });
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('routes variable findings to the variable editor', async () => {
  const { t, onNavigate } = await mount(storeWithFindings());
  fireEvent.click(screen.getByRole('button', { name: new RegExp(t('title')) }));
  const sheet = await screen.findByRole('dialog', { name: t('title') });
  const privacy = within(sheet).getByRole('list', { name: new RegExp(t('categories.privacy')) });
  const place = t('locations.variable', { name: 'syntheticId' });
  const buttons = within(privacy).getAllByRole('button', { name: t('goTo', { place }) });
  // The unused-PII hygiene finding and the schema classification finding share a location.
  expect(buttons.length).toBeGreaterThanOrEqual(1);
  fireEvent.click(buttons[0]!);
  await waitFor(() => {
    expect(onNavigate).toHaveBeenCalledWith({ mode: 'variables' });
  });
});
