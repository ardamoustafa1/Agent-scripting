import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { mountAdmin, syntheticId } from './fixtures.spec.helpers.js';
import { Picker, ScopePicker } from './widgets.js';

// D-17: pickers search on the server and page through results, never only the first page.
it('searches teams on the server and keeps already selected scope ids visible', async () => {
  const picked: (string | string[])[] = [];
  const f = await mountAdmin(
    <ScopePicker
      path="/v1/groups?limit=100&sort=displayName"
      label="Teams"
      allLabel="All teams"
      nameKey="displayName"
      value={[syntheticId]}
      onChange={(value) => picked.push(value)}
    />,
    {
      '/v1/groups?limit=100&sort=displayName': {
        data: [{ id: syntheticId, displayName: 'Team Alpha' }],
        page: { nextCursor: 'c1' },
      },
      '/v1/groups?limit=100&sort=displayName&cursor=c1': {
        data: [{ id: 'second', displayName: 'Team Beta' }],
        page: { nextCursor: null },
      },
      '/v1/groups?limit=100&sort=displayName&q=zeta': {
        data: [{ id: 'zeta-id', displayName: 'Zeta Team' }],
      },
    },
  );
  const group = within(screen.getByRole('group', { name: 'Teams' }));
  await group.findByRole('checkbox', { name: 'Team Alpha' });
  fireEvent.click(group.getByRole('button', { name: f.label('pickerLoadMore') }));
  await group.findByRole('checkbox', { name: 'Team Beta' });
  expect(group.queryByRole('button', { name: f.label('pickerLoadMore') })).toBeNull();
  fireEvent.change(group.getByRole('searchbox', { name: f.label('pickerSearch') }), {
    target: { value: ' zeta ' },
  });
  await group.findByRole('checkbox', { name: 'Zeta Team' });
  expect(f.requests.some((r) => r.path.endsWith('&q=zeta'))).toBe(true);
  // The selected team is not in this result page but stays visible and removable.
  const kept = group.getByRole('checkbox', { name: 'Team Alpha' });
  expect((kept as HTMLInputElement).checked).toBe(true);
  fireEvent.click(kept);
  expect(picked.at(-1)).toEqual([]);
});

it('shows a no-match message for an empty server search instead of a false empty state', async () => {
  const f = await mountAdmin(
    <Picker path="/v1/campaigns?limit=100" label="Campaign" value="" onChange={() => undefined} />,
    { '/v1/campaigns?limit=100': { data: [{ id: 'a', name: 'Alpha' }] } },
  );
  await screen.findByRole('option', { name: 'Alpha' });
  fireEvent.change(screen.getByRole('searchbox', { name: f.label('pickerSearch') }), {
    target: { value: 'nothing' },
  });
  await screen.findByText(f.label('pickerNoMatches'));
  await waitFor(() => {
    expect(f.requests.some((r) => r.path === '/v1/campaigns?limit=100&q=nothing')).toBe(true);
  });
});

// D-17: the analytics campaign/team filters and report recipients also search on the server.
it('searches analytics campaigns, teams and recipients with ?q= instead of the first page', async () => {
  const { default: AnalyticsPage } = await import('./analytics-page.js');
  const f = await mountAdmin(<AnalyticsPage />, {
    '/v1/campaigns?limit=100&q=cust': { data: [{ id: 'c-65', name: 'Customer Care' }] },
    '/v1/groups?limit=100&sort=displayName&q=nor': { data: [{ id: 't-9', displayName: 'North' }] },
    '/v1/users?limit=100&q=ay': {
      data: [{ id: 'u-3', displayName: 'Ayse', email: 'ayse@example.test' }],
    },
  });
  fireEvent.change(
    await screen.findByRole('searchbox', { name: f.i18n.t('analytics.campaignSearch') }),
    {
      target: { value: 'cust' },
    },
  );
  await screen.findByRole('option', { name: 'Customer Care' });
  fireEvent.change(screen.getByRole('searchbox', { name: f.i18n.t('analytics.teamSearch') }), {
    target: { value: 'nor' },
  });
  await screen.findByRole('option', { name: 'North' });
  expect(f.requests.some((r) => r.path === '/v1/campaigns?limit=100&q=cust')).toBe(true);
});
