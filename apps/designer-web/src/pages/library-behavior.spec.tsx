import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { createAbility } from '@verbis/authz';

import { mountDesigner } from '../fixtures.spec.helpers.js';
import { campaignFixture, pageFixture, scriptFixture, sessionFixture } from '../test-fixtures.js';

import Library from './library.js';

it('does not offer inaccessible templates to a campaign-only reader', async () => {
  const f = await mountDesigner(
    <Library kind="campaigns" onCreate={vi.fn()} />,
    {
      '/v1/campaigns?limit=100': pageFixture([campaignFixture]),
    },
    { ability: createAbility([{ action: 'read', subject: 'Campaign' }]) },
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('workspace.cardView') }));
  await screen.findByRole('button', { name: campaignFixture.name });
  expect(screen.queryByRole('button', { name: f.label('workspace.exploreTemplates') })).toBeNull();
});

it('clears filters from the no-results state and restores the existing list', async () => {
  const create = vi.fn();
  const f = await mountDesigner(<Library kind="scripts" onCreate={create} />, {
    '/v1/scripts?limit=100': pageFixture([scriptFixture]),
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('workspace.cardView') }));
  await screen.findByRole('button', { name: scriptFixture.name });
  fireEvent.change(screen.getByRole('textbox', { name: f.label('workspace.searchLibrary') }), {
    target: { value: 'no-matching-script' },
  });
  await screen.findByText(f.label('workspace.noResults'));
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(await screen.findByRole('button', { name: scriptFixture.name })).toBeTruthy();
  expect(create).not.toHaveBeenCalled();
});

it('preserves loaded rows after a failed next page and retries that page', async () => {
  const f = await mountDesigner(<Library kind="scripts" onCreate={vi.fn()} />, {
    '/v1/scripts?limit=100': { data: [scriptFixture], page: { nextCursor: 'next-page' } },
    '/v1/scripts?limit=100&cursor=next-page': Response.json(
      { code: 'VERBIS_HTTP_UNAVAILABLE' },
      { status: 503 },
    ),
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('workspace.cardView') }));
  await screen.findByRole('button', { name: scriptFixture.name });
  fireEvent.click(screen.getByRole('button', { name: f.label('workspace.loadMore') }));
  const alert = await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: scriptFixture.name })).toBeTruthy();
  f.responses['/v1/scripts?limit=100&cursor=next-page'] = pageFixture([
    { ...scriptFixture, id: 'second-script', name: 'Second script' },
  ]);
  fireEvent.click(within(alert).getByRole('button', { name: f.label('workspace.retry') }));
  await screen.findByRole('button', { name: 'Second script' });
  await waitFor(() => {
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

it('retries a failed initial request and restores the library', async () => {
  const f = await mountDesigner(<Library kind="scripts" onCreate={vi.fn()} />, {
    '/v1/scripts?limit=100': Response.json({ code: 'VERBIS_HTTP_UNAVAILABLE' }, { status: 503 }),
  });
  await screen.findByText(f.label('workspace.error'));
  f.responses['/v1/scripts?limit=100'] = pageFixture([scriptFixture]);
  fireEvent.click(screen.getByRole('button', { name: f.label('workspace.retry') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('workspace.cardView') }));
  expect(await screen.findByRole('button', { name: scriptFixture.name })).toBeTruthy();
});

it('combines creator, status and tag filters and clears all of them together', async () => {
  const f = await mountDesigner(<Library kind="scripts" onCreate={vi.fn()} />, {
    '/v1/scripts?limit=100': pageFixture([
      {
        ...scriptFixture,
        name: 'My active script',
        status: 'active',
        tags: ['support'],
        createdBy: `user:${sessionFixture.user.id}`,
      },
      {
        ...scriptFixture,
        id: 'other',
        name: 'Other draft',
        status: 'draft',
        tags: ['sales'],
        createdBy: 'user:01928f3a-0000-7000-8000-0000000000ff',
      },
    ]),
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('workspace.cardView') }));
  await screen.findByRole('button', { name: 'My active script' });
  fireEvent.click(screen.getByRole('combobox', { name: f.label('workspace.createdBy') }));
  fireEvent.click(await screen.findByRole('option', { name: f.label('workspace.owners.mine') }));
  expect(screen.queryByRole('button', { name: 'Other draft' })).toBeNull();
  fireEvent.click(screen.getByRole('combobox', { name: f.label('workspace.statusFilter') }));
  fireEvent.click(await screen.findByRole('option', { name: f.label('workspace.status.draft') }));
  await screen.findByText(f.label('workspace.noResults'));
  fireEvent.click(screen.getByRole('combobox', { name: f.label('workspace.tags') }));
  fireEvent.click(await screen.findByRole('option', { name: 'sales' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(await screen.findByRole('button', { name: 'My active script' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Other draft' })).toBeTruthy();
  fireEvent.click(screen.getByRole('combobox', { name: f.label('workspace.createdBy') }));
  fireEvent.click(await screen.findByRole('option', { name: f.label('workspace.owners.others') }));
  expect(await screen.findByRole('button', { name: 'Other draft' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'My active script' })).toBeNull();
});

it('names who created each row and keeps a single search box', async () => {
  const f = await mountDesigner(<Library kind="scripts" onCreate={vi.fn()} />, {
    '/v1/scripts?limit=100': pageFixture([
      { ...scriptFixture, name: 'Mine', createdBy: `user:${sessionFixture.user.id}` },
      {
        ...scriptFixture,
        id: 'teammate',
        name: 'Teammate',
        createdBy: 'user:01928f3a-0000-7000-8000-0000000000ff',
      },
      { ...scriptFixture, id: 'system', name: 'From a template', createdBy: 'service:templates' },
      {
        ...scriptFixture,
        id: 'former',
        name: 'Left the team',
        createdBy: 'user:01928f3a-0000-7000-8000-0000000000fe',
      },
    ]),
    // Only the teammates are asked for, sorted; a person no longer active is not returned.
    '/v1/people?ids=01928f3a-0000-7000-8000-0000000000fe,01928f3a-0000-7000-8000-0000000000ff': [
      { id: '01928f3a-0000-7000-8000-0000000000ff', name: 'Deniz Yılmaz' },
    ],
  });
  const table = await screen.findByRole('table', { name: f.label('workspace.nav.scripts') });
  fireEvent.click(screen.getByRole('button', { name: 'Show all rows' }));
  expect(within(table).getByRole('columnheader', { name: /Created by/ })).toBeTruthy();
  const cell = (name: string) =>
    within(within(table).getByRole('button', { name }).closest('tr')!).getAllByRole('cell')[3]!;
  expect(cell('Mine').textContent).toBe(f.label('workspace.you'));
  await waitFor(() => {
    expect(cell('Teammate').textContent).toBe('Deniz Yılmaz');
  });
  expect(cell('Left the team').textContent).toBe(f.label('workspace.owners.former'));
  expect(cell('From a template').textContent).toBe(f.label('workspace.owners.system'));
  expect(screen.queryByText(f.label('workspace.unassigned'))).toBeNull();
  // The page search is the only search box; the table adds no "Filter records" field.
  expect(screen.getByRole('textbox', { name: f.label('workspace.searchLibrary') })).toBeTruthy();
  expect(screen.queryByLabelText('Filter records')).toBeNull();
  expect(screen.queryByRole('searchbox')).toBeNull();
});

it('marks retained data as stale after a refresh failure and recovers through retry', async () => {
  const f = await mountDesigner(<Library kind="scripts" onCreate={vi.fn()} />, {
    '/v1/scripts?limit=100': pageFixture([scriptFixture]),
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('workspace.cardView') }));
  await screen.findByRole('button', { name: scriptFixture.name });
  f.responses['/v1/scripts?limit=100'] = Response.json(
    { code: 'VERBIS_HTTP_UNAVAILABLE' },
    { status: 503 },
  );
  await f.client.invalidateQueries({ queryKey: ['workspace'] });
  const alert = await screen.findByRole('alert');
  expect(
    within(alert).getByText('The list could not be refreshed. Showing the last loaded results.'),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: scriptFixture.name })).toBeTruthy();
  f.responses['/v1/scripts?limit=100'] = pageFixture([
    { ...scriptFixture, name: 'Refreshed script' },
  ]);
  fireEvent.click(within(alert).getByRole('button', { name: f.label('workspace.retry') }));
  await screen.findByRole('button', { name: 'Refreshed script' });
  expect(screen.queryByRole('alert')).toBeNull();
});

it('draws the campaigns banner flow with named branches, not empty boxes', async () => {
  const f = await mountDesigner(<Library kind="campaigns" onCreate={vi.fn()} />, {
    '/v1/campaigns?limit=100': pageFixture([campaignFixture]),
  });
  await screen.findByRole('button', { name: f.label('workspace.exploreTemplates') });
  const branches = [...document.querySelectorAll('.dw-canvas-branches > span')];
  expect(branches.map((branch) => branch.textContent)).toEqual([
    f.label('workspace.canvasBranchSale'),
    f.label('workspace.canvasBranchSupport'),
  ]);
});

it('keeps "team member" when names cannot be read', async () => {
  const f = await mountDesigner(<Library kind="campaigns" onCreate={vi.fn()} />, {
    '/v1/campaigns?limit=100': pageFixture([
      { ...campaignFixture, createdBy: 'user:01928f3a-0000-7000-8000-0000000000ff' },
    ]),
    '/v1/people?ids=01928f3a-0000-7000-8000-0000000000ff': Response.json(
      { code: 'VERBIS_AUTHZ_FORBIDDEN' },
      { status: 403 },
    ),
  });
  const table = await screen.findByRole('table', { name: f.label('workspace.nav.campaigns') });
  fireEvent.click(screen.getByRole('button', { name: 'Show all rows' }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.path.startsWith('/v1/people'))).toBe(true);
  });
  expect(within(table).getByText(f.label('workspace.owners.member'))).toBeTruthy();
});

it('hides archived scripts until the author asks for every status', async () => {
  const f = await mountDesigner(<Library kind="scripts" onCreate={vi.fn()} />, {
    '/v1/scripts?limit=100': pageFixture([
      { ...scriptFixture, name: 'In use' },
      { ...scriptFixture, id: 'old', name: 'Old trial', status: 'archived' },
    ]),
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('workspace.cardView') }));
  await screen.findByRole('button', { name: 'In use' });
  expect(screen.queryByRole('button', { name: 'Old trial' })).toBeNull();
  // The heading counts what the list shows by default.
  expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('1');
  fireEvent.click(screen.getByRole('combobox', { name: f.label('workspace.statusFilter') }));
  fireEvent.click(await screen.findByRole('option', { name: f.label('workspace.allStatuses') }));
  expect(await screen.findByRole('button', { name: 'Old trial' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Old trial' })).toBeNull();
  });
});
