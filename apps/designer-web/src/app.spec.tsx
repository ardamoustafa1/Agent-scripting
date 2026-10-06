import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createI18n } from '@verbis/i18n';

import { App, createDesignerRouter } from './app.js';
import { AppProviders } from './providers.js';
import {
  fixtureResponse,
  permissionFixture,
  sessionFixture,
  campaignId,
  tenantId,
} from './test-fixtures.js';

const routers: ReturnType<typeof createDesignerRouter>[] = [];
async function mount(
  overrides: Record<string, { body: unknown; status?: number }> = {},
  path = '/campaigns',
) {
  window.history.replaceState(null, '', path);
  localStorage.setItem(`verbis.tour.${tenantId}.${sessionFixture.user.id}`, 'done');
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const fetchMock = vi.fn((url: string) => {
    const value = overrides[url];
    return Promise.resolve(
      new Response(JSON.stringify(value?.body ?? fixtureResponse(url)), {
        status: value?.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  const i18n = await createI18n('en');
  const router = createDesignerRouter();
  routers.push(router);
  render(
    <StrictMode>
      <AppProviders i18n={i18n}>
        <App router={router} />
      </AppProviders>
    </StrictMode>,
  );
  if (
    path === '/campaigns' &&
    !overrides['/api/auth/session'] &&
    !overrides['/api/v1/me/permissions']
  ) {
    fireEvent.click(
      await screen.findByRole('button', { name: 'Show all rows' }, { timeout: 5000 }),
    );
  }
  return fetchMock;
}
afterEach(() => {
  for (const router of routers.splice(0)) router.dispose();
  vi.unstubAllGlobals();
  localStorage.clear();
});
describe('designer workspace shell', () => {
  it('loads BFF session, packed permissions and campaigns', async () => {
    await mount();
    expect(await screen.findByRole('heading', { name: /Campaigns/ })).toBeTruthy();
    expect(await screen.findByText('Demo campaign', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Workspace navigation' })).toBeTruthy();
  });
  it('hides forbidden destinations and rejects direct routes', async () => {
    await mount(
      { '/api/v1/me/permissions': { body: { ...permissionFixture, rules: [['read', 'Script']] } } },
      '/campaigns',
    );
    expect(await screen.findByText('You do not have access to this area')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Campaigns' })).toBeNull();
  });
  it('shows SSO discovery only for unauthenticated sessions', async () => {
    await mount({ '/api/auth/session': { body: { code: 'VERBIS_UNAUTHENTICATED' }, status: 401 } });
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });
  it('does not mistake server outages for a signed-out session', async () => {
    await mount({ '/api/auth/session': { body: { code: 'VERBIS_UNAVAILABLE' }, status: 503 } });
    expect(await screen.findByText('The operation could not be completed')).toBeTruthy();
    expect(screen.queryByLabelText('Work email')).toBeNull();
  });
  it('opens the command palette through its keyboard shortcut', async () => {
    await mount();
    await screen.findByText('Demo campaign', {}, { timeout: 5000 });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
  it('switches to cards and filters names', async () => {
    await mount();
    await screen.findByText('Demo campaign', {}, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Card view' }));
    expect(document.querySelector('.dw-resource-card')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search this list'), {
      target: { value: 'not-present' },
    });
    expect(await screen.findByText('No results match your search')).toBeTruthy();
  });
  it('renders campaign priorities, basis point A/B weights and external mapping', async () => {
    await mount({}, `/campaigns/${campaignId}`);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Show all rows' }, { timeout: 5000 }),
    );
    expect(await screen.findByText('control: 50% / variant: 50%')).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'External mappings' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Show all rows' }, { timeout: 5000 }),
    );
    expect(await screen.findByText('fixture-queue')).toBeTruthy();
  });
  it('switches language without losing the workspace route', async () => {
    await mount();
    await screen.findByText('Demo campaign', {}, { timeout: 5000 });
    fireEvent.click(screen.getByRole('combobox', { name: 'Language' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Türkçe' }));
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('tr');
    });
  });
});
