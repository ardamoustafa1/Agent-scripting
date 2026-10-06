import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { serializeRules } from '@verbis/authz';
import { createI18n } from '@verbis/i18n';

import { App } from './app.js';
import { AppProviders } from './providers.js';

const tenantId = '01990000-0000-7000-8000-000000000001';
const session = {
  user: { id: 'fixture-user', tenantId, authMethod: 'sso' },
  session: { id: 'fixture-session', protocol: 'oidc', expiresAt: '2030-01-01T00:00:00Z' },
  csrfToken: 'fixture-csrf',
};
async function mount(authenticated = true, roles = ['tenant_admin']) {
  window.location.hash = 'systemHealth';
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      if (input.endsWith('/auth/session'))
        return new Response(JSON.stringify(authenticated ? session : {}), {
          status: authenticated ? 200 : 401,
        });
      if (input.endsWith('/me/permissions'))
        return new Response(
          JSON.stringify({
            principal: { type: 'user', id: session.user.id, tenantId },
            roles,
            rules: serializeRules([{ action: 'manage', subject: 'all' }]),
            separationOfDuties: true,
          }),
        );
      if (input.endsWith('/v1/tenant'))
        return new Response(
          JSON.stringify({ id: tenantId, name: 'Fixture tenant', settings: {}, version: 1 }),
        );
      if (input.endsWith('/health/ready'))
        return new Response(
          JSON.stringify({
            status: 'ok',
            service: 'verbis-api',
            checks: { database: { status: 'up' } },
          }),
        );
      if (input.endsWith('/outbox'))
        return new Response(
          JSON.stringify({
            pending: 2,
            published: 7,
            dead: 0,
            oldestPendingAt: null,
            deadEvents: [],
          }),
        );
      if (input.endsWith('/operations'))
        return new Response(
          JSON.stringify({ windowHours: 24, total: 0, failed: 0, errorRate: null }),
        );
      return new Response(JSON.stringify({ data: [], page: { nextCursor: null } }));
    }),
  );
  const i18n = await createI18n('tr');
  render(
    <AppProviders i18n={i18n}>
      <App />
    </AppProviders>,
  );
  return i18n;
}
afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});
describe('admin workspace', () => {
  it('offers SSO without fetching privileged data before sign-in', async () => {
    await mount(false);
    await screen.findByRole('heading', { name: 'Yönetim' });
    const fetcher = vi.mocked(fetch);
    expect(
      fetcher.mock.calls.every(([url]) =>
        (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).includes(
          '/auth/',
        ),
      ),
    ).toBe(true);
  });
  it('shows tenant administration only for platform super admins', async () => {
    await mount();
    await screen.findByRole('navigation');
    expect(screen.queryByRole('link', { name: 'Tenant yönetimi' })).toBeNull();
    expect(await screen.findByRole('link', { name: 'Kimlik ve SSO' })).toBeTruthy();
  });
  it('supports locale and theme preferences', async () => {
    await mount(true, ['super_admin']);
    await screen.findByRole('link', { name: 'Tenant yönetimi' });
    fireEvent.change(screen.getByLabelText('Dil'), { target: { value: 'en' } });
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('en');
    });
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'high-contrast' } });
    await waitFor(() => {
      expect(document.querySelector('.vb-theme')?.getAttribute('data-theme')).toBe('high-contrast');
    });
  });
});
