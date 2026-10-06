import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createI18n } from '@verbis/i18n';

import { App } from './app.js';
import { AppProviders } from './providers.js';

afterEach(() => vi.unstubAllGlobals());
describe('agent SSO boundary', () => {
  it('shows SSO discovery when no authenticated browser session exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 401 }))),
    );
    const i18n = await createI18n('en');
    render(
      <AppProviders i18n={i18n}>
        <App />
      </AppProviders>,
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in to your agent account' })).toBeTruthy();
    });
    expect(
      screen.getByRole('button', { name: 'Show SSO providers' }).hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('Organization code'), {
      target: { value: 'synthetic-tenant' },
    });
    expect(
      screen.getByRole('button', { name: 'Show SSO providers' }).hasAttribute('disabled'),
    ).toBe(false);
  });
  it('does not redeem an arbitrary script query parameter', async () => {
    window.history.replaceState(null, '', '/?scriptId=untrusted');
    const fetcher = vi.fn((_url: RequestInfo | URL) =>
      Promise.resolve(new Response('{}', { status: 401 })),
    );
    vi.stubGlobal('fetch', fetcher);
    const i18n = await createI18n('en');
    render(
      <AppProviders i18n={i18n}>
        <App />
      </AppProviders>,
    );
    await screen.findByRole('heading', { name: 'Sign in to your agent account' });
    expect(
      fetcher.mock.calls.some((call) => typeof call[0] === 'string' && call[0].includes('redeem')),
    ).toBe(false);
    window.history.replaceState(null, '', '/');
  });
});
