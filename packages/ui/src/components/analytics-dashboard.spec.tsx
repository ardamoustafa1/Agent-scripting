import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import type { AnalyticsDashboard as Dashboard } from '@verbis/shared-types';

import { AnalyticsDashboard, defaultAnalyticsFilter } from './analytics-dashboard.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'tr' } }),
}));
it('keeps filters keyboard-addressable and exposes a retry after errors', () => {
  const retry = vi.fn(),
    filter = vi.fn();
  render(
    <AnalyticsDashboard
      filter={defaultAnalyticsFilter()}
      onFilter={filter}
      loading={false}
      error
      onRetry={retry}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'analytics.retry' }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.getByRole('alert')).toBeDefined();
  expect(document.querySelectorAll('label input')).toHaveLength(4);
});
it('never shows unauthorized report actions when handlers are absent', () => {
  render(
    <AnalyticsDashboard
      filter={defaultAnalyticsFilter()}
      onFilter={() => undefined}
      loading={false}
      onRetry={() => undefined}
    />,
  );
  expect(screen.queryByText('CSV')).toBeNull();
  expect(screen.queryByText('XLSX')).toBeNull();
});

const populated: Dashboard = {
  generatedAt: '2026-10-03T12:00:00.000Z',
  sampleEvents: 80,
  sessions: 20,
  completed: 15,
  completionRate: 0.75,
  meanDurationMs: 125000,
  scripts: [
    {
      key: 'onboarding',
      sessions: 20,
      completed: 15,
      completionRate: 0.75,
      meanDurationMs: 125000,
    },
  ],
  agents: [
    {
      key: 'a'.repeat(64),
      sessions: 20,
      completed: 15,
      completionRate: 0.75,
      meanDurationMs: 125000,
    },
  ],
  pages: [
    {
      key: 'welcome',
      visits: 20,
      sessions: 20,
      meanDwellMs: 30000,
      dropOff: 2,
      dropOffRate: 0.1,
    },
    {
      key: 'offer',
      visits: 18,
      sessions: 18,
      meanDwellMs: 50000,
      dropOff: 3,
      dropOffRate: 3 / 18,
    },
  ],
  paths: [
    { source: 'welcome', target: 'offer', count: 18 },
    { source: 'offer', target: 'complete', count: 15 },
  ],
  outcomes: [
    { key: 'sale', count: 12 },
    { key: 'callback', count: 3 },
  ],
  sources: [{ key: 'customer-lookup', calls: 20, meanLatencyMs: 150, errorRate: 0.05 }],
  heatmap: [],
  compliance: { eligible: 20, acknowledged: 18, rate: 0.9 },
  variants: [
    {
      experimentId: 'sample',
      key: 'A',
      sessions: 10,
      completed: 6,
      completionRate: 0.6,
      meanDurationMs: 140000,
    },
    {
      experimentId: 'sample',
      key: 'B',
      sessions: 10,
      completed: 9,
      completionRate: 0.9,
      meanDurationMs: 110000,
    },
  ],
  comparisons: [
    {
      experimentId: 'sample',
      a: 'A',
      b: 'B',
      difference: 0.3,
      pValue: null,
      significant: false,
      reason: 'insufficient',
    },
  ],
  active: [
    {
      sessionId: 'session-fixture',
      scriptId: 'onboarding',
      campaignId: 'campaign-fixture',
      agent: null,
      state: 'active',
      since: '2026-10-03T11:55:00Z',
    },
  ],
  liveCampaigns: [{ key: 'campaign-fixture', active: 1, completed: 15 }],
};
it('renders privacy-safe cohorts, null metrics and all comparison outcomes accessibly', () => {
  const metric = {
    key: 'other',
    sessions: 1,
    completed: 0,
    completionRate: 0,
    meanDurationMs: null,
  };
  const data: Dashboard = {
    ...populated,
    completionRate: 0,
    meanDurationMs: null,
    compliance: { ...populated.compliance, rate: null },
    scripts: [...populated.scripts, metric],
    agents: [...populated.agents, { ...metric, key: 'privateagent'.repeat(6) }],
    pages: [
      ...populated.pages,
      {
        key: 'emptyPage',
        visits: 1,
        sessions: 1,
        meanDwellMs: null,
        dropOff: 0,
        dropOffRate: 0,
      },
    ],
    sources: [
      ...populated.sources,
      { key: 'emptySource', calls: 0, meanLatencyMs: 0, errorRate: 0 },
    ],
    comparisons: [
      ...populated.comparisons,
      {
        experimentId: 'yes',
        a: 'A',
        b: 'B',
        difference: 0.1,
        pValue: 0.01,
        significant: true,
        reason: 'sufficient',
      },
      {
        experimentId: 'no',
        a: 'A',
        b: 'B',
        difference: 0,
        pValue: 0.5,
        significant: false,
        reason: 'sufficient',
      },
    ],
    active: [
      ...populated.active,
      { ...populated.active[0]!, sessionId: 'second', agent: 'privateagent'.repeat(6) },
    ],
  };
  render(
    <AnalyticsDashboard
      data={data}
      filter={defaultAnalyticsFilter()}
      onFilter={vi.fn()}
      loading={false}
      onRetry={vi.fn()}
    />,
  );
  expect(screen.getByText('analytics.yes')).toBeDefined();
  expect(screen.getByText('analytics.no')).toBeDefined();
  expect(screen.getByText('analytics.insufficient')).toBeDefined();
  expect(screen.getAllByText('—').length).toBe(4);
  expect(document.querySelectorAll('.vb-analytics-metric strong')[2]?.textContent).toBe('—');
  expect(screen.queryByText('privateagent'.repeat(6))).toBeNull();
  expect(screen.getAllByText('privateagent').length).toBeGreaterThan(0);
  expect(screen.getByText('welcome analytics.arrow offer')).toBeDefined();
});
it('updates and clears each report filter without mutating the current filter', () => {
  const filter = {
      ...defaultAnalyticsFilter(),
      campaignId: 'campaign',
      channel: 'voice' as const,
      teamId: 'team',
    },
    change = vi.fn();
  render(
    <AnalyticsDashboard filter={filter} onFilter={change} loading={false} onRetry={vi.fn()} />,
  );
  for (const key of ['from', 'to', 'campaignId', 'teamId']) {
    fireEvent.change(screen.getByLabelText('analytics.' + key), {
      target: { value: key.endsWith('Id') ? 'updated' : '2026-10-01' },
    });
    expect(change).toHaveBeenLastCalledWith({
      ...filter,
      [key]: key.endsWith('Id') ? 'updated' : '2026-10-01',
    });
  }
  fireEvent.change(screen.getByLabelText('analytics.channel'), { target: { value: 'chat' } });
  expect(change).toHaveBeenLastCalledWith({ ...filter, channel: 'chat' });
  fireEvent.change(screen.getByLabelText('analytics.campaignId'), { target: { value: '' } });
  const expected = { ...filter };
  Reflect.deleteProperty(expected, 'campaignId');
  expect(change).toHaveBeenLastCalledWith(expected);
  expect(filter.campaignId).toBe('campaign');
  expect(fireEvent.submit(document.querySelector('form')!)).toBe(false);
});
it('exports both formats, blocks duplicate operations and recovers after failure', async () => {
  const exporting = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(undefined);
  render(
    <AnalyticsDashboard
      data={populated}
      filter={defaultAnalyticsFilter()}
      onFilter={vi.fn()}
      loading={false}
      onRetry={vi.fn()}
      onExport={exporting}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toBe('analytics.operationFailed');
  });
  expect(exporting).toHaveBeenCalledWith('csv');
  fireEvent.click(screen.getByRole('button', { name: 'XLSX' }));
  await waitFor(() => {
    expect(screen.queryByRole('alert')).toBeNull();
  });
  expect(exporting).toHaveBeenCalledWith('xlsx');
});
it('schedules UTC delivery with trimmed recipients and deletes a saved schedule', async () => {
  const schedule = vi.fn().mockResolvedValue(undefined),
    remove = vi.fn().mockResolvedValue(undefined),
    filter = defaultAnalyticsFilter();
  render(
    <AnalyticsDashboard
      data={populated}
      filter={filter}
      onFilter={vi.fn()}
      loading={false}
      onRetry={vi.fn()}
      onSchedule={schedule}
      schedules={[{ id: 'schedule', nextRunAt: 'next-run' }]}
      onDeleteSchedule={remove}
    />,
  );
  fireEvent.change(screen.getByLabelText('analytics.frequency'), { target: { value: 'daily' } });
  fireEvent.change(screen.getByLabelText('analytics.hour'), { target: { value: '23' } });
  fireEvent.change(screen.getByLabelText('analytics.recipients'), {
    target: { value: ' one, , two ' },
  });
  fireEvent.submit(screen.getByRole('button', { name: 'analytics.save' }).closest('form')!);
  await waitFor(() => {
    expect(schedule).toHaveBeenCalledWith({
      filter,
      frequency: 'daily',
      hourUtc: 23,
      enabled: true,
      recipientUserIds: ['one', 'two'],
    });
  });
  await waitFor(() => {
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'analytics.remove' }).disabled,
    ).toBe(false);
  });
  fireEvent.click(screen.getByRole('button', { name: 'analytics.remove' }));
  await waitFor(() => {
    expect(remove).toHaveBeenCalledWith('schedule');
  });
  fireEvent.change(screen.getByLabelText('analytics.frequency'), { target: { value: 'weekly' } });
  fireEvent.submit(screen.getByRole('button', { name: 'analytics.save' }).closest('form')!);
  await waitFor(() => {
    expect(schedule).toHaveBeenLastCalledWith(expect.objectContaining({ frequency: 'weekly' }));
  });
});
it('renders loading and empty paths without permitting exports until data exists', () => {
  const props = {
    filter: defaultAnalyticsFilter(),
    onFilter: vi.fn(),
    onRetry: vi.fn(),
    onExport: vi.fn(),
  };
  const view = render(<AnalyticsDashboard {...props} loading />);
  expect(screen.getByRole('status').textContent).toBe('analytics.loading');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'CSV' }).disabled).toBe(true);
  view.rerender(
    <AnalyticsDashboard
      {...props}
      loading={false}
      data={{ ...populated, paths: [], agents: [] }}
    />,
  );
  expect(screen.queryByText('analytics.agents')).toBeNull();
  view.rerender(
    <AnalyticsDashboard {...props} loading={false} data={{ ...populated, sessions: 0 }} />,
  );
  expect(screen.getByRole('status').textContent).toBe('analytics.empty');
});

it('resets report dimensions while preserving the current date window', () => {
  const filter = {
    from: '2026-10-01',
    to: '2026-10-05',
    campaignId: 'campaign',
    teamId: 'team',
    channel: 'voice' as const,
  };
  const change = vi.fn();
  render(
    <AnalyticsDashboard filter={filter} onFilter={change} loading={false} onRetry={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'analytics.clearFilters' }));
  expect(change).toHaveBeenCalledWith({ from: filter.from, to: filter.to });
  expect(filter.campaignId).toBe('campaign');
});

it('expands the UTC date window without discarding report dimensions', () => {
  const filter = { ...defaultAnalyticsFilter(), campaignId: 'campaign', channel: 'chat' as const };
  const change = vi.fn();
  render(
    <AnalyticsDashboard filter={filter} onFilter={change} loading={false} onRetry={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'analytics.lastThirty' }));
  const last = change.mock.calls[0]![0] as typeof filter;
  expect(last.campaignId).toBe(filter.campaignId);
  expect(last.channel).toBe(filter.channel);
  expect(last.to).toBe(defaultAnalyticsFilter().to);
  expect((new Date(last.to).getTime() - new Date(last.from).getTime()) / 86400000).toBe(29);
});
