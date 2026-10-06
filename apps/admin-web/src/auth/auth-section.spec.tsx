import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createI18n } from '@verbis/i18n';

import { AppProviders } from '../providers.js';

import { fetchSession, loginUrl, takeAuthError } from './auth-api.js';
import { AuthSection } from './auth-section.js';

type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown };

function stubFetch(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, ...(init === undefined ? {} : { init }) });
      const { status, body } = handler(url, init);
      return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
    }),
  );
  return calls;
}

async function renderSection() {
  const i18n = await createI18n('en');
  render(
    <AppProviders i18n={i18n}>
      <AuthSection />
    </AppProviders>,
  );
}

const SESSION = {
  user: { id: 'u1', tenantId: 't1', authMethod: 'sso' },
  session: { id: 's1', protocol: 'oidc', expiresAt: '2026-10-01T20:00:00.000Z' },
  csrfToken: 'csrf-123',
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('AuthSection', () => {
  it('discovers providers by email and links to the fixed login route', async () => {
    const calls = stubFetch((url) =>
      url === '/api/auth/discover'
        ? {
            status: 200,
            body: {
              tenant: 'acme',
              providers: [{ id: 'idp-1', displayName: 'Entra ID', protocol: 'oidc' }],
            },
          }
        : { status: 401, body: { code: 'VERBIS_AUTH_UNAUTHENTICATED' } },
    );
    await renderSection();
    fireEvent.change(await screen.findByLabelText('Work email'), {
      target: { value: 'ada@acme.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const link = await screen.findByRole('link', { name: 'Sign in with Entra ID' });
    expect(link.getAttribute('href')).toBe(
      '/api/auth/login?tenant=acme&idp=idp-1&app=admin&returnTo=%2F',
    );
    const discoverCall = calls.find((call) => call.url === '/api/auth/discover');
    expect(discoverCall?.init?.body).toBe(JSON.stringify({ email: 'ada@acme.test' }));
    expect(discoverCall?.url).not.toContain('ada@');
  });

  it('shows a localized error for an unknown domain', async () => {
    stubFetch((url) =>
      url === '/api/auth/discover'
        ? { status: 404, body: { code: 'VERBIS_AUTH_TENANT_UNKNOWN' } }
        : { status: 401, body: {} },
    );
    await renderSection();
    fireEvent.change(await screen.findByLabelText('Work email'), {
      target: { value: 'x@nowhere.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'No sign-in is configured for this email domain.',
    );
  });

  it('signs out with the CSRF token and follows the IdP logout URL', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', {
      assign,
      href: window.location.href,
      origin: window.location.origin,
    });
    const calls = stubFetch((url) =>
      url === '/api/auth/logout'
        ? { status: 200, body: { redirectUrl: 'https://idp.example/logout' } }
        : { status: 200, body: SESSION },
    );
    await renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('https://idp.example/logout');
    });
    const logoutCall = calls.find((call) => call.url === '/api/auth/logout');
    expect((logoutCall?.init?.headers as Record<string, string>)['x-csrf-token']).toBe('csrf-123');
  });

  it('submits break-glass credentials as JSON to the BFF', async () => {
    const calls = stubFetch((url) =>
      url === '/api/auth/break-glass/login'
        ? { status: 401, body: { code: 'VERBIS_AUTH_INVALID_CREDENTIALS' } }
        : { status: 401, body: {} },
    );
    await renderSection();
    fireEvent.click(await screen.findByText('Break-glass access'));
    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: 'acme' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'root@acme.test' } });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'long passphrase here' },
    });
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with break-glass access' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The credentials are not valid.');
    const call = calls.find((c) => c.url === '/api/auth/break-glass/login');
    expect(JSON.parse(typeof call?.init?.body === 'string' ? call.init.body : '{}')).toEqual({
      tenant: 'acme',
      email: 'root@acme.test',
      password: 'long passphrase here',
      code: '123456',
    });
  });
});

describe('auth helpers', () => {
  it('reads and scrubs the SSO error code, mapping unknown codes', () => {
    window.history.replaceState(null, '', '/?authError=not_provisioned&x=1');
    expect(takeAuthError()).toBe('not_provisioned');
    expect(window.location.search).toBe('?x=1');
    window.history.replaceState(null, '', '/?authError=<script>');
    expect(takeAuthError()).toBe('login_failed');
    expect(takeAuthError()).toBeNull();
    expect(loginUrl('t', 'i')).toBe('/api/auth/login?tenant=t&idp=i&app=admin&returnTo=%2F');
  });
});

it('clears old providers and ignores pending discovery when the email changes', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url === '/api/auth/discover'
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(Response.json({}, { status: 401 })),
    ),
  );
  await renderSection();
  fireEvent.change(await screen.findByLabelText('Work email'), {
    target: { value: 'user@first.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'user@second.test' } });
  await act(async () => {
    await Promise.resolve();
    finish(
      Response.json({
        tenant: 'first',
        providers: [{ id: 'first-idp', displayName: 'First SSO', protocol: 'oidc' }],
      }),
    );
  });
  expect(screen.queryByRole('link', { name: 'Sign in with First SSO' })).toBeNull();
});

it.each([503, 403])(
  'does not treat HTTP %i session errors as signed-out sessions',
  async (status) => {
    stubFetch(() => ({ status, body: { code: 'VERBIS_HTTP_UNAVAILABLE' } }));
    await expect(fetchSession()).rejects.toThrow('VERBIS_HTTP_UNAVAILABLE');
  },
);

it('probes /auth/session/status and treats {authenticated:false} as signed out (U-01)', async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      calls.push(input);
      return Promise.resolve(Response.json({ authenticated: false }));
    }),
  );
  await expect(fetchSession()).resolves.toBeNull();
  expect(calls).toEqual(['/api/auth/session/status']);
});

it('rejects a malformed successful session rather than showing sign-in', async () => {
  stubFetch(() => ({ status: 200, body: {} }));
  await expect(fetchSession()).rejects.toThrow('VERBIS_HTTP_UNAVAILABLE');
});

it('shows session failure and retries before offering sign-in', async () => {
  let status = 503;
  stubFetch(() => ({ status, body: { code: 'VERBIS_HTTP_UNAVAILABLE' } }));
  await renderSection();
  await screen.findByRole('alert');
  expect(screen.queryByLabelText('Work email')).toBeNull();
  status = 401;
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  await screen.findByLabelText('Work email');
});
