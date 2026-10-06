import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';

import { mountDesigner } from '../fixtures.spec.helpers.js';
import { campaignId, scriptId, tenantId } from '../test-fixtures.js';

import AssignmentsPage from './assignments.js';

const row = {
  id: tenantId,
  scriptId,
  campaignId,
  version: 4,
  priority: 20,
  effectiveFrom: '2026-10-03T10:00:00Z',
  effectiveTo: '2026-11-03T10:00:00Z',
  expression: { fact: 'interaction.channel', op: 'eq', value: 'voice' },
  variants: [
    { key: 'a', weight: 4000, pinnedVersionId: scriptId },
    { key: 'b', weight: 6000 },
  ],
};
const params = `/v1/assignments?scriptId=${scriptId}&limit=100&sort=priority`;
async function setup(extra: Record<string, unknown> = {}) {
  const f = await mountDesigner(
    <AssignmentsPage />,
    {
      [params]: { data: [row], page: { nextCursor: null } },
      [`/v1/assignments?campaignId=${campaignId}&limit=100&sort=priority`]: {
        data: [row],
        page: { nextCursor: null },
      },
      '/v1/campaigns?limit=100': {
        data: [{ id: campaignId, name: 'Synthetic campaign' }],
        page: { nextCursor: null },
      },
      '/v1/scripts?limit=100': {
        data: [{ id: scriptId, name: 'Synthetic script' }],
        page: { nextCursor: null },
      },
      [`/v1/scripts/${scriptId}/versions?limit=100&sort=-number`]: {
        data: [
          { id: scriptId, number: 3, state: 'published', createdAt: 'synthetic' },
          { id: campaignId, number: 2, state: 'published', createdAt: 'synthetic' },
        ],
        page: { nextCursor: null },
      },
      '/v1/script-resolutions': { scriptId, number: 3, synthetic: true },
      ...extra,
    },
    { path: `/scripts/${scriptId}/assignments`, route: '/scripts/:id/assignments' },
  );
  await screen.findByText('Synthetic campaign');
  return f;
}
async function choose(label: string, name: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name }));
}
it('edits versioned assignments, A/B weights and pinned versions', async () => {
  const f = await setup();
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.apply') }));
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.aWeight')), {
    target: { value: '100' },
  });
  const save = screen.getByRole('button', { name: f.label('lifecycle.save') });
  expect(save.hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.aWeight')), {
    target: { value: '35' },
  });
  await choose(f.label('lifecycle.bVersion'), 'v2');
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.validFrom')), {
    target: { value: '' },
  });
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.validTo')), { target: { value: '' } });
  fireEvent.click(save);
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'POST')).toBe(true);
  });
  expect(f.requests.find((r) => r.method === 'POST')!.body).toEqual({
    updates: [
      {
        id: tenantId,
        version: 4,
        patch: {
          effectiveFrom: null,
          effectiveTo: null,
          expression: row.expression,
          variants: [
            { key: 'a', weight: 3500, pinnedVersionId: scriptId },
            { key: 'b', weight: 6500, pinnedVersionId: campaignId },
          ],
        },
      },
    ],
  });
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: f.label('lifecycle.cancel') })).toBeNull();
  });
});
it('creates campaign assignments with A/B disabled and validates date windows', async () => {
  const f = await setup();
  fireEvent.click(screen.getByRole('button', { name: f.label('workspace.nav.campaigns') }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Synthetic campaign' }));
  fireEvent.keyDown(screen.getByRole('checkbox', { name: 'Synthetic campaign' }), {
    key: 'Escape',
  });
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.validFrom')), {
    target: { value: '2026-10-05T12:00' },
  });
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.validTo')), {
    target: { value: '2026-10-04T12:00' },
  });
  const save = screen.getByRole('button', { name: f.label('lifecycle.save') });
  expect(save.hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.validTo')), {
    target: { value: '2026-10-06T12:00' },
  });
  fireEvent.click(save);
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'POST')).toBe(true);
  });
  expect(f.requests.find((r) => r.method === 'POST')!.body).toMatchObject({
    creates: [
      {
        scriptId,
        campaignId,
        priority: 100,
        variants: null,
        expression: { fact: 'interaction.channel', op: 'exists' },
      },
    ],
  });
});
it('saves campaign-scoped priorities only when the complete page is loaded', async () => {
  const f = await setup();
  const save = screen.getByRole('button', { name: f.label('lifecycle.savePriorities') });
  expect(save.hasAttribute('disabled')).toBe(true);
  await choose(f.label('lifecycle.priorityCampaign'), 'Synthetic campaign');
  await screen.findByText('Synthetic script');
  await waitFor(() => {
    expect(
      screen
        .getByRole('button', { name: f.label('lifecycle.savePriorities') })
        .hasAttribute('disabled'),
    ).toBe(false);
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.savePriorities') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'POST')).toBe(true);
  });
  expect(f.requests.find((r) => r.method === 'POST')!.body).toEqual({
    updates: [{ id: tenantId, version: 4, patch: { priority: 0 } }],
  });
});
it('simulates resolver decisions with synthetic attributes and rejects malformed JSON', async () => {
  const f = await setup();
  await choose(f.label('workspace.nav.campaigns'), 'Synthetic campaign');
  await choose(f.label('preview.channel'), 'chat');
  const input = screen.getByLabelText(f.label('lifecycle.context'));
  fireEvent.change(input, { target: { value: '{' } });
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.resolveContext') }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(f.requests.some((r) => r.method === 'POST')).toBe(false);
  fireEvent.change(input, { target: { value: '{"synthetic":true}' } });
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.resolveContext') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.path === '/v1/script-resolutions')).toBe(true);
  });
  expect(f.requests.find((r) => r.path === '/v1/script-resolutions')!.body).toEqual({
    campaignId,
    channel: 'chat',
    locale: 'tr',
    attributes: { synthetic: true },
  });
});
it('keeps an assignment editor open when batch saving fails and allows cancel', async () => {
  const f = await setup({ '/v1/assignments/batch': Response.json({}, { status: 500 }) });
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.apply') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.save') }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.cancel') }));
  expect(screen.queryByRole('button', { name: f.label('lifecycle.cancel') })).toBeNull();
});
it('shows assignment loading errors', async () => {
  const f = await mountDesigner(
    <AssignmentsPage />,
    { [params]: Response.json({}, { status: 503 }) },
    {
      path: `/scripts/${scriptId}/assignments`,
      route: '/scripts/:id/assignments',
      ability: createAbility([]),
    },
  );
  expect(await screen.findByRole('button', { name: f.label('workspace.retry') })).toBeTruthy();
});
it('explains campaign permission when a designer cannot save assignments', async () => {
  const f = await mountDesigner(
    <AssignmentsPage />,
    {
      [params]: { data: [row], page: { nextCursor: null } },
      '/v1/campaigns?limit=100': {
        data: [{ id: campaignId, name: 'Synthetic campaign' }],
        page: { nextCursor: null },
      },
    },
    {
      path: `/scripts/${scriptId}/assignments`,
      route: '/scripts/:id/assignments',
      ability: createAbility([
        { action: 'read', subject: 'Campaign' },
        { action: 'read', subject: 'Script' },
      ]),
    },
  );
  expect(await screen.findByText(f.label('editor.assignmentPermission'))).toBeTruthy();
  expect(f.requests.some((r) => r.method === 'POST')).toBe(false);
});
