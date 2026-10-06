import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
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
      if (input.endsWith('/auth/session/status'))
        return new Response(JSON.stringify(authenticated ? session : { authenticated: false }));
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
function cleanupAndRender(i18n: Awaited<ReturnType<typeof createI18n>>) {
  cleanup();
  render(
    <AppProviders i18n={i18n}>
      <App />
    </AppProviders>,
  );
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
  // U-04: every page showed the same generic subtitle.
  it('describes each admin page with its own subtitle', async () => {
    const i18n = await mount(true, ['super_admin']);
    const pages = ['analytics', 'tenants', 'identity', 'users', 'connectors', 'secrets', 'ai'];
    const all = [...pages, 'audit', 'security', 'data', 'branding', 'simulator', 'systemHealth'];
    expect(new Set(all.map((page) => i18n.t(`adminWorkspace.intros.${page}`))).size).toBe(
      all.length,
    );
    await screen.findByRole('heading', { level: 1, name: i18n.t('adminWorkspace.systemHealth') });
    expect(screen.getByText(i18n.t('adminWorkspace.intros.systemHealth'))).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: i18n.t('adminWorkspace.branding') }));
    window.location.hash = 'branding';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(await screen.findByText(i18n.t('adminWorkspace.intros.branding'))).toBeTruthy();
    expect(screen.queryByText(i18n.t('adminWorkspace.intro'))).toBeNull();
  });
  // P-19: a rate-limited session check looked like a signed-out user.
  it('keeps the signed-in user out of the login screen when the session check is rate limited', async () => {
    const i18n = await mount();
    vi.mocked(fetch).mockImplementation((input) =>
      Promise.resolve(
        (typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
        ).endsWith('/auth/session/status')
          ? new Response(JSON.stringify({ code: 'VERBIS_HTTP_RATE_LIMITED' }), {
              status: 429,
              headers: { 'retry-after': '60' },
            })
          : new Response('{}'),
      ),
    );
    cleanupAndRender(i18n);
    expect((await screen.findByRole('alert')).textContent).toContain(
      i18n.t('adminWorkspace.errors.rateLimited'),
    );
    expect(screen.getByRole('button', { name: i18n.t('adminWorkspace.retry') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /SSO/i })).toBeNull();
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
