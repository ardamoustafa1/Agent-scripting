import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';
import { defaultAnalyticsFilter } from '@verbis/ui';

import { mountDesigner } from '../fixtures.spec.helpers.js';
import { scriptId } from '../test-fixtures.js';

import { useHeatmap } from './heatmap.js';

function Harness() {
  const heat = useHeatmap(scriptId, 'synthetic-version', 'home');
  return (
    <>
      {heat.control}
      <pre data-testid="heat-rows">{JSON.stringify(heat.rows)}</pre>
    </>
  );
}
const dashboard = {
  generatedAt: '2026-10-04T00:00:00Z',
  sampleEvents: 8,
  sessions: 2,
  completed: 1,
  completionRate: 0.5,
  meanDurationMs: 1000,
  scripts: [],
  agents: [],
  pages: [],
  paths: [],
  outcomes: [],
  sources: [],
  heatmap: [
    {
      versionId: 'synthetic-version',
      pageId: 'home',
      nodeId: 'btn-next',
      samples: 5,
      meanDwellMs: null,
      errors: 0,
    },
    {
      versionId: 'other',
      pageId: 'home',
      nodeId: 'other-node',
      samples: 1,
      meanDwellMs: 1000,
      errors: 1,
    },
    {
      versionId: 'synthetic-version',
      pageId: 'other-page',
      nodeId: 'other-page-node',
      samples: 1,
      meanDwellMs: 1000,
      errors: 1,
    },
  ],
  compliance: { eligible: 1, acknowledged: 1, rate: 1 },
  variants: [],
  comparisons: [],
  active: [],
  liveCampaigns: [],
};
function path() {
  const filter = defaultAnalyticsFilter();
  return (
    '/v1/analytics/dashboard?' +
    new URLSearchParams({ from: filter.from, to: filter.to, scriptId }).toString()
  );
}
it('fetches heat samples only after opt-in and filters to the active page and version', async () => {
  const f = await mountDesigner(<Harness />, { [path()]: dashboard });
  expect(f.requests).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: f.i18n.t('analytics.heatmap') }));
  await waitFor(() => {
    expect(screen.getByTestId('heat-rows').textContent).toContain('btn-next');
  });
  expect(screen.getByTestId('heat-rows').textContent).not.toContain('other');
  fireEvent.click(screen.getByRole('button', { name: f.i18n.t('analytics.heatmap') }));
  expect(screen.getByTestId('heat-rows').textContent).toBe('[]');
});
it('reports heatmap fetch failure without blocking the editor', async () => {
  const f = await mountDesigner(<Harness />, {
    [path()]: Response.json({ code: 'VERBIS_HTTP_UNAVAILABLE' }, { status: 503 }),
  });
  fireEvent.click(screen.getByRole('button', { name: f.i18n.t('analytics.heatmap') }));
  expect(await screen.findByText(f.i18n.t('analytics.error'))).toBeTruthy();
  expect(screen.getByTestId('heat-rows').textContent).toBe('[]');
});
it('hides heatmaps and makes no request when report access is denied', async () => {
  const f = await mountDesigner(<Harness />, {}, { ability: createAbility([]) });
  expect(screen.queryByRole('button')).toBeNull();
  expect(f.requests).toHaveLength(0);
});
// P-16: a fresh `[]` per render changed the context for every canvas node on each keystroke.
it('keeps heatmap rows referentially stable across unrelated re-renders', async () => {
  const seen: unknown[] = [];
  function Probe() {
    const heat = useHeatmap(scriptId, 'synthetic-version', 'home'),
      [tick, setTick] = useState(0);
    seen.push(heat.rows);
    return (
      <button
        onClick={() => {
          setTick(tick + 1);
        }}
      >
        tick {tick}
      </button>
    );
  }
  await mountDesigner(<Probe />);
  fireEvent.click(await screen.findByRole('button', { name: 'tick 0' }));
  await screen.findByRole('button', { name: 'tick 1' });
  expect(seen.length).toBeGreaterThanOrEqual(2);
  expect(new Set(seen).size).toBe(1);
});
