import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { mountAdmin, syntheticId } from './fixtures.spec.helpers.js';
import { Branding, DataManagement, Security, Tenants } from './tenant-pages.js';

const tenant = { id: syntheticId, name: 'Synthetic tenant', version: 3, settings: {} };
async function showRows(tableName: string) {
  const table = await screen.findByRole('table', { name: tableName });
  const section = table.closest('.aw-card')!;
  const toggle = within(section as HTMLElement).queryByRole('button', { name: /show all rows/i });
  if (toggle) fireEvent.click(toggle);
  return within(section as HTMLElement);
}
function change(f: Awaited<ReturnType<typeof mountAdmin>>, key: string, value: string) {
  fireEvent.change(screen.getByLabelText(f.label(key)), { target: { value } });
}
function submitWithin(label: string) {
  const field = screen.getByLabelText(label),
    form = field.closest('form')!;
  fireEvent.submit(form);
}
it('creates a tenant with validated quotas and features and rejects malformed JSON before issuing a write', async () => {
  const f = await mountAdmin(<Tenants />);
  change(f, 'slug', 'synthetic-tenant');
  change(f, 'name', 'Synthetic tenant');
  change(f, 'maxUsers', '20');
  change(f, 'maxScripts', '30');
  change(f, 'maxActiveSessions', '40');
  change(f, 'features', '{broken');
  submitWithin(f.label('slug'));
  await screen.findByRole('alert');
  expect(f.requests.some((request) => request.method === 'POST')).toBe(false);
  change(f, 'features', '{"ai":true}');
  submitWithin(f.label('slug'));
  await screen.findByText(f.label('saved'));
  expect(f.requests.find((request) => request.method === 'POST')).toMatchObject({
    path: '/v1/admin/tenants',
    body: {
      slug: 'synthetic-tenant',
      name: 'Synthetic tenant',
      quotas: { maxUsers: 20, maxScripts: 30, maxActiveSessions: 40 },
      features: { ai: true },
    },
  });
});
it('edits an existing tenant with optimistic locking and restores create mode', async () => {
  const f = await mountAdmin(<Tenants />, {
    '/v1/admin/tenants': [
      {
        ...tenant,
        slug: 'synthetic-tenant',
        region: 'eu',
        status: 'active',
        quotas: { maxUsers: 10, maxScripts: 20, maxActiveSessions: 30 },
        features: { ai: false },
      },
    ],
  });
  const table = await showRows(f.label('tenants'));
  fireEvent.click(table.getByRole('button', { name: f.label('details') }));
  expect(screen.getByLabelText(f.label('slug')).getAttribute('disabled')).not.toBeNull();
  change(f, 'name', 'Updated synthetic');
  change(f, 'status', 'suspended');
  submitWithin(f.label('slug'));
  await screen.findByText(f.label('saved'));
  const write = f.requests.find((request) => request.method === 'PUT');
  expect(write).toMatchObject({
    path: `/v1/admin/tenants/${syntheticId}`,
    body: { name: 'Updated synthetic', status: 'suspended' },
  });
  expect(write?.init?.headers).toMatchObject({
    'if-match': '"3"',
    'x-csrf-token': 'synthetic-csrf',
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('create') }));
  expect(screen.getByLabelText<HTMLInputElement>(f.label('slug')).value).toBe('');
});
it('saves session, network, embedding and separation-of-duties settings under the tenant version', async () => {
  const f = await mountAdmin(<Security />, { '/v1/tenant': tenant });
  await screen.findByLabelText(f.label('idle'));
  change(f, 'idle', '15');
  change(f, 'absolute', '8');
  change(f, 'concurrent', '2');
  change(f, 'onLimit', 'deny');
  change(f, 'ips', '192.0.2.0/24,\n198.51.100.0/24');
  change(f, 'frames', 'https://synthetic.example.test');
  fireEvent.click(screen.getByLabelText(f.label('sod')));
  submitWithin(f.label('idle'));
  await screen.findByText(f.label('saved'));
  expect(f.requests.find((request) => request.method === 'PATCH')).toMatchObject({
    body: {
      session: {
        idleTimeoutMinutes: 15,
        absoluteTimeoutHours: 8,
        maxConcurrentSessions: 2,
        onLimit: 'deny',
      },
      security: { ipAllowlist: ['192.0.2.0/24', '198.51.100.0/24'] },
      embedding: { frameAncestors: ['https://synthetic.example.test'] },
      authz: { separationOfDuties: false },
    },
  });
});
it('creates only public launch verification keys and updates an existing issuer with its version', async () => {
  const keys = {
    keys: [{ kty: 'OKP', kid: 'synthetic', crv: 'Ed25519', x: 'synthetic-public', alg: 'EdDSA' }],
  };
  const f = await mountAdmin(<Security />, {
    '/v1/tenant': tenant,
    '/v1/admin/launch-issuers': [
      { id: syntheticId, issuer: 'Synthetic issuer', status: 'active', version: 4, jwks: keys },
    ],
  });
  await screen.findByLabelText(f.label('issuer'));
  change(f, 'issuer', 'Created synthetic issuer');
  change(
    f,
    'publicKeys',
    JSON.stringify({ keys: [{ ...keys.keys[0], d: 'private-must-be-rejected' }] }),
  );
  submitWithin(f.label('issuer'));
  await screen.findByRole('alert');
  expect(f.requests.some((request) => request.method === 'POST')).toBe(false);
  change(f, 'publicKeys', JSON.stringify(keys));
  submitWithin(f.label('issuer'));
  await screen.findByText(f.label('saved'));
  expect(f.requests.find((request) => request.method === 'POST')).toMatchObject({
    path: '/v1/admin/launch-issuers',
    body: { issuer: 'Created synthetic issuer', jwks: keys },
  });
  const table = await showRows(f.label('jwks'));
  fireEvent.click(table.getByRole('button', { name: f.label('details') }));
  change(f, 'status', 'disabled');
  submitWithin(f.label('issuer'));
  await waitFor(() => {
    expect(f.requests.some((request) => request.method === 'PUT')).toBe(true);
  });
  expect(f.requests.find((request) => request.method === 'PUT')?.init?.headers).toMatchObject({
    'if-match': '"4"',
  });
  fireEvent.click(table.getByRole('button', { name: f.label('create') }));
  expect(screen.getByLabelText<HTMLInputElement>(f.label('issuer')).value).toBe('');
});
it('previews branding and validates URL and color settings before saving', async () => {
  const f = await mountAdmin(<Branding />, { '/v1/tenant': tenant });
  await screen.findByLabelText(f.label('name'));
  change(f, 'name', 'Synthetic brand');
  change(f, 'primaryColor', '#123456');
  change(f, 'logoUrl', 'https://assets.example.test/synthetic.svg');
  change(f, 'agentTitle', 'Synthetic agent');
  change(f, 'waitingText', 'Synthetic waiting');
  expect(screen.getByText('Synthetic brand')).toBeDefined();
  submitWithin(f.label('name'));
  await screen.findByText(f.label('saved'));
  expect(f.requests.find((request) => request.method === 'PATCH')).toMatchObject({
    body: {
      brand: {
        name: 'Synthetic brand',
        primaryColor: '#123456',
        logoUrl: 'https://assets.example.test/synthetic.svg',
        agentTitle: 'Synthetic agent',
        waitingText: 'Synthetic waiting',
      },
    },
  });
});
it('saves retention and classification rules without losing untouched existing entries', async () => {
  const f = await mountAdmin(<DataManagement />, {
    '/v1/tenant': {
      ...tenant,
      settings: {
        classifications: [
          {
            path: 'existing.name',
            classification: 'public',
            purpose: 'Existing synthetic purpose',
          },
        ],
      },
    },
  });
  await screen.findByLabelText(f.label('auditDays'));
  change(f, 'auditDays', '400');
  change(f, 'sessionDays', '100');
  change(f, 'analyticsDays', '500');
  fireEvent.click(screen.getByLabelText(f.label('legalHold')));
  submitWithin(f.label('auditDays'));
  await screen.findByText(f.label('saved'));
  expect(f.requests.find((request) => request.method === 'PATCH')).toMatchObject({
    body: {
      audit: {
        retentionDays: 400,
        sessionRetentionDays: 100,
        analyticsRetentionDays: 500,
        legalHold: true,
      },
    },
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('addRule') }));
  const paths = screen.getAllByLabelText(f.label('path'));
  fireEvent.change(paths[1]!, { target: { value: 'customer.email' } });
  const classifications = screen.getAllByLabelText(f.label('classification'));
  fireEvent.change(classifications[1]!, { target: { value: 'pii' } });
  const purposes = screen.getAllByLabelText(f.label('purpose'));
  fireEvent.change(purposes[1]!, { target: { value: 'Synthetic contact purpose' } });
  fireEvent.submit(paths[0]!.closest('form')!);
  await waitFor(() => {
    expect(
      f.requests.some(
        (request) =>
          typeof request.body === 'object' &&
          request.body !== null &&
          'classifications' in request.body,
      ),
    ).toBe(true);
  });
  expect(
    f.requests.find(
      (request) =>
        typeof request.body === 'object' &&
        request.body !== null &&
        'classifications' in request.body,
    )?.body,
  ).toMatchObject({
    classifications: [
      { path: 'existing.name', classification: 'public' },
      { path: 'customer.email', classification: 'pii' },
    ],
  });
  fireEvent.click(screen.getAllByRole('button', { name: f.label('remove') })[1]!);
  expect(screen.getAllByLabelText(f.label('path'))).toHaveLength(1);
});
it('requires verified privacy requests, clears sensitive input after submission and confirms processing', async () => {
  const f = await mountAdmin(<DataManagement />, {
    '/v1/tenant': tenant,
    '/v1/admin/privacy-requests': [
      {
        id: syntheticId,
        kind: 'search',
        state: 'pending',
        createdAt: '2026-10-03T10:00:00Z',
        count: 1,
        version: 5,
      },
    ],
    [`/v1/admin/privacy-requests/${syntheticId}/process`]: {
      id: syntheticId,
      kind: 'search',
      state: 'completed',
      version: 6,
    },
  });
  await screen.findByLabelText(f.label('subject'));
  const form = screen.getByLabelText(f.label('subject')).closest('form')!;
  expect(
    within(form)
      .getByRole('button', { name: f.label('save') })
      .getAttribute('disabled'),
  ).not.toBeNull();
  change(f, 'kind', 'search');
  change(f, 'subject', 'synthetic@example.test');
  change(f, 'reason', 'Verified synthetic test request');
  fireEvent.click(screen.getByLabelText(f.label('verified')));
  fireEvent.submit(form);
  await waitFor(() => {
    expect(screen.getByLabelText<HTMLInputElement>(f.label('subject')).value).toBe('');
  });
  expect(f.requests.find((request) => request.method === 'POST')).toMatchObject({
    path: '/v1/admin/privacy-requests',
    body: { verified: true, reason: 'Verified synthetic test request' },
  });
  const table = await showRows(f.label('privacy'));
  fireEvent.click(table.getByRole('button', { name: f.label('details') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('process') }));
  expect(f.requests.some((request) => request.path.endsWith('/process'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: f.label('confirm') }));
  await waitFor(() => {
    expect(f.requests.some((request) => request.path.endsWith('/process'))).toBe(true);
  });
  expect(f.requests.find((request) => request.path.endsWith('/process'))?.body).toEqual({
    confirmRequestId: syntheticId,
  });
});
it.each([Branding, Security, DataManagement])(
  'shows failed tenant loading without exposing an editable settings form',
  async (Page) => {
    const f = await mountAdmin(<Page />, {
      '/v1/tenant': Response.json({ code: 'VERBIS_FORBIDDEN' }, { status: 403 }),
    });
    await screen.findByRole('alert');
    expect(screen.queryByLabelText(f.label('idle'))).toBeNull();
    expect(screen.queryByLabelText(f.label('name'))).toBeNull();
  },
);

it('opens and closes an interactive preview of unsaved branding without writing settings', async () => {
  const f = await mountAdmin(<Branding />, { '/v1/tenant': tenant });
  await screen.findByLabelText(f.label('name'));
  change(f, 'name', 'Unsaved synthetic brand');
  change(f, 'agentTitle', 'Unsaved agent title');
  change(f, 'waitingText', 'Unsaved waiting text');
  fireEvent.click(screen.getByRole('button', { name: f.label('preview') }));
  const dialog = await screen.findByRole('dialog', { name: f.label('preview') });
  expect(within(dialog).getByText('Unsaved synthetic brand')).toBeDefined();
  expect(within(dialog).getByText('Unsaved agent title')).toBeDefined();
  expect(within(dialog).getByText('Unsaved waiting text')).toBeDefined();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(f.requests.every((request) => request.method === 'GET')).toBe(true);
  expect(screen.getByLabelText<HTMLInputElement>(f.label('name')).value).toBe(
    'Unsaved synthetic brand',
  );
});
