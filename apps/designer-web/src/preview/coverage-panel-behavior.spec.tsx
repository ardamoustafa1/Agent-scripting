import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { ScriptDocumentSchema, TestScenarioSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { EditorStore } from '../editor/store.js';
import { mountDesigner } from '../fixtures.spec.helpers.js';

import { CoveragePanel, type CoverageTrace } from './coverage-panel.js';

function page(id: string) {
  return {
    id,
    name: id,
    layout: {
      id: `${id}-root`,
      type: 'box',
      children: [
        {
          id: `${id}-next`,
          type: 'button',
          props: { labelKey: 'common.next' },
          events: { onPress: [{ type: 'next' }] },
        },
      ],
    },
  };
}
function store() {
  const input = {
    ...minimalScript(),
    variables: [{ key: 'tier', type: 'string', scope: 'session', default: 'standard' }],
    pages: [page('home'), page('vip'), page('standard')],
    flow: {
      id: 'main',
      start: 'n-home',
      nodes: [
        { id: 'n-home', type: 'page', page: 'home' },
        { id: 'n-decide', type: 'decision' },
        { id: 'n-vip', type: 'page', page: 'vip' },
        { id: 'n-standard', type: 'page', page: 'standard' },
      ],
      edges: [
        { id: 'e-home', from: 'n-home', to: 'n-decide' },
        { id: 'e-vip', from: 'n-decide', to: 'n-vip', when: { $expr: 'vars.tier == "vip"' } },
        { id: 'e-standard', from: 'n-decide', to: 'n-standard', default: true },
      ],
    },
    testScenarios: [
      TestScenarioSchema.parse({
        id: 'standardPath',
        name: 'Standard path',
        synthetic: true,
        context: {},
        steps: [{ type: 'event', node: 'home-next', event: 'onPress' }],
        expected: { page: 'standard' },
      }),
    ],
  };
  return new EditorStore(ScriptDocumentSchema.parse(input));
}

it('measures branch coverage, finds a scenario for a gap and adds it to the draft', async () => {
  const s = store();
  const onTrace = vi.fn<(trace: CoverageTrace | null) => void>();
  const f = await mountDesigner(<CoveragePanel store={s} editable onTrace={onTrace} />);
  const t = (key: string, options: Record<string, unknown> = {}) =>
    f.i18n.t(`designer.coverage.${key}`, options);

  fireEvent.click(screen.getByRole('button', { name: t('run') }));
  await screen.findByText(t('summary', { percent: 67, covered: 2, total: 3 }));
  const trace = onTrace.mock.lastCall?.[0];
  expect(trace?.edges.has('e-standard')).toBe(true);
  expect(trace?.edges.has('e-vip')).toBe(false);

  const gaps = screen.getByRole('list');
  expect(
    within(gaps).getByText(
      t('branch', { from: f.i18n.t('designer.flow.types.decision'), to: 'vip' }),
    ),
  ).toBeTruthy();
  fireEvent.click(
    within(gaps).getByRole('button', {
      name: t('generateFor', { from: f.i18n.t('designer.flow.types.decision'), to: 'vip' }),
    }),
  );
  await within(gaps).findByText(t('found', { values: 'tier = "vip"' }));
  fireEvent.click(within(gaps).getByRole('button', { name: t('add') }));

  await screen.findByText(t('complete'));
  expect(s.getSnapshot().document.testScenarios).toHaveLength(2);
  expect(s.getSnapshot().document.testScenarios?.[1]).toMatchObject({
    synthetic: true,
    context: { variables: { tier: 'vip' } },
    expected: { page: 'vip' },
  });
});

it('does not offer to add generated scenarios outside a draft', async () => {
  const f = await mountDesigner(
    <CoveragePanel store={store()} editable={false} onTrace={vi.fn()} />,
  );
  const t = (key: string, options: Record<string, unknown> = {}) =>
    f.i18n.t(`designer.coverage.${key}`, options);
  fireEvent.click(screen.getByRole('button', { name: t('run') }));
  const generate = await screen.findByRole('button', { name: /vip/ });
  fireEvent.click(generate);
  await screen.findByText(t('readOnly'));
  expect(screen.queryByRole('button', { name: t('add') })).toBeNull();
});

it('counts an invalid scenario as failing without blocking the measurement', async () => {
  const s = store();
  s.edit((doc) => {
    doc.testScenarios = [
      TestScenarioSchema.parse({
        id: 'broken',
        name: 'Broken',
        synthetic: true,
        context: {},
        steps: [{ type: 'event', node: 'missing', event: 'onPress' }],
        expected: { page: 'vip' },
      }),
    ];
  });
  const f = await mountDesigner(<CoveragePanel store={s} editable onTrace={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: f.i18n.t('designer.coverage.run') }));
  await waitFor(() => {
    expect(screen.getByText(f.i18n.t('designer.coverage.failing', { count: 1 }))).toBeTruthy();
  });
});
