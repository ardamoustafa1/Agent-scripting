import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { createAbility } from '@verbis/authz';

import { mountDesigner } from '../fixtures.spec.helpers.js';
import { campaignFixture, pageFixture, scriptFixture } from '../test-fixtures.js';

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

it('combines owner, status and tag filters and clears all of them together', async () => {
  const f = await mountDesigner(<Library kind="scripts" onCreate={vi.fn()} />, {
    '/v1/scripts?limit=100': pageFixture([
      {
        ...scriptFixture,
        name: 'My active script',
        status: 'active',
        tags: ['support'],
        ownerId: '01928f3a-0000-7000-8000-000000000003',
      },
      { ...scriptFixture, id: 'other', name: 'Other draft', status: 'draft', tags: ['sales'] },
    ]),
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('workspace.cardView') }));
  await screen.findByRole('button', { name: 'My active script' });
  fireEvent.click(screen.getByRole('combobox', { name: f.label('workspace.owner') }));
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
