import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { createAbility } from '@verbis/authz';
import { AiConfigSchema } from '@verbis/shared-types';
import { defaultAnalyticsFilter } from '@verbis/ui';

import AiSettings from './ai-page.js';
import AnalyticsPage from './analytics-page.js';
import { mountAdmin, syntheticId } from './fixtures.spec.helpers.js';

const settings = {
  version: 3,
  config: AiConfigSchema.parse({}),
  available: false,
  endpoints: [
    {
      id: 'synthetic-model',
      provider: 'onprem',
      residency: 'synthetic-region',
      models: ['synthetic-v1', 'synthetic-v2'],
    },
    { id: 'synthetic-empty', provider: 'onprem', residency: 'synthetic-region', models: [] },
  ],
};
const usage = {
  month: '2026-10',
  tokens: 10,
  microUsd: 20,
  calls: 2,
  pending: 1,
  quotaTokens: 1000,
  quotaMicroUsd: 2000,
};
const dashboard = {
  generatedAt: '2026-10-03T10:00:00Z',
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
async function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
function analyticsPath() {
  const filter = defaultAnalyticsFilter();
  return (
    '/v1/analytics/dashboard?' +
    new URLSearchParams({ from: filter.from, to: filter.to }).toString()
  );
}
it('edits validated AI configuration and secret references with CSRF, reconciles usage and recovers save failures', async () => {
  const f = await mountAdmin(<AiSettings />, {
    '/v1/ai/settings': settings,
    '/v1/ai/usage': usage,
    '/v1/secrets': [
      { id: syntheticId, name: 'Synthetic credential' },
      { id: '01928f3a-0000-7000-8000-000000000002' },
    ],
    'PUT /v1/ai/settings': Response.json({ code: 'VERBIS_VERSION_MISMATCH' }, { status: 412 }),
    '/v1/ai/reconcile': {},
  });
  const t = (key: string) => f.i18n.t('ai.' + key);
  await screen.findByRole('heading', { name: t('title') });
  fireEvent.click(screen.getByRole('checkbox', { name: t('enabled') }));
  fireEvent.click(screen.getByRole('checkbox', { name: t('agentEnabled') }));
  await choose(t('provider'), 'onprem · synthetic-region · synthetic-model');
  await choose(t('model'), 'synthetic-v2');
  await choose(t('secret'), 'Synthetic credential');
  for (const [key, value] of [
    ['tokens', '10000'],
    ['budget', '20000'],
    ['inputRate', '30'],
    ['outputRate', '40'],
    ['maxOutput', '1024'],
  ])
    fireEvent.change(screen.getByLabelText(t(key!)), { target: { value } });
  fireEvent.submit(screen.getByRole('button', { name: t('save') }).closest('form')!);
  await screen.findByText(t('error'));
  f.responses['PUT /v1/ai/settings'] = settings;
  fireEvent.submit(screen.getByRole('button', { name: t('save') }).closest('form')!);
  await screen.findByText(t('saved'));
  const saved = f.requests.find((request) => request.method === 'PUT');
  expect(saved?.body).toMatchObject({
    version: 3,
    config: {
      enabled: true,
      agentEnabled: true,
      endpointId: 'synthetic-model',
      model: 'synthetic-v2',
      secretRef: syntheticId,
      monthlyTokens: 10000,
      monthlyMicroUsd: 20000,
      inputMicroUsdPerMillion: 30,
      outputMicroUsdPerMillion: 40,
      maxOutputTokens: 1024,
    },
  });
  expect(saved?.init?.headers).toMatchObject({ 'x-csrf-token': 'synthetic-csrf' });
  fireEvent.click(screen.getByRole('button', { name: t('reconcile') }));
  await waitFor(() => {
    expect(f.requests.some((request) => request.path.endsWith('/reconcile'))).toBe(true);
  });
  expect(screen.getByText('10 / 1000')).toBeDefined();
});
it('keeps malformed AI settings read-only, disables invalid quotas and handles unavailable provider defaults', async () => {
  const f = await mountAdmin(<AiSettings />, {
    '/v1/ai/settings': settings,
    '/v1/ai/usage': usage,
  });
  const t = (key: string) => f.i18n.t('ai.' + key);
  await screen.findByRole('heading', { name: t('title') });
  await choose(t('provider'), 'onprem · synthetic-region · synthetic-empty');
  fireEvent.change(screen.getByLabelText(t('maxOutput')), { target: { value: '10' } });
  expect(screen.getByRole('button', { name: t('save') }).getAttribute('disabled')).not.toBeNull();
});
it('reports AI settings load and usage reconciliation failure without exposing server details', async () => {
  const f = await mountAdmin(<AiSettings />, {
    '/v1/ai/settings': Response.json({ code: 'private' }, { status: 500 }),
  });
  await screen.findByText(f.i18n.t('ai.error'));
  expect(screen.queryByRole('button')).toBeNull();
});
it('fetches schema-validated analytics, retries failures and rejects invalid filter ranges before requesting them', async () => {
  const path = analyticsPath(),
    f = await mountAdmin(
      <AnalyticsPage />,
      { [path]: Response.json({ code: 'VERBIS_HTTP_UNAVAILABLE' }, { status: 503 }) },
      createAbility([{ action: 'read', subject: 'Report' }]),
    );
  const t = (key: string) => f.i18n.t('analytics.' + key);
  await screen.findByRole('alert');
  f.responses[path] = dashboard;
  fireEvent.click(screen.getByRole('button', { name: t('retry') }));
  await waitFor(() => {
    expect(screen.queryByRole('alert')).toBeNull();
  });
  const count = f.requests.length;
  fireEvent.change(screen.getByLabelText(t('from')), { target: { value: '2027-01-01' } });
  await screen.findByRole('alert');
  expect(f.requests).toHaveLength(count);
  expect(screen.queryByRole('button', { name: 'CSV' })).toBeNull();
  expect(screen.queryByLabelText(t('recipients'))).toBeNull();
});
it('creates and removes analytics schedules with authorized session CSRF and refreshes their list', async () => {
  const f = await mountAdmin(<AnalyticsPage />, {
    [analyticsPath()]: dashboard,
    '/v1/analytics/schedules': [
      { id: syntheticId, next_run_at: '2026-10-04T10:00:00Z', version: 1 },
    ],
    'POST /v1/analytics/schedules': { id: syntheticId, nextRunAt: '2026-10-04T10:00:00Z' },
    ['DELETE /v1/analytics/schedules/' + syntheticId]: { deleted: true },
    '/v1/users?limit=100': {
      data: [{ id: syntheticId, displayName: 'Synthetic Recipient', email: 'r@example.test' }],
    },
    '/v1/campaigns?limit=100': { data: [{ id: syntheticId, name: 'Synthetic Campaign' }] },
    '/v1/groups?limit=100&sort=displayName': {
      data: [{ id: syntheticId, displayName: 'Synthetic Team' }],
    },
  });
  const t = (key: string) => f.i18n.t('analytics.' + key);
  // U-05: recipients, campaign and team are picked by name; ids never have to be typed.
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Synthetic Recipient' }));
  expect(await screen.findByRole('option', { name: 'Synthetic Campaign' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Synthetic Team' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText(t('frequency')), { target: { value: 'weekly' } });
  fireEvent.change(screen.getByLabelText(t('hour')), { target: { value: '10' } });
  fireEvent.submit(screen.getByRole('button', { name: t('save') }).closest('form')!);
  await waitFor(() => {
    expect(f.requests.some((request) => request.method === 'POST')).toBe(true);
  });
  expect(f.requests.find((request) => request.method === 'POST')?.body).toMatchObject({
    frequency: 'weekly',
    hourUtc: 10,
    enabled: true,
    recipientUserIds: [syntheticId],
  });
  expect(f.requests.find((request) => request.method === 'POST')?.init?.headers).toMatchObject({
    'x-csrf-token': 'synthetic-csrf',
  });
  fireEvent.click(screen.getByRole('button', { name: t('remove') }));
  await waitFor(() => {
    expect(f.requests.some((request) => request.method === 'DELETE')).toBe(true);
  });
});
it('downloads authorized analytics blobs, revokes their object URLs and surfaces export failures', async () => {
  const create = vi.fn(() => 'blob:synthetic-report'),
    revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = create;
      static override revokeObjectURL = revoke;
    },
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  const search = analyticsPath().split('?')[1]!;
  const f = await mountAdmin(<AnalyticsPage />, {
    [analyticsPath()]: dashboard,
    '/v1/analytics/schedules': [],
    ['/v1/analytics/export/csv?' + search]: new Response('synthetic,csv'),
    ['/v1/analytics/export/xlsx?' + search]: new Response(null, { status: 403 }),
  });
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'CSV' }).getAttribute('disabled')).toBeNull();
  });
  fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
  await waitFor(() => {
    expect(click).toHaveBeenCalledOnce();
  });
  expect(create).toHaveBeenCalledOnce();
  await waitFor(
    () => {
      expect(revoke).toHaveBeenCalledWith('blob:synthetic-report');
    },
    { timeout: 1500 },
  );
  fireEvent.click(screen.getByRole('button', { name: 'XLSX' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    f.i18n.t('analytics.operationFailed'),
  );
});
