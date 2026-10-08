import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import ServiceClients from './clients-page.js';
import { mountAdmin, syntheticId } from './fixtures.spec.helpers.js';

const client = (extra: object = {}) => ({
  id: syntheticId,
  version: 4,
  clientId: syntheticId,
  name: 'Reporting export',
  authMethod: 'client_secret_basic',
  scopes: ['read:Report', 'export:Report'],
  status: 'active',
  certificateThumbprint: null,
  lastUsedAt: null,
  tokenEndpoint: 'https://api.example.test/oauth2/acme/token',
  ...extra,
});
/** The data table renders rows only once "show all rows" is chosen (virtualised in jsdom). */
const showRows = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /show all rows/i }));
};
const created = (extra: object = {}) => ({
  ...client(),
  clientSecret: 'synthetic-secret-value',
  ...extra,
});

it('lists clients with readable labels and says when one was never used', async () => {
  const f = await mountAdmin(<ServiceClients />, { '/v1/service-clients': [client()] });
  await showRows();
  expect(await screen.findByText('Reporting export')).toBeTruthy();
  expect(
    within(screen.getByRole('table')).getByText(
      f.i18n.t('adminWorkspace.enum.clientAuth.client_secret_basic'),
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(f.i18n.t('adminWorkspace.clients.scopeCount', { count: 2 })),
  ).toBeTruthy();
  expect(screen.getByText(f.label('clients.neverUsed'))).toBeTruthy();
  // No raw machine value reaches the screen.
  expect(screen.queryByText('client_secret_basic')).toBeNull();
});

it('needs a permission before creating, sends exactly the chosen scopes, and shows the secret once', async () => {
  const f = await mountAdmin(<ServiceClients />, {
    '/v1/service-clients': [],
    'POST /v1/service-clients': created(),
  });
  await screen.findAllByText(f.label('empty'));
  const save = screen.getByRole<HTMLButtonElement>('button', {
    name: f.label('clients.createButton'),
  });
  fireEvent.change(screen.getByLabelText(f.label('name')), {
    target: { value: ' Reporting export ' },
  });
  expect(save.disabled).toBe(true);
  expect(screen.getByText(f.label('clients.pickScope'))).toBeTruthy();
  const report = screen.getByRole('group', {
    name: f.i18n.t('adminWorkspace.enum.resource.report'),
  });
  fireEvent.click(
    within(report).getByRole('checkbox', { name: f.i18n.t('adminWorkspace.enum.action.read') }),
  );
  fireEvent.click(
    within(report).getByRole('checkbox', { name: f.i18n.t('adminWorkspace.enum.action.export') }),
  );
  await waitFor(() => {
    expect(save.disabled).toBe(false);
  });
  fireEvent.submit(save.closest('form')!);
  expect(await screen.findByText(f.label('clients.revealTitle'))).toBeTruthy();
  const sent = f.requests.find((r) => r.method === 'POST')!;
  expect(sent.body).toEqual({
    name: 'Reporting export',
    authMethod: 'client_secret_basic',
    scopes: expect.arrayContaining(['read:Report', 'export:Report']) as string[],
  });
  expect((sent.body as { scopes: string[] }).scopes).toHaveLength(2);
  expect(screen.getByTestId('client-secret').textContent).toBe('synthetic-secret-value');
  // It cannot be dismissed before the operator confirms having stored it.
  const done = screen.getByRole<HTMLButtonElement>('button', { name: f.label('clients.done') });
  expect(done.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: f.label('clients.stored') }));
  fireEvent.click(done);
  await waitFor(() => {
    expect(screen.queryByTestId('client-secret')).toBeNull();
  });
  expect(document.body.textContent).not.toContain('synthetic-secret-value');
});

it('copies the secret and reports when copying is blocked', async () => {
  const writeText = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('denied'));
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const f = await mountAdmin(<ServiceClients />, {
    '/v1/service-clients': [],
    'POST /v1/service-clients': created(),
  });
  await screen.findAllByText(f.label('empty'));
  fireEvent.change(screen.getByLabelText(f.label('name')), { target: { value: 'Export' } });
  fireEvent.click(
    within(
      screen.getByRole('group', { name: f.i18n.t('adminWorkspace.enum.resource.report') }),
    ).getByRole('checkbox', { name: f.i18n.t('adminWorkspace.enum.action.read') }),
  );
  fireEvent.submit(
    screen.getByRole('button', { name: f.label('clients.createButton') }).closest('form')!,
  );
  fireEvent.click(await screen.findByRole('button', { name: f.label('clients.copySecret') }));
  expect(await screen.findByText(f.label('clients.copied'))).toBeTruthy();
  expect(writeText).toHaveBeenCalledWith('synthetic-secret-value');
  fireEvent.click(screen.getByRole('button', { name: f.label('clients.copySecret') }));
  expect(await screen.findByText(f.label('clients.copyFailed'))).toBeTruthy();
});

it('requires a certificate for mutual TLS and shows no secret afterwards', async () => {
  const f = await mountAdmin(<ServiceClients />, {
    '/v1/service-clients': [],
    'POST /v1/service-clients': created({ authMethod: 'tls_client_auth', clientSecret: null }),
  });
  await screen.findAllByText(f.label('empty'));
  fireEvent.change(screen.getByLabelText(f.label('clients.authMethod')), {
    target: { value: 'tls_client_auth' },
  });
  expect(screen.getByText(f.label('clients.authHint.tls_client_auth'))).toBeTruthy();
  fireEvent.change(screen.getByLabelText(f.label('name')), { target: { value: 'Gateway' } });
  fireEvent.click(
    within(
      screen.getByRole('group', { name: f.i18n.t('adminWorkspace.enum.resource.report') }),
    ).getByRole('checkbox', { name: f.i18n.t('adminWorkspace.enum.action.read') }),
  );
  const save = screen.getByRole<HTMLButtonElement>('button', {
    name: f.label('clients.createButton'),
  });
  expect(save.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(f.label('clients.certificateRequired')), {
    target: { value: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----' },
  });
  await waitFor(() => {
    expect(save.disabled).toBe(false);
  });
  fireEvent.submit(save.closest('form')!);
  expect(await screen.findByText(f.label('clients.noSecret'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: f.label('clients.copySecret') })).toBeNull();
});

it('edits with the row version, rotates the secret behind a confirmation and deletes the same way', async () => {
  const f = await mountAdmin(<ServiceClients />, {
    '/v1/service-clients': [client()],
    [`PATCH /v1/service-clients/${syntheticId}`]: client({ version: 5 }),
    [`POST /v1/service-clients/${syntheticId}/secret`]: created({ clientSecret: 'rotated-secret' }),
    [`DELETE /v1/service-clients/${syntheticId}`]: new Response(null, { status: 204 }),
  });
  await showRows();
  fireEvent.click(await screen.findByRole('button', { name: f.label('details') }));
  const name = await screen.findByDisplayValue('Reporting export');
  fireEvent.change(name, { target: { value: 'Reporting v2' } });
  fireEvent.change(screen.getByLabelText(f.label('status')), { target: { value: 'disabled' } });
  fireEvent.submit(name.closest('form')!);
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'PATCH')).toBe(true);
  });
  const patch = f.requests.find((r) => r.method === 'PATCH')!;
  expect(patch.body).toEqual({
    name: 'Reporting v2',
    status: 'disabled',
    scopes: expect.arrayContaining(['read:Report', 'export:Report']) as string[],
  });
  expect((patch.init?.headers as Record<string, string>)['if-match']).toBe('"4"');
});

it('rotates only after the operator confirms', async () => {
  const f = await mountAdmin(<ServiceClients />, {
    '/v1/service-clients': [client()],
    [`POST /v1/service-clients/${syntheticId}/secret`]: created({ clientSecret: 'rotated-secret' }),
  });
  await showRows();
  fireEvent.click(await screen.findByRole('button', { name: f.label('details') }));
  fireEvent.click(await screen.findByRole('button', { name: f.label('clients.rotate') }));
  expect(f.requests.some((r) => r.path.endsWith('/secret'))).toBe(false);
  fireEvent.click(await screen.findByRole('button', { name: f.label('confirm') }));
  expect((await screen.findByTestId('client-secret')).textContent).toBe('rotated-secret');
});

it('deletes with the row version after confirmation', async () => {
  const f = await mountAdmin(<ServiceClients />, {
    '/v1/service-clients': [client()],
    [`DELETE /v1/service-clients/${syntheticId}`]: new Response(null, { status: 204 }),
  });
  await showRows();
  fireEvent.click(await screen.findByRole('button', { name: f.label('details') }));
  fireEvent.click(await screen.findByRole('button', { name: f.label('clients.delete') }));
  fireEvent.click(await screen.findByRole('button', { name: f.label('confirm') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'DELETE')).toBe(true);
  });
  expect(
    (f.requests.find((r) => r.method === 'DELETE')?.init?.headers as Record<string, string>)[
      'if-match'
    ],
  ).toBe('"4"');
});

it('offers no rotation for certificate clients', async () => {
  const f = await mountAdmin(<ServiceClients />, {
    '/v1/service-clients': [client({ authMethod: 'tls_client_auth' })],
  });
  await showRows();
  fireEvent.click(await screen.findByRole('button', { name: f.label('details') }));
  expect(await screen.findByText(f.label('clients.mtlsNoSecret'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: f.label('clients.rotate') })).toBeNull();
});

it('offers quick selections for the permission list', async () => {
  const f = await mountAdmin(<ServiceClients />, { '/v1/service-clients': [] });
  await screen.findAllByText(f.label('empty'));
  fireEvent.click(screen.getByRole('button', { name: f.label('clients.presetRead') }));
  const report = screen.getByRole('group', {
    name: f.i18n.t('adminWorkspace.enum.resource.report'),
  });
  expect(
    within(report).getByRole<HTMLInputElement>('checkbox', {
      name: f.i18n.t('adminWorkspace.enum.action.read'),
    }).checked,
  ).toBe(true);
  expect(
    within(report).getByRole<HTMLInputElement>('checkbox', {
      name: f.i18n.t('adminWorkspace.enum.action.export'),
    }).checked,
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: f.label('clients.presetClear') }));
  expect(screen.getByText(f.label('clients.pickScope'))).toBeTruthy();
});
