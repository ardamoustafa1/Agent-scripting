import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { createAbility } from '@verbis/authz';

import { mountDesigner } from '../fixtures.spec.helpers.js';
import { scriptFixture, campaignFixture, pageFixture } from '../test-fixtures.js';

import { CreateDialog } from './create-dialog.js';

const campaigns = { 'GET /v1/campaigns?limit=100&sort=name': pageFixture([campaignFixture]) };
async function chooseCampaign(label: string) {
  await waitFor(() => {
    expect(screen.getByRole('combobox', { name: label }).hasAttribute('disabled')).toBe(false);
  });
  fireEvent.change(screen.getByRole('combobox', { name: label }), {
    target: { value: campaignFixture.id },
  });
}

it.each(['campaigns', 'scripts'] as const)(
  'creates %s with CSRF and navigates to the created resource',
  async (kind) => {
    const close = vi.fn();
    const item = kind === 'campaigns' ? campaignFixture : scriptFixture;
    const f = await mountDesigner(<CreateDialog kind={kind} open onOpenChange={close} />, {
      ...campaigns,
      [`POST /v1/${kind}`]: item,
    });
    const create = screen.getByRole('button', { name: f.label('workspace.create') });
    expect(create.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText(f.label('workspace.name')), {
      target: { value: 'Synthetic resource' },
    });
    fireEvent.change(screen.getByLabelText(f.label('workspace.description')), {
      target: { value: 'Synthetic description' },
    });
    if (kind === 'scripts') await chooseCampaign(f.label('workspace.createCampaign'));
    fireEvent.submit(create.closest('form')!);
    await waitFor(() => {
      expect(close).toHaveBeenCalledWith(false);
    });
    expect(f.router.state.location.pathname).toBe(`/${kind}/${item.id}`);
    const request = f.requests.find((r) => r.method === 'POST')!;
    expect(request.body).toMatchObject({
      name: 'Synthetic resource',
      description: 'Synthetic description',
    });
    if (kind === 'campaigns')
      expect(request.body).toMatchObject({
        channels: ['voice'],
        status: 'draft',
        defaultLocale: 'tr',
      });
    else expect(request.body).toMatchObject({ tags: [] });
    expect(new Headers(request.init?.headers).get('x-csrf-token')).toBe('synthetic-csrf-only');
    expect(new Headers(request.init?.headers).get('idempotency-key')).toBeTruthy();
  },
);
it('retains the idempotency key for retries and creates a fresh key for changed submissions', async () => {
  const f = await mountDesigner(<CreateDialog kind="scripts" open onOpenChange={vi.fn()} />, {
    ...campaigns,
    'POST /v1/scripts': Response.json({ code: 'VERBIS_HTTP_UNAVAILABLE' }, { status: 503 }),
  });
  await chooseCampaign(f.label('workspace.createCampaign'));
  fireEvent.change(screen.getByLabelText(f.label('workspace.name')), {
    target: { value: 'Synthetic resource' },
  });
  const form = screen.getByRole('button', { name: f.label('workspace.create') }).closest('form')!;
  fireEvent.submit(form);
  await screen.findByText(f.label('workspace.error'));
  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: f.label('workspace.create') }).hasAttribute('disabled'),
    ).toBe(false);
  });
  fireEvent.submit(form);
  await waitFor(() => {
    expect(f.requests.filter((r) => r.method === 'POST')).toHaveLength(2);
  });
  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: f.label('workspace.create') }).hasAttribute('disabled'),
    ).toBe(false);
  });
  fireEvent.change(screen.getByLabelText(f.label('workspace.name')), {
    target: { value: 'Changed resource' },
  });
  fireEvent.submit(form);
  await waitFor(() => {
    expect(f.requests.filter((r) => r.method === 'POST')).toHaveLength(3);
  });
  const keys = f.requests
    .filter((r) => r.method === 'POST')
    .map((r) => new Headers(r.init?.headers).get('idempotency-key'));
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
});
it('hides creation dialogs when the principal lacks permission', async () => {
  await mountDesigner(
    <CreateDialog kind="scripts" open onOpenChange={vi.fn()} />,
    {},
    { ability: createAbility([]) },
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('requires a campaign for script creation and explains a campaign-scope 403', async () => {
  const f = await mountDesigner(<CreateDialog kind="scripts" open onOpenChange={vi.fn()} />, {
    ...campaigns,
    'POST /v1/scripts': Response.json({ code: 'VERBIS_AUTHZ_SCOPE_MISSING' }, { status: 403 }),
  });
  fireEvent.change(screen.getByLabelText(f.label('workspace.name')), {
    target: { value: 'Synthetic' },
  });
  expect(
    screen.getByRole('button', { name: f.label('workspace.create') }).hasAttribute('disabled'),
  ).toBe(true);
  await chooseCampaign(f.label('workspace.createCampaign'));
  fireEvent.submit(
    screen.getByRole('button', { name: f.label('workspace.create') }).closest('form')!,
  );
  await screen.findByText(f.label('workspace.scopeMissing'));
  expect(f.requests.find((r) => r.method === 'POST')?.body).toMatchObject({
    campaignId: campaignFixture.id,
  });
});
it('starts a script from a tested template and opens its first version', async () => {
  const close = vi.fn();
  const f = await mountDesigner(<CreateDialog kind="scripts" open onOpenChange={close} />, {
    ...campaigns,
    'GET /v1/templates': [
      { id: 'builtin-nps-survey', name: 'NPS survey', builtIn: true },
      { id: '01928f3a-0000-7000-8000-0000000000cc', name: 'Team template', builtIn: false },
    ],
    'POST /v1/templates/builtin-nps-survey/instantiate': {
      script: { id: scriptFixture.id },
      version: { number: 1 },
    },
  });
  fireEvent.change(screen.getByLabelText(f.label('workspace.name')), {
    target: { value: 'Synthetic survey' },
  });
  fireEvent.click(screen.getByRole('radio', { name: f.label('workspace.startWith.template') }));
  // The campaign is chosen by the template flow, so its field is gone.
  expect(screen.queryByRole('combobox', { name: f.label('workspace.createCampaign') })).toBeNull();
  const create = screen.getByRole('button', { name: f.label('workspace.create') });
  expect(create.hasAttribute('disabled')).toBe(true);
  const picker = await screen.findByRole('combobox', {
    name: f.label('workspace.startWith.choose'),
  });
  await waitFor(() => {
    expect(picker.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.click(picker);
  fireEvent.click(
    await screen.findByRole('option', { name: f.label('lifecycle.templates.builtin-nps-survey') }),
  );
  fireEvent.submit(create.closest('form')!);
  await waitFor(() => {
    expect(close).toHaveBeenCalledWith(false);
  });
  expect(f.router.state.location.pathname).toBe(`/scripts/${scriptFixture.id}/versions/1/edit`);
  const request = f.requests.find((r) => r.method === 'POST')!;
  expect(request.path).toBe('/v1/templates/builtin-nps-survey/instantiate');
  expect(request.body).toEqual({ name: 'Synthetic survey' });
});
