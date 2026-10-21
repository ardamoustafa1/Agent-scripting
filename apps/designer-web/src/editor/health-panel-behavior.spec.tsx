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

async function mount(
  store: EditorStore,
  onNavigate = vi.fn<(target: IssueTarget) => void>(),
  editable = false,
) {
  const f = await mountDesigner(
    <HealthPanel
      store={store}
      document={store.getSnapshot().document}
      fieldProblems={0}
      onNavigate={onNavigate}
      editable={editable}
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

/** A required field on `home` keeps its value in a page-scoped variable; the call then goes on. */
function pageScopedStore() {
  const input = minimalScript();
  input.variables = [{ key: 'customerNo', type: 'string', scope: 'page', default: '' }];
  input.pages[0]!.layout.children = [
    {
      id: 'customer-no',
      type: 'textInput',
      props: { required: true },
      bindings: [{ prop: 'value', variable: 'customerNo' }],
    },
    ...(input.pages[0]!.layout.children ?? []),
  ];
  input.pages.push({ id: 'summary', name: 'Summary', layout: { id: 'summary-root', type: 'box' } });
  input.flow.nodes = [
    { id: 'n-home', type: 'page', page: 'home' },
    { id: 'n-summary', type: 'page', page: 'summary' },
    { id: 'n-end', type: 'end' },
  ];
  input.flow.edges = [
    { id: 'e1', from: 'n-home', to: 'n-summary' },
    { id: 'e2', from: 'n-summary', to: 'n-end' },
  ];
  return new EditorStore(input);
}

it('fixes a required field that would lose its page-scoped value with one click', async () => {
  const store = pageScopedStore();
  const { t } = await mount(store, vi.fn(), true);
  fireEvent.click(screen.getByRole('button', { name: new RegExp(t('title')) }));
  const sheet = await screen.findByRole('dialog', { name: t('title') });
  expect(
    within(sheet).getByText(
      t('issues.pageScopedRequired', {
        field: 'Customer no',
        page: 'Home',
        variable: 'Customer no',
      }),
    ),
  ).toBeTruthy();
  fireEvent.click(
    within(sheet).getByRole('button', {
      name: t('fixes.sessionScope', { variable: 'Customer no' }),
    }),
  );
  const scope = () =>
    store.getSnapshot().document.variables.find((v) => v.key === 'customerNo')?.scope;
  expect(scope()).toBe('session');
  // One undo step restores the page scope.
  store.undo();
  expect(scope()).toBe('page');
});

it('offers no fix on a version the user cannot change', async () => {
  const { t } = await mount(pageScopedStore());
  fireEvent.click(screen.getByRole('button', { name: new RegExp(t('title')) }));
  const sheet = await screen.findByRole('dialog', { name: t('title') });
  expect(
    within(sheet).queryByRole('button', {
      name: t('fixes.sessionScope', { variable: 'Customer no' }),
    }),
  ).toBeNull();
});
