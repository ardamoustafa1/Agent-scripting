import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { createAbility } from '@verbis/authz';

import { SessionSchema } from '../api/client.js';
import { mountDesigner } from '../fixtures.spec.helpers.js';
import { sessionFixture, scriptId } from '../test-fixtures.js';

import Shell from './shell.js';

const tourKey = `verbis.tour.${sessionFixture.user.tenantId}.${sessionFixture.user.id}`;
async function setup(
  path = '/settings',
  options: { denied?: boolean; tour?: boolean; dark?: boolean } = {},
) {
  if (options.tour) localStorage.removeItem(tourKey);
  else localStorage.setItem(tourKey, 'done');
  const setTheme = vi.fn();
  const f = await mountDesigner(
    <Shell
      session={SessionSchema.parse(sessionFixture)}
      theme={options.dark ? 'dark' : 'light'}
      setTheme={setTheme}
    />,
    {},
    { path, ...(options.denied ? { ability: createAbility([]) } : {}) },
  );
  return { ...f, setTheme };
}
it.each([
  '/analytics',
  '/campaigns',
  '/scripts',
  '/screens',
  '/variables',
  '/releases',
  '/integrations',
  '/integrations/new',
  '/templates',
  '/ai',
  '/settings',
  `/scripts/${scriptId}/versions/1/edit`,
  `/scripts/${scriptId}/versions/1/release`,
  `/scripts/${scriptId}/assignments`,
  `/scripts/${scriptId}/packages`,
])('protects the %s route and does not fetch its data without permission', async (path) => {
  const f = await setup(path, { denied: true });
  expect(await screen.findByText(f.label('workspace.denied'))).toBeTruthy();
  expect(f.requests).toHaveLength(0);
  const navigation = screen.getByRole('navigation', { name: f.label('workspace.navigation') });
  expect(within(navigation).queryByRole('link')).toBeNull();
});
it('finishes the guided tour and remembers the preference', async () => {
  const f = await setup('/settings', { tour: true });
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('1 / 3')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('workspace.next') }));
  expect(within(dialog).getByText('2 / 3')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('workspace.tourBack') }));
  expect(within(dialog).getByText('1 / 3')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('workspace.next') }));
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('workspace.next') }));
  expect(within(dialog).getByText('3 / 3')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('workspace.start') }));
  expect(localStorage.getItem(tourKey)).toBe('done');
  expect(screen.queryByRole('dialog')).toBeNull();
});
it.each([false, true])('toggles theme using the command palette from dark=%s', async (dark) => {
  const f = await setup('/settings', { dark });
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('option', { name: f.label('workspace.toggleTheme') }));
  expect(f.setTheme).toHaveBeenCalledWith(dark ? 'light' : 'dark');
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('opens creation from the command palette and navigates to a permitted destination', async () => {
  const f = await setup();
  fireEvent.click(screen.getByRole('button', { name: new RegExp(f.label('workspace.search')) }));
  let dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('option', { name: f.label('workspace.new.scripts') }));
  expect(
    await screen.findByRole('dialog', { name: f.label('workspace.new.scripts') }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.keyDown(document, { key: 'k', metaKey: true });
  dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('option', { name: f.label('workspace.nav.campaigns') }));
  await waitFor(() => {
    expect(f.router.state.location.pathname).toBe('/campaigns');
  });
});
it('keeps a failed logout recoverable through a retry dialog', async () => {
  const f = await setup();
  f.responses['POST /auth/logout'] = Response.json(
    { code: 'VERBIS_HTTP_UNAVAILABLE' },
    { status: 503 },
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('workspace.tenant') }));
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: f.label('workspace.logout'),
    }),
  );
  const dialog = await screen.findByRole('dialog', { name: f.label('workspace.error') });
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('workspace.retry') }));
  await waitFor(() => {
    expect(f.requests.filter((r) => r.path === '/auth/logout')).toHaveLength(2);
  });
});

it('follows the BFF-provided external IdP logout URL to finish SSO sign-out', async () => {
  const f = await setup();
  expect(screen.getByRole('button', { name: f.label('workspace.userMenu') })).toBeDefined();
  const assign = vi.fn();
  vi.stubGlobal('location', { origin: 'https://designer.example.test', assign });
  f.responses['POST /auth/logout'] = {
    redirectUrl: 'https://idp.example.test/logout?state=synthetic',
  };
  fireEvent.click(screen.getByRole('button', { name: f.label('workspace.tenant') }));
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: f.label('workspace.logout'),
    }),
  );
  await waitFor(() => {
    expect(assign).toHaveBeenCalledWith('https://idp.example.test/logout?state=synthetic');
  });
});

it.each([
  'javascript:alert(1)',
  'data:text/html,synthetic',
  'https://user:password@idp.example.test/logout',
])('rejects unsafe logout navigation %s', async (redirectUrl) => {
  const f = await setup();
  const assign = vi.fn();
  vi.stubGlobal('location', { origin: 'https://designer.example.test', assign });
  f.responses['POST /auth/logout'] = { redirectUrl };
  fireEvent.click(screen.getByRole('button', { name: f.label('workspace.tenant') }));
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: f.label('workspace.logout'),
    }),
  );
  await waitFor(() => {
    expect(assign).toHaveBeenCalledWith('/');
  });
});

it('preserves styled navigation and the current-page indicator inside tooltip triggers', async () => {
  const f = await setup('/scripts');
  const navigation = screen.getByRole('navigation', { name: f.label('workspace.navigation') });
  for (const link of within(navigation).getAllByRole('link'))
    expect(link.classList.contains('dw-nav')).toBe(true);
  expect(
    within(navigation)
      .getByRole('link', { name: f.label('workspace.nav.scripts') })
      .getAttribute('aria-current'),
  ).toBe('page');
});
it('does not advertise AI Studio to script readers who cannot create scripts', async () => {
  localStorage.setItem(tourKey, 'done');
  const f = await mountDesigner(
    <Shell session={SessionSchema.parse(sessionFixture)} theme="light" setTheme={vi.fn()} />,
    {},
    { path: '/ai', ability: createAbility([{ action: 'read', subject: 'Script' }]) },
  );
  await screen.findByText(f.label('workspace.denied'));
  const navigation = screen.getByRole('navigation', { name: f.label('workspace.navigation') });
  expect(within(navigation).queryByRole('link', { name: f.label('workspace.nav.ai') })).toBeNull();
});

it('starts the user-menu tour from its first step when reopened', async () => {
  const f = await setup('/settings', { tour: true });
  let dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('workspace.next') }));
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('workspace.skip') }));
  fireEvent.pointerDown(screen.getByRole('button', { name: f.label('workspace.userMenu') }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole('menuitem', { name: f.label('workspace.tourTitle') }));
  dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(f.label('workspace.tour.0'))).toBeTruthy();
});

it('starts a new library with fresh filters when moving to another section', async () => {
  const f = await setup('/campaigns');
  f.responses['/v1/campaigns?limit=100'] = { data: [], page: { nextCursor: null } };
  f.responses['/v1/scripts?limit=100'] = { data: [], page: { nextCursor: null } };
  const input = await screen.findByRole('textbox', { name: f.label('workspace.searchLibrary') });
  fireEvent.change(input, { target: { value: 'campaign-only-filter' } });
  await f.router.navigate('/scripts');
  await waitFor(() => {
    expect(
      screen.getByRole<HTMLInputElement>('textbox', {
        name: f.label('workspace.searchLibrary'),
      }).value,
    ).toBe('');
  });
});
