import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';
import { defaultAnalyticsFilter } from '@verbis/ui';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import AnalyticsPage from './analytics.js';

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
  heatmap: [],
  compliance: { eligible: 1, acknowledged: 1, rate: 1 },
  variants: [],
  comparisons: [],
  active: [],
  liveCampaigns: [],
};
const id = '01990000-0000-7000-8000-000000000088';
function path() {
  const filter = defaultAnalyticsFilter();
  return (
    '/v1/analytics/dashboard?' +
    new URLSearchParams({ from: filter.from, to: filter.to }).toString()
  );
}
it('loads validated analytics, creates a schedule with CSRF and deletes it', async () => {
  const f = await mountDesigner(<AnalyticsPage />, {
    [path()]: dashboard,
    '/v1/analytics/schedules': [{ id, next_run_at: '2026-10-05T08:00:00Z', version: 1 }],
    'POST /v1/analytics/schedules': { id, nextRunAt: '2026-10-05T08:00:00Z' },
    [`DELETE /v1/analytics/schedules/${id}`]: { deleted: true },
  });
  expect(await screen.findByText('2026-10-05T08:00:00Z')).toBeTruthy();
  fireEvent.change(screen.getByLabelText(f.i18n.t('analytics.recipients')), {
    target: { value: id },
  });
  fireEvent.click(screen.getByRole('button', { name: f.i18n.t('analytics.save') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'POST')).toBe(true);
  });
  const create = f.requests.find((r) => r.method === 'POST')!;
  expect(create.body).toMatchObject({ recipientUserIds: [id], enabled: true });
  expect(new Headers(create.init?.headers).get('x-csrf-token')).toBe('synthetic-csrf-only');
  const remove = screen.getByRole('button', { name: f.i18n.t('analytics.remove') });
  await waitFor(() => {
    expect(remove.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.click(remove);
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'DELETE')).toBe(true);
  });
});
it('hides report management and export actions for read-only access', async () => {
  const f = await mountDesigner(
    <AnalyticsPage />,
    { [path()]: dashboard },
    { ability: createAbility([{ action: 'read', subject: 'Report' }]) },
  );
  await waitFor(() => {
    expect(f.requests).toHaveLength(1);
  });
  expect(screen.queryByText('CSV')).toBeNull();
  expect(screen.queryByLabelText(f.i18n.t('analytics.recipients'))).toBeNull();
  expect(f.requests[0]!.path).toBe(path());
});
it('retries a failed dashboard and rejects invalid date filters without issuing requests', async () => {
  const f = await mountDesigner(<AnalyticsPage />, {
    [path()]: Response.json({}, { status: 503 }),
  });
  const retry = await screen.findByRole('button', { name: f.i18n.t('analytics.retry') });
  f.responses[path()] = dashboard;
  fireEvent.click(retry);
  await waitFor(() => {
    expect(screen.queryByText(f.i18n.t('analytics.error'))).toBeNull();
  });
  const before = f.requests.length;
  fireEvent.change(screen.getByLabelText(f.i18n.t('analytics.from')), {
    target: { value: '2099-01-01' },
  });
  expect(await screen.findByText(f.i18n.t('analytics.error'))).toBeTruthy();
  expect(f.requests).toHaveLength(before);
});
