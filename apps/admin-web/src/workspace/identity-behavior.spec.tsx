/// <reference types="node" />
import { File as NodeFile } from 'node:buffer';

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';

import { mountAdmin, syntheticId } from './fixtures.spec.helpers.js';
import { Identity, Users } from './identity-pages.js';

const idp = {
  id: syntheticId,
  version: 3,
  displayName: 'Synthetic SSO',
  protocol: 'oidc',
  status: 'active',
  jitProvisioning: true,
  scimEnabled: false,
  config: {
    issuer: 'https://idp.example.test',
    clientId: 'synthetic',
    clientSecretSet: true,
    spCredentials: { hidden: true },
    roleMapping: {
      rules: [{ claim: 'groups', equals: 'existing', roles: ['agent'] }],
      defaultRoles: ['agent'],
    },
  },
  endpoints: { callback: '/synthetic' },
};
async function rows(title: string) {
  const table = await screen.findByRole('table', { name: title });
  const parent = table.closest<HTMLElement>('.aw-card')!;
  const all = within(parent).queryByRole('button', { name: /show all rows/i });
  if (all) fireEvent.click(all);
  return within(parent);
}
function change(f: Awaited<ReturnType<typeof mountAdmin>>, key: string, value: string) {
  fireEvent.change(screen.getByLabelText(f.label(key)), { target: { value } });
}
async function selectIdp() {
  const f = await mountAdmin(<Identity />, {
    '/v1/identity-providers': [idp],
    [`/v1/identity-providers/${syntheticId}`]: idp,
    [`/v1/identity-providers/${syntheticId}/scim-tokens`]: [
      {
        id: 'synthetic-token',
        prefix: 'test',
        expiresAt: '2026-10-04T10:00:00Z',
        lastUsedAt: null,
      },
    ],
    ['POST /v1/identity-providers/' + syntheticId + '/scim-tokens']: {
      token: 'synthetic-one-time-token',
    },
  });
  fireEvent.click(
    (await rows(f.label('identity'))).getByRole('button', { name: f.label('details') }),
  );
  await screen.findByLabelText(f.label('defaultRoles'));
  return f;
}
it('discovers and creates an OIDC provider, normalizes the issuer URL and clears the entered secret', async () => {
  const f = await mountAdmin(<Identity />, {
    '/v1/admin/identity/discovery': { issuer: 'https://idp.example.test' },
  });
  change(f, 'displayName', 'Synthetic SSO');
  change(f, 'discoveryUrl', 'https://idp.example.test/.well-known/openid-configuration');
  fireEvent.click(screen.getByRole('button', { name: f.label('discover') }));
  await waitFor(() => {
    expect(screen.getByLabelText<HTMLInputElement>(f.label('discoveryUrl')).value).toBe(
      'https://idp.example.test',
    );
  });
  change(f, 'domains', 'synthetic.example.test, second.example.test');
  change(f, 'clientId', 'synthetic-client');
  change(f, 'replaceSecret', 'synthetic-client-secret');
  fireEvent.click(screen.getByLabelText(f.label('jit')));
  fireEvent.click(screen.getByLabelText(f.label('scim')));
  fireEvent.submit(screen.getByLabelText(f.label('displayName')).closest('form')!);
  await waitFor(() => {
    expect(screen.getByLabelText<HTMLInputElement>(f.label('replaceSecret')).value).toBe('');
  });
  expect(
    f.requests.find(
      (request) => request.path === '/v1/identity-providers' && request.method === 'POST',
    )?.body,
  ).toMatchObject({
    protocol: 'oidc',
    status: 'draft',
    jitProvisioning: true,
    scimEnabled: true,
    domains: ['synthetic.example.test', 'second.example.test'],
    config: { issuer: 'https://idp.example.test', clientSecret: 'synthetic-client-secret' },
  });
});
it('imports bounded SAML metadata, rejects oversized files and sends the extracted public certificate', async () => {
  const certificate = '-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----';
  const f = await mountAdmin(<Identity />, {
    '/v1/admin/identity/saml-import': {
      idpEntityId: 'urn:synthetic',
      ssoUrl: 'https://idp.example.test/sso',
      idpCertificates: [certificate],
    },
  });
  change(f, 'protocol', 'saml');
  const input = screen.getByLabelText(f.label('metadata'));
  fireEvent.change(input, { target: { files: [] } });
  fireEvent.change(input, {
    target: { files: [new NodeFile([new Uint8Array(256001)], 'oversized.xml')] },
  });
  await screen.findByRole('alert');
  expect(f.requests.some((request) => request.path.endsWith('/saml-import'))).toBe(false);
  fireEvent.change(input, { target: { files: [new NodeFile(['<synthetic/>'], 'synthetic.xml')] } });
  await waitFor(() => {
    expect(screen.getByLabelText<HTMLInputElement>(f.label('entityId')).value).toBe(
      'urn:synthetic',
    );
  });
  change(f, 'displayName', 'Synthetic SAML');
  fireEvent.submit(screen.getByLabelText(f.label('entityId')).closest('form')!);
  await waitFor(() => {
    expect(
      f.requests.some(
        (request) => request.method === 'POST' && request.path === '/v1/identity-providers',
      ),
    ).toBe(true);
  });
  expect(
    f.requests.find(
      (request) => request.method === 'POST' && request.path === '/v1/identity-providers',
    )?.body,
  ).toMatchObject({
    protocol: 'saml',
    config: { idpEntityId: 'urn:synthetic', idpCertificates: [certificate] },
  });
});
it('saves provider flags and claim mapping under its version while omitting credential-status metadata', async () => {
  const f = await selectIdp();
  change(f, 'status', 'disabled');
  fireEvent.click(screen.getByLabelText(f.label('jit')));
  fireEvent.click(screen.getByLabelText(f.label('scim')));
  change(f, 'replaceSecret', 'synthetic-replacement');
  change(f, 'defaultRoles', 'agent,supervisor');
  fireEvent.click(screen.getByRole('button', { name: f.label('addRule') }));
  const claims = screen.getAllByLabelText(f.label('claim')),
    equals = screen.getAllByLabelText(f.label('equals')),
    roles = screen.getAllByLabelText(f.label('roles'));
  fireEvent.change(claims[1]!, { target: { value: 'department' } });
  fireEvent.change(equals[1]!, { target: { value: 'Synthetic support' } });
  fireEvent.change(roles[1]!, { target: { value: 'supervisor' } });
  fireEvent.submit(screen.getByLabelText(f.label('defaultRoles')).closest('form')!);
  await waitFor(() => {
    expect(f.requests.some((request) => request.method === 'PATCH')).toBe(true);
  });
  const saved = f.requests.find((request) => request.method === 'PATCH');
  expect(saved?.body).toMatchObject({
    status: 'disabled',
    jitProvisioning: false,
    scimEnabled: true,
    config: {
      clientSecret: 'synthetic-replacement',
      roleMapping: {
        defaultRoles: ['agent', 'supervisor'],
        rules: [
          { claim: 'groups', equals: 'existing' },
          { claim: 'department', equals: 'Synthetic support', roles: ['supervisor'] },
        ],
      },
    },
  });
  expect(saved?.init?.headers).toMatchObject({ 'if-match': '"3"' });
  expect(JSON.stringify(saved?.body)).not.toContain('clientSecretSet');
  expect(JSON.stringify(saved?.body)).not.toContain('spCredentials');
});
it('probes provider connectivity and shows delegated SCIM credentials once before revocation', async () => {
  const f = await selectIdp();
  fireEvent.click(screen.getByRole('button', { name: f.label('testConnection') }));
  await waitFor(() => {
    expect(f.requests.some((request) => request.path.endsWith('/test'))).toBe(true);
  });
  change(f, 'expiresInDays', '14');
  fireEvent.click(screen.getByRole('button', { name: f.label('issue') }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole<HTMLTextAreaElement>('textbox').value).toContain(
    'synthetic-one-time-token',
  );
  fireEvent.click(within(dialog).getAllByRole('button', { name: f.label('close') })[0]!);
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(
    f.requests.find((request) => request.method === 'POST' && request.path.endsWith('/scim-tokens'))
      ?.body,
  ).toEqual({ expiresInDays: 14 });
  fireEvent.click(
    (await rows(f.label('scimTokens'))).getByRole('button', { name: f.label('details') }),
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('revoke') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('confirm') }));
  await waitFor(() => {
    expect(f.requests.some((request) => request.method === 'DELETE')).toBe(true);
  });
  expect(f.requests.find((request) => request.method === 'DELETE')?.path).toBe(
    `/v1/identity-providers/${syntheticId}/scim-tokens/synthetic-token`,
  );
});
it('issues break-glass enrollment only to authorized operators, clears passwords, validates activation codes and confirms disabling', async () => {
  const f = await mountAdmin(<Identity />, {
    '/v1/users': [{ id: syntheticId, displayName: 'Synthetic operator' }],
    '/v1/break-glass-accounts': [{ userId: syntheticId, status: 'active', lastUsedAt: null }],
    'POST /v1/break-glass-accounts': { enrollment: 'synthetic-one-time-enrollment' },
  });
  await screen.findByRole('option', { name: 'Synthetic operator' });
  change(f, 'user', syntheticId);
  change(f, 'password', 'synthetic-enrollment-password');
  fireEvent.submit(screen.getByLabelText(f.label('password')).closest('form')!);
  const dialog = await screen.findByRole('dialog');
  expect(screen.getByLabelText<HTMLInputElement>(f.label('password')).value).toBe('');
  fireEvent.click(within(dialog).getAllByRole('button', { name: f.label('close') })[0]!);
  change(f, 'totp', 'invalid');
  expect(
    screen.getByRole('button', { name: f.label('activate') }).getAttribute('disabled'),
  ).not.toBeNull();
  change(f, 'totp', '123456');
  fireEvent.click(screen.getByRole('button', { name: f.label('activate') }));
  await waitFor(() => {
    expect(screen.getByLabelText<HTMLInputElement>(f.label('totp')).value).toBe('');
  });
  const section = screen.getByRole('heading', { name: f.label('breakGlass') }).closest('section')!;
  fireEvent.click(within(section).getByRole('button', { name: f.label('details') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('disable') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('confirm') }));
  await waitFor(() => {
    expect(f.requests.some((request) => request.method === 'DELETE')).toBe(true);
  });
});
it('does not render break-glass enrollment or custom roles for an identity reader', async () => {
  const f = await mountAdmin(
    <Identity />,
    {},
    createAbility([{ action: 'read', subject: 'IdentityProvider' }]),
  );
  expect(screen.queryByRole('heading', { name: f.label('breakGlass') })).toBeNull();
  expect(f.requests.some((request) => request.path.includes('/break-glass'))).toBe(false);
});
it('updates manual roles without replacing SSO assignments, saves explicit scopes and terminates selected sessions with confirmation', async () => {
  const f = await mountAdmin(<Users />, {
    '/v1/users': [
      {
        id: syntheticId,
        displayName: 'Synthetic operator',
        email: 'synthetic@example.test',
        status: 'active',
      },
    ],
    '/v1/authz/roles': [
      { id: 'manual-agent', name: 'agent' },
      { id: 'manual-supervisor', name: 'supervisor' },
    ],
    [`/v1/users/${syntheticId}/roles`]: {
      roles: [
        { name: 'agent', source: 'manual' },
        { name: 'supervisor', source: 'sso' },
      ],
    },
    '/v1/campaigns?limit=100': { data: [{ id: 'synthetic-campaign', name: 'Synthetic Campaign' }] },
    '/v1/groups?limit=100&sort=displayName': {
      data: [{ id: syntheticId, displayName: 'Synthetic Team' }],
    },
    [`/v1/users/${syntheticId}/sessions`]: [
      {
        id: 'synthetic-session',
        protocol: 'oidc',
        ip: '192.0.2.1',
        lastSeenAt: '2026-10-03T10:00:00Z',
        expiresAt: '2026-10-04T10:00:00Z',
      },
    ],
  });
  fireEvent.click((await rows(f.label('users'))).getByRole('button', { name: f.label('details') }));
  await screen.findByText(
    `${f.i18n.t('authz.roles.supervisor')} · ${f.label('enum.roleSource.sso')}`,
  );
  const agent = await screen.findByRole('checkbox', { name: f.i18n.t('authz.roles.agent') });
  fireEvent.click(agent);
  fireEvent.click(screen.getByRole('checkbox', { name: f.i18n.t('authz.roles.supervisor') }));
  fireEvent.submit(agent.closest('form')!);
  await waitFor(() => {
    expect(
      f.requests.some((request) => request.path.endsWith('/roles') && request.method === 'PUT'),
    ).toBe(true);
  });
  expect(
    f.requests.find((request) => request.path.endsWith('/roles') && request.method === 'PUT')?.body,
  ).toEqual({ roles: ['supervisor'] });
  change(f, 'role', 'agent');
  // U-05: campaigns and teams are picked by name; "all" maps to the `*` wildcard.
  const campaigns = within(screen.getByRole('group', { name: f.label('campaignIds') }));
  fireEvent.click(campaigns.getByRole('checkbox', { name: f.label('allCampaigns') }));
  const teams = within(screen.getByRole('group', { name: f.label('teamIds') }));
  fireEvent.click(await teams.findByRole('checkbox', { name: 'Synthetic Team' }));
  expect(teams.getByRole('searchbox')).toBeTruthy();
  const sites = within(screen.getByRole('group', { name: f.label('siteIds') }));
  fireEvent.click(sites.getByRole('checkbox', { name: f.label('allSites') }));
  fireEvent.submit(screen.getByLabelText(f.label('role')).closest('form')!);
  await waitFor(() => {
    expect(f.requests.some((request) => request.path.endsWith('/role-scope'))).toBe(true);
  });
  expect(f.requests.find((request) => request.path.endsWith('/role-scope'))?.body).toEqual({
    role: 'agent',
    scope: { campaignIds: '*', teamIds: [syntheticId], siteIds: '*' },
  });
  fireEvent.click(
    (await rows(f.label('sessions'))).getByRole('button', { name: f.label('details') }),
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('terminate') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('confirm') }));
  await waitFor(() => {
    expect(f.requests.some((request) => request.method === 'DELETE')).toBe(true);
  });
  expect(f.requests.find((request) => request.method === 'DELETE')?.path).toBe(
    `/v1/users/${syntheticId}/sessions/synthetic-session`,
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('terminateAll') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('confirm') }));
  await waitFor(() => {
    expect(f.requests.filter((request) => request.method === 'DELETE')).toHaveLength(2);
  });
});
it('creates a scoped custom role from the permission matrix and removes unselected cells', async () => {
  const f = await mountAdmin(<Users />);
  change(f, 'name', 'synthetic_custom_role');
  change(f, 'description', 'Synthetic scoped role');
  const script = within(screen.getByRole('group', { name: f.label('enum.resource.script') }));
  fireEvent.change(script.getByRole('combobox'), { target: { value: 'campaign' } });
  fireEvent.click(script.getByRole('checkbox', { name: f.label('enum.action.read') }));
  fireEvent.click(script.getByRole('checkbox', { name: f.label('enum.action.update') }));
  fireEvent.change(script.getByRole('combobox'), { target: { value: 'campaign' } });
  fireEvent.click(script.getByRole('checkbox', { name: f.label('enum.action.update') }));
  fireEvent.click(script.getByRole('checkbox', { name: f.label('enum.action.read') }));
  fireEvent.click(script.getByRole('checkbox', { name: f.label('enum.action.read') }));
  fireEvent.change(script.getByRole('combobox'), { target: { value: 'campaign' } });
  fireEvent.submit(screen.getByLabelText(f.label('name')).closest('form')!);
  await waitFor(() => {
    expect(f.requests.some((request) => request.method === 'POST')).toBe(true);
  });
  expect(f.requests.find((request) => request.method === 'POST')?.body).toEqual({
    name: 'synthetic_custom_role',
    description: 'Synthetic scoped role',
    matrix: { script: { actions: ['read'], scope: 'campaign', revealPii: false } },
  });
});
it('blocks delegated role editing and session termination when the operator lacks those permissions', async () => {
  const f = await mountAdmin(
    <Users />,
    {
      '/v1/users': [{ id: syntheticId, displayName: 'Synthetic operator' }],
      '/v1/authz/roles': [{ id: 'role', name: 'agent' }],
      [`/v1/users/${syntheticId}/roles`]: { roles: [{ name: 'agent', source: 'manual' }] },
    },
    createAbility([
      { action: 'read', subject: 'Role' },
      { action: 'read', subject: 'User' },
    ]),
  );
  fireEvent.click((await rows(f.label('users'))).getByRole('button', { name: f.label('details') }));
  const agent = await screen.findByRole('checkbox', { name: f.i18n.t('authz.roles.agent') });
  expect(
    within(agent.closest('form')!)
      .getByRole('button', { name: f.label('save') })
      .getAttribute('disabled'),
  ).not.toBeNull();
  expect(screen.queryByRole('button', { name: f.label('terminateAll') })).toBeNull();
  expect(f.requests.every((request) => request.method === 'GET')).toBe(true);
});
it('reports a failed selected provider detail and keeps create mode available', async () => {
  const f = await mountAdmin(<Identity />, {
    '/v1/identity-providers': [idp],
    [`/v1/identity-providers/${syntheticId}`]: Response.json(
      { code: 'VERBIS_FORBIDDEN' },
      { status: 403 },
    ),
  });
  fireEvent.click(
    (await rows(f.label('identity'))).getByRole('button', { name: f.label('details') }),
  );
  await screen.findByRole('alert');
  const listSection = screen
    .getByRole('heading', { name: f.label('identity') })
    .closest('section')!;
  fireEvent.click(within(listSection).getByRole('button', { name: f.label('create') }));
  expect(await screen.findByLabelText(f.label('displayName'))).toBeDefined();
});
