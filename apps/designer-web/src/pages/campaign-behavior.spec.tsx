import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';

import { mountDesigner } from '../fixtures.spec.helpers.js';
import { scriptId } from '../test-fixtures.js';

import Campaign from './campaign.js';

const campaign = {
  id: scriptId,
  name: 'Synthetic campaign',
  version: 3,
  status: 'draft',
  description: '',
  channels: ['voice'],
  startsAt: null,
  endsAt: null,
  externalMappings: [],
  defaultLocale: 'en',
  locales: [],
  queues: [],
  outcomeSet: [],
};
async function setup(readOnly = false) {
  return mountDesigner(
    <Campaign />,
    {
      [`/v1/campaigns/${scriptId}`]: campaign,
      [`/v1/assignments?campaignId=${scriptId}&limit=100`]: {
        data: [],
        page: { nextCursor: null },
      },
      [`PATCH /v1/campaigns/${scriptId}`]: campaign,
    },
    {
      route: '/campaigns/:id',
      path: `/campaigns/${scriptId}`,
      ...(readOnly ? { ability: createAbility([{ action: 'read', subject: 'Campaign' }]) } : {}),
    },
  );
}
it('lets campaign managers activate a campaign and define outcomes using versioned writes', async () => {
  const f = await setup();
  fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Campaign settings' }), { button: 0 });
  fireEvent.click(screen.getByRole('combobox', { name: 'Status' }));
  fireEvent.click(await screen.findByRole('option', { name: /^Active$/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Add outcome' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Outcome code' }), {
    target: { value: 'SUCCESS' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Outcome label' }), {
    target: { value: 'Resolved' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save campaign' }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'PATCH')).toBe(true);
  });
  const patch = f.requests.find((r) => r.method === 'PATCH')!;
  expect(new Headers(patch.init?.headers).get('if-match')).toBe('"3"');
  expect(new Headers(patch.init?.headers).get('x-csrf-token')).toBe('synthetic-csrf-only');
  expect(patch.body).toMatchObject({
    status: 'active',
    outcomeSet: [{ code: 'SUCCESS', label: 'Resolved', category: 'success' }],
  });
});
it('does not offer campaign mutations to readers', async () => {
  await setup(true);
  await screen.findByRole('heading', { name: campaign.name });
  expect(screen.queryByRole('tab', { name: 'Campaign settings' })).toBeNull();
});
it('retains changes on a stale-version failure and allows a corrected retry', async () => {
  const f = await setup();
  f.responses[`PATCH /v1/campaigns/${scriptId}`] = Response.json(
    { code: 'VERBIS_VERSION_MISMATCH' },
    { status: 412 },
  );
  fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Campaign settings' }), { button: 0 });
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: 'Retained campaign' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save campaign' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('textbox', { name: 'Name' }).getAttribute('value')).toBe(
    'Retained campaign',
  );
  expect(screen.getByRole('button', { name: 'Save campaign' }).hasAttribute('disabled')).toBe(
    false,
  );
});
it('retains comma-separated outcome requirements and removes only the selected outcome', async () => {
  const f = await setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Add outcome' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Outcome code' }), {
    target: { value: 'SUCCESS' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Outcome label' }), {
    target: { value: 'Resolved' },
  });
  const required = screen.getByRole('textbox', {
    name: 'Required script fields (comma-separated)',
  });
  fireEvent.change(required, { target: { value: 'qaResult,' } });
  expect(required.getAttribute('value')).toBe('qaResult,');
  fireEvent.change(required, { target: { value: 'qaResult, reference, qaResult' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Sub-dispositions (comma-separated)' }), {
    target: { value: 'DONE, FOLLOW_UP' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Require a note' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add outcome' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove outcome' })[1]!);
  fireEvent.click(screen.getByRole('button', { name: 'Save campaign' }));
  await waitFor(() => {
    expect(f.requests.find((r) => r.method === 'PATCH')?.body).toMatchObject({
      outcomeSet: [
        {
          code: 'SUCCESS',
          requiredFields: ['qaResult', 'reference'],
          subCodes: ['DONE', 'FOLLOW_UP'],
          requiresNote: true,
        },
      ],
    });
  });
});
it('rejects invalid locale and duplicate outcome codes before any write', async () => {
  const f = await setup();
  fireEvent.change(await screen.findByRole('textbox', { name: 'Default language' }), {
    target: { value: 'invalid-locale' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save campaign' }));
  await screen.findByRole('alert');
  expect(f.requests.some((r) => r.method === 'PATCH')).toBe(false);
  fireEvent.change(screen.getByRole('textbox', { name: 'Default language' }), {
    target: { value: 'en' },
  });
  for (let i = 0; i < 2; i++) {
    fireEvent.click(screen.getByRole('button', { name: 'Add outcome' }));
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Outcome code' })[i]!, {
      target: { value: 'SUCCESS' },
    });
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Outcome label' })[i]!, {
      target: { value: 'Resolved' },
    });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Save campaign' }));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Save campaign' }).hasAttribute('disabled')).toBe(
      false,
    );
  });
  expect(f.requests.some((r) => r.method === 'PATCH')).toBe(false);
});
it('keeps the save confirmation visible when the API returns a new campaign version', async () => {
  const f = await setup();
  await screen.findByRole('button', { name: 'Save campaign' });
  f.responses[`PATCH /v1/campaigns/${scriptId}`] = { ...campaign, version: 4 };
  f.responses[`/v1/campaigns/${scriptId}`] = { ...campaign, version: 4 };
  fireEvent.click(screen.getByRole('button', { name: 'Save campaign' }));
  await waitFor(() => {
    expect(
      f.requests.filter((r) => r.path === `/v1/campaigns/${scriptId}` && r.method === 'GET'),
    ).toHaveLength(2);
  });
  await waitFor(() => {
    expect(screen.getByRole('status').textContent).toBe('Campaign saved');
  });
});
