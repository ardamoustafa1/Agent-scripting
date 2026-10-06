import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import { createI18n, type I18nInstance } from '@verbis/i18n';
import { UiProvider } from '@verbis/ui';

import { AgentWorkspace } from './workspace.js';

const id = '01928f3a-0000-7000-8000-000000000001';
const session = { user: { id, tenantId: id, authMethod: 'sso' }, csrfToken: 'synthetic' };
const socket = vi.hoisted(
  (): { handlers: Map<string, (input?: unknown) => void>; auth: unknown } => ({
    handlers: new Map<string, (input?: unknown) => void>(),
    auth: undefined,
  }),
);
vi.mock('socket.io-client', () => ({
  io: (_namespace: string, options: { auth?: unknown }) => {
    socket.auth = options.auth;
    return {
      on: (name: string, callback: (input?: unknown) => void) => {
        socket.handlers.set(name, callback);
      },
      disconnect: vi.fn(),
    };
  },
}));
let i18n: I18nInstance;
const clients: QueryClient[] = [];
beforeAll(async () => {
  i18n = await createI18n('en');
});
afterEach(async () => {
  clients.splice(0).forEach((client) => {
    client.clear();
  });
  socket.handlers.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  await i18n.changeLanguage('en');
});
function mount(signedIn = true, supervisor = false, emptySessions = false) {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  for (const key of [
    'hasPointerCapture',
    'setPointerCapture',
    'releasePointerCapture',
    'scrollIntoView',
  ])
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      value: key === 'hasPointerCapture' ? () => false : vi.fn(),
    });
  const fetcher = vi.fn<typeof fetch>().mockImplementation((url) => {
    const path = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (path.endsWith('/auth/session'))
      return Promise.resolve(
        signedIn ? Response.json(session) : new Response(null, { status: 401 }),
      );
    if (path.endsWith('/permissions'))
      return Promise.resolve(Response.json({ roles: supervisor ? ['supervisor'] : ['agent'] }));
    if (path.endsWith('/tenant')) return Promise.resolve(Response.json({ settings: {} }));
    if (path.endsWith('/genesys-engage/links')) return Promise.resolve(Response.json([]));
    if (path.endsWith('/state'))
      return Promise.resolve(
        Response.json({
          id,
          state: 'active',
          sequence: 1,
          readOnly: true,
          snapshot: {
            variables: { name: 'Synthetic', structured: { safe: true } },
            currentPage: 'home',
            history: [],
            timers: {},
          },
        }),
      );
    if (path.includes('/supervisor/sessions'))
      return Promise.resolve(
        Response.json({
          data: emptySessions
            ? []
            : [{ id, userId: id, state: 'active', startedAt: '2026-10-03T10:00:00Z' }],
          page: { nextCursor: null },
        }),
      );
    return Promise.resolve(Response.json({ data: [], page: { nextCursor: null } }));
  });
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const ui = render(
    <QueryClientProvider client={client}>
      <UiProvider i18n={i18n}>
        <AgentWorkspace />
      </UiProvider>
    </QueryClientProvider>,
  );
  return { ui, fetcher };
}
it('explains an empty supervisor session list and disables its selector', async () => {
  mount(true, true, true);
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('agent.desktop.supervisor') }));
  await screen.findByText('No active sessions available to monitor.');
  expect(
    screen
      .getByRole('combobox', { name: i18n.t('agent.desktop.interaction') })
      .hasAttribute('disabled'),
  ).toBe(true);
});
it('waits for authorized interactions, reports socket state, and persists accessible display preferences', async () => {
  localStorage.setItem('verbis.agent.preferences', 'malformed');
  mount();
  await screen.findByRole('heading', { name: i18n.t('agent.launch.waiting') });
  expect(document.querySelector('.ag-workspace')?.getAttribute('data-size')).toBe('medium');
  act(() => {
    socket.handlers.get('connect')?.();
  });
  expect(screen.getByText(i18n.t('agent.desktop.connection.connected'))).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('agent.desktop.preferences') }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('combobox', { name: i18n.t('agent.desktop.fontSize') }));
  fireEvent.click(await screen.findByRole('option', { name: i18n.t('agent.desktop.sizes.large') }));
  fireEvent.click(screen.getByRole('combobox', { name: i18n.t('agent.desktop.density') }));
  fireEvent.click(
    await screen.findByRole('option', { name: i18n.t('agent.desktop.densities.compact') }),
  );
  await waitFor(() => {
    expect(JSON.parse(localStorage.getItem('verbis.agent.preferences') ?? '{}')).toEqual({
      size: 'large',
      density: 'compact',
    });
  });
  expect(document.querySelector('.ag-workspace')?.getAttribute('data-size')).toBe('large');
});
it('loads valid saved preferences and keeps the waiting workspace usable when storage is restricted', async () => {
  localStorage.setItem(
    'verbis.agent.preferences',
    JSON.stringify({ size: 'small', density: 'compact' }),
  );
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('synthetic restricted storage');
  });
  mount();
  await screen.findByRole('heading', { name: i18n.t('agent.launch.waiting') });
  expect(document.querySelector('.ag-workspace')?.getAttribute('data-density')).toBe('compact');
});
it('discovers SSO providers for a validated organization and recovers after discovery failure', async () => {
  const f = mount(false);
  const input = await screen.findByRole('textbox', { name: i18n.t('agent.desktop.tenant') });
  const button = screen.getByRole('button', { name: i18n.t('agent.desktop.continue') });
  fireEvent.change(input, { target: { value: '../invalid' } });
  expect(button.getAttribute('disabled')).not.toBeNull();
  fireEvent.change(input, { target: { value: 'synthetic-tenant' } });
  f.fetcher.mockResolvedValueOnce(new Response('private', { status: 500 }));
  fireEvent.click(button);
  await screen.findByText(i18n.t('agent.desktop.failed'));
  f.fetcher.mockResolvedValueOnce(
    Response.json({ providers: [{ id: 'synthetic-idp', displayName: 'Synthetic SSO' }] }),
  );
  fireEvent.click(button);
  const link = await screen.findByRole('link', { name: 'Synthetic SSO' });
  expect(link.getAttribute('href')).toBe(
    '/api/auth/login?tenant=synthetic-tenant&idp=synthetic-idp&app=agent&returnTo=%2F',
  );
  expect(screen.queryByText(i18n.t('agent.desktop.failed'))).toBeNull();
});
it('restricts supervisor controls to authorized roles and renders watched variables without writer mutations', async () => {
  const f = mount(true, true);
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('agent.desktop.supervisor') }));
  await screen.findByRole('heading', { name: i18n.t('agent.desktop.supervisor') });
  await waitFor(() => {
    expect(
      screen
        .getByRole('combobox', { name: i18n.t('agent.desktop.interaction') })
        .hasAttribute('disabled'),
    ).toBe(false);
  });
  fireEvent.click(screen.getByRole('combobox', { name: i18n.t('agent.desktop.interaction') }));
  fireEvent.click(await screen.findByRole('option', { name: /01928f3a/ }));
  expect(await screen.findByText('Synthetic')).toBeDefined();
  expect(screen.getByText('{"safe":true}')).toBeDefined();
  expect(f.fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: i18n.t('agent.desktop.supervisor') }));
  await screen.findByRole('heading', { name: i18n.t('agent.launch.waiting') });
});
it('keeps the workspace and reports failed logout so the agent can retry', async () => {
  const f = mount();
  await screen.findByRole('heading', { name: i18n.t('agent.launch.waiting') });
  f.fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('agent.desktop.logout') }));
  expect(await screen.findByText(i18n.t('agent.desktop.failed'))).toBeDefined();
  expect(screen.getByRole('heading', { name: i18n.t('agent.launch.waiting') })).toBeDefined();
  expect(
    screen.getByRole('button', { name: i18n.t('agent.desktop.logout') }).hasAttribute('disabled'),
  ).toBe(false);
});
it('removes discovered providers when the organization changes', async () => {
  const f = mount(false);
  const input = await screen.findByRole('textbox', { name: i18n.t('agent.desktop.tenant') });
  fireEvent.change(input, { target: { value: 'first-tenant' } });
  f.fetcher.mockResolvedValueOnce(
    Response.json({ providers: [{ id: 'first-idp', displayName: 'First SSO' }] }),
  );
  fireEvent.click(screen.getByRole('button', { name: i18n.t('agent.desktop.continue') }));
  await screen.findByRole('link', { name: 'First SSO' });
  fireEvent.change(input, { target: { value: 'second-tenant' } });
  expect(screen.queryByRole('link', { name: 'First SSO' })).toBeNull();
});
it('ignores a discovery response for an organization that changed while loading', async () => {
  const f = mount(false);
  const input = await screen.findByRole('textbox', { name: i18n.t('agent.desktop.tenant') });
  fireEvent.change(input, { target: { value: 'first-tenant' } });
  let finish!: (response: Response) => void;
  f.fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: i18n.t('agent.desktop.continue') }));
  fireEvent.change(input, { target: { value: 'second-tenant' } });
  await act(async () => {
    finish(Response.json({ providers: [{ id: 'first-idp', displayName: 'First SSO' }] }));
    await Promise.resolve();
  });
  expect(screen.queryByRole('link', { name: 'First SSO' })).toBeNull();
});
it('does not expose supervisor mode to an ordinary agent and follows callback routes on browser history', async () => {
  vi.stubGlobal('opener', null);
  mount();
  await screen.findByRole('heading', { name: i18n.t('agent.launch.waiting') });
  expect(screen.queryByRole('button', { name: i18n.t('agent.desktop.supervisor') })).toBeNull();
  act(() => {
    window.history.pushState(null, '', '/genesys/linked#status=failed');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(await screen.findByRole('alert')).toBeDefined();
});

it('uses read-only push snapshots, ticket failures and event invalidation for supervisor observation', async () => {
  const f = mount(true, true);
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('agent.desktop.supervisor') }));
  const selector = await screen.findByRole('combobox', {
    name: i18n.t('agent.desktop.interaction'),
  });
  await waitFor(() => {
    expect(selector.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.click(selector);
  fireEvent.click(await screen.findByRole('option', { name: /01928f3a/ }));
  await screen.findByText('Synthetic');
  act(() => socket.handlers.get('connect')?.());
  act(() =>
    socket.handlers.get('runtime.resume')?.({
      snapshot: {
        id,
        state: 'active',
        sequence: 2,
        readOnly: true,
        snapshot: {
          variables: { name: '[REDACTED]' },
          currentPage: 'home',
          history: [],
          timers: {},
        },
      },
    }),
  );
  expect(await screen.findByText('[REDACTED]')).toBeDefined();
  act(() => socket.handlers.get('runtime.resume')?.({ invalid: true }));
  act(() => socket.handlers.get('runtime.event')?.());
  await screen.findByText('Synthetic');
  const auth = socket.auth as (callback: (result: unknown) => void) => void;
  const callback = vi.fn();
  f.fetcher.mockResolvedValueOnce(Response.json({ ticket: 'synthetic-ticket' }));
  await act(async () => {
    auth(callback);
    await Promise.resolve();
  });
  expect(callback).toHaveBeenCalledWith({ ticket: 'synthetic-ticket' });
  f.fetcher.mockRejectedValueOnce(new Error('private network detail'));
  await act(async () => {
    auth(callback);
    await Promise.resolve();
  });
  expect(callback).toHaveBeenCalledWith({});
  act(() => socket.handlers.get('runtime.error')?.());
  act(() => socket.handlers.get('disconnect')?.());
  act(() => socket.handlers.get('connect_error')?.());
});
