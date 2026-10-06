import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { ACTIONS, RESOURCES, SCOPE_KINDS, SYSTEM_ROLE_KEYS } from '@verbis/authz';
import { createI18n } from '@verbis/i18n';

import { ADMIN_ENUMS, ENUM_COLUMNS } from './enums.js';
import { mountAdmin, syntheticId } from './fixtures.spec.helpers.js';
import { Users } from './identity-pages.js';
import { Field, ResourceList } from './widgets.js';

// U-02: raw enum/identifier values (`active`, `oidc`, `evict_oldest`, `campaign/read`) must never
// reach the admin UI; each rendered value needs a TR and EN label.
it('labels every admin enum value in both catalogs, never echoing the raw value in Turkish', async () => {
  for (const locale of ['tr', 'en'] as const) {
    const i18n = await createI18n(locale);
    for (const [name, values] of Object.entries(ADMIN_ENUMS))
      for (const value of values) {
        const key = `adminWorkspace.enum.${name}.${value}`;
        expect(i18n.exists(key), `${locale}: ${key}`).toBe(true);
        if (locale === 'tr') expect(i18n.t(key), key).not.toBe(value);
      }
  }
});
it('keeps the permission-matrix enums aligned with the authorization vocabulary', () => {
  expect([...ADMIN_ENUMS.resource]).toEqual([...RESOURCES]);
  expect([...ADMIN_ENUMS.action]).toEqual([...ACTIONS]);
  expect([...ADMIN_ENUMS.scope]).toEqual([...SCOPE_KINDS]);
  for (const name of Object.values(ENUM_COLUMNS)) expect(ADMIN_ENUMS).toHaveProperty(name);
});
it('renders localized enum labels in lists while preserving raw option values in forms', async () => {
  const onChange = vi.fn(),
    f = await mountAdmin(
      <>
        <ResourceList
          path="/v1/identity-providers"
          title="Synthetic list"
          columns={['displayName', 'protocol', 'status']}
        />
        <Field
          label="Synthetic limit"
          value="deny"
          onChange={onChange}
          enumName="sessionLimit"
          options={['evict_oldest', 'deny']}
        />
      </>,
      {
        '/v1/identity-providers': [
          { id: syntheticId, displayName: 'Synthetic IdP', protocol: 'oidc', status: 'active' },
        ],
      },
    );
  fireEvent.click(await screen.findByRole('button', { name: /show all rows/i }));
  await screen.findByText('Synthetic IdP');
  const table = screen.getByRole('table');
  expect(within(table).getByText(f.label('enum.protocol.oidc'))).toBeTruthy();
  expect(within(table).getByText(f.label('enum.status.active'))).toBeTruthy();
  expect(within(table).queryByText('oidc')).toBeNull();
  expect(within(table).queryByText('active')).toBeNull();
  const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Synthetic limit' });
  expect(
    within(select).getByRole('option', { name: f.label('enum.sessionLimit.evict_oldest') }),
  ).toBeTruthy();
  fireEvent.change(select, { target: { value: 'evict_oldest' } });
  expect(onChange).toHaveBeenCalledWith('evict_oldest');
});
it('labels permission-matrix resources, actions and scopes in the custom role editor', async () => {
  const f = await mountAdmin(<Users />, { '/v1/users': [], '/v1/authz/roles': [] });
  const campaign = (await screen.findAllByRole('group')).find(
    (group) => group.querySelector('legend')?.textContent === f.label('enum.resource.campaign'),
  );
  expect(campaign).toBeTruthy();
  expect(
    within(campaign!).getByRole('checkbox', { name: f.label('enum.action.read') }),
  ).toBeTruthy();
  expect(within(campaign!).getByRole('option', { name: f.label('enum.scope.team') })).toBeTruthy();
  expect(screen.queryByText('campaign', { exact: true })).toBeNull();
});
// U-03: the 11 system roles had an empty description column; show their label and purpose.
it('describes every system role in both catalogs and in the roles table', async () => {
  for (const locale of ['tr', 'en'] as const) {
    const i18n = await createI18n(locale);
    for (const key of SYSTEM_ROLE_KEYS) {
      expect(i18n.exists(`authz.roleDescriptions.${key}`), `${locale}: ${key}`).toBe(true);
      expect(i18n.t(`authz.roleDescriptions.${key}`).length).toBeGreaterThan(20);
    }
  }
  const f = await mountAdmin(<Users />, {
    '/v1/users': [],
    '/v1/authz/roles': [
      { id: syntheticId, name: 'script_approver', description: null, isSystem: true },
      {
        id: '01928f3a-0000-7000-8000-000000000002',
        name: 'synthetic_custom',
        description: 'Synthetic custom purpose',
        isSystem: false,
      },
    ],
  });
  await waitFor(() => {
    expect(screen.getAllByRole('button', { name: /show all rows/i })).toHaveLength(2);
  });
  for (const button of screen.getAllByRole('button', { name: /show all rows/i }))
    fireEvent.click(button);
  await screen.findByText(f.i18n.t('authz.roles.script_approver'));
  expect(screen.getByText(f.i18n.t('authz.roleDescriptions.script_approver'))).toBeTruthy();
  expect(screen.getByText('synthetic_custom')).toBeTruthy();
  expect(screen.getByText('Synthetic custom purpose')).toBeTruthy();
  expect(screen.queryByText('script_approver')).toBeNull();
});
