import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { createAbility } from '@verbis/authz';

import { mountDesigner } from '../fixtures.spec.helpers.js';
import { campaignId, scriptId, tenantId } from '../test-fixtures.js';

import { LinkedScreens } from './linked-screens.js';
import { ReuseScreen } from './reuse-screen.js';

it.each([true, false])(
  'attaches eligible shared screens and handles success=%s',
  async (succeeds) => {
    const attach = vi
      .fn<(id: string, number: number) => Promise<void>>()
      .mockImplementation(() =>
        succeeds ? Promise.resolve() : Promise.reject(new Error('synthetic')),
      );
    const f = await mountDesigner(<ReuseScreen used={[campaignId]} attach={attach} />, {
      '/v1/shared-screens': [
        { id: campaignId, name: 'Already used', latest: { number: 1 } },
        { id: tenantId, name: 'Unpublished', latest: null },
        { id: scriptId, name: 'Eligible screen', latest: { number: 7 } },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: f.label('editor.reuse') }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('combobox', { name: f.label('editor.linked') }));
    fireEvent.click(await screen.findByRole('option', { name: 'Eligible screen' }));
    expect(screen.queryByRole('option', { name: 'Already used' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: f.label('editor.attach') }));
    await waitFor(() => {
      expect(attach).toHaveBeenCalledWith(scriptId, 7);
    });
    if (succeeds)
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
    else {
      expect(await screen.findByRole('alert')).toBeTruthy();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
    }
  },
);
it('shows shared-screen loading errors without allowing an attachment', async () => {
  const attach = vi.fn();
  const f = await mountDesigner(<ReuseScreen used={[]} attach={attach} />, {
    '/v1/shared-screens': Response.json({}, { status: 500 }),
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.reuse') }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: f.label('editor.attach') }).hasAttribute('disabled'),
  ).toBe(true);
  expect(attach).not.toHaveBeenCalled();
});
it('lists linked versions and deduplicates campaign impacts across cursor pages', async () => {
  const params = new URLSearchParams({ scriptId, limit: '100' });
  const f = await mountDesigner(<LinkedScreens ids={[tenantId]} />, {
    [`/v1/shared-screens/${tenantId}/impact`]: {
      affected: [
        { scriptId, scriptName: 'Synthetic dependent', versionNumber: 1, outdated: true },
        { scriptId, scriptName: 'Synthetic dependent', versionNumber: 2, outdated: false },
      ],
    },
    [`/v1/assignments?${params}`]: {
      data: [{ campaignId }],
      page: { nextCursor: 'synthetic cursor' },
    },
    [`/v1/assignments?${params}&cursor=synthetic+cursor`]: {
      data: [{ campaignId }],
      page: { nextCursor: null },
    },
    [`/v1/campaigns/${campaignId}`]: { name: 'Synthetic campaign impact' },
  });
  expect(await screen.findByText('Synthetic campaign impact')).toBeTruthy();
  expect(f.requests.filter((r) => r.path === `/v1/campaigns/${campaignId}`)).toHaveLength(1);
  expect(screen.getByText(f.label('editor.outdated'))).toBeTruthy();
  expect(f.requests.filter((r) => r.path.startsWith('/v1/assignments?'))).toHaveLength(2);
});
it('handles inaccessible linked impacts and does not query forbidden resources', async () => {
  const f = await mountDesigner(
    <LinkedScreens ids={[tenantId]} />,
    {},
    { ability: createAbility([]) },
  );
  expect(f.requests).toHaveLength(0);
  expect(screen.getByText(f.label('editor.linkedReadonly'))).toBeTruthy();
});
it('reports failed linked-screen dependencies', async () => {
  const f = await mountDesigner(<LinkedScreens ids={[tenantId]} />, {
    [`/v1/shared-screens/${tenantId}/impact`]: Response.json({}, { status: 500 }),
  });
  expect(await screen.findByText(f.label('editor.impactUnavailable'))).toBeTruthy();
});
it('omits linked-screen information for drafts without shared screens', async () => {
  const f = await mountDesigner(<LinkedScreens ids={[]} />);
  expect(screen.queryByText(f.label('editor.linkedReadonly'))).toBeNull();
  expect(f.requests).toHaveLength(0);
});
