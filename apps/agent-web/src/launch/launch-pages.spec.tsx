import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import { createI18n, type I18nInstance } from '@verbis/i18n';

import { EngageLinksCard } from './engage-links-card.js';
import { LINK_MESSAGE } from './genesys-link.js';
import { GenesysLinkedPage } from './genesys-linked-page.js';
import { LaunchPage } from './launch-page.js';
import { SessionPage } from './session-page.js';

const connectorId = '01928f3a-0000-7000-8000-000000000001';
const session = {
  user: { id: 'synthetic', tenantId: 'synthetic', authMethod: 'sso' },
  csrfToken: 'synthetic',
};
let i18n: I18nInstance;
const clients: QueryClient[] = [];
beforeAll(async () => {
  i18n = await createI18n('en');
});
afterEach(() => {
  clients.splice(0).forEach((client) => {
    client.clear();
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});
function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </I18nextProvider>,
  );
}
function message(origin: string, status: string) {
  window.dispatchEvent(
    new MessageEvent('message', { origin, data: { type: LINK_MESSAGE, status } }),
  );
}
it.each(['VERBIS_LAUNCH_RATE_LIMITED', 'VERBIS_LAUNCH_NO_ASSIGNMENT', 'VERBIS_LAUNCH_DENIED'])(
  'shows the safe launch failure for %s without server details',
  async (code) => {
    window.history.replaceState(null, '', '/launch#code=' + 'a'.repeat(43));
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation((url) =>
          Promise.resolve(
            typeof url === 'string' && url.endsWith('/auth/session')
              ? Response.json(session)
              : Response.json({ code, detail: 'private server detail' }, { status: 403 }),
          ),
        ),
    );
    mount(<LaunchPage navigate={vi.fn()} />);
    const key =
      code === 'VERBIS_LAUNCH_RATE_LIMITED'
        ? 'rateLimited'
        : code === 'VERBIS_LAUNCH_NO_ASSIGNMENT'
          ? 'noAssignment'
          : 'denied';
    expect((await screen.findByRole('alert')).textContent).toBe(i18n.t(`agent.launch.${key}`));
    expect(screen.queryByText('private server detail')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  },
);
it('opens the connector account popup and retries only trusted successful linking notifications', async () => {
  window.history.replaceState(
    null,
    '',
    '/launch#connector=' + connectorId + '&conversation=synthetic',
  );
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation((url) =>
      Promise.resolve(
        typeof url === 'string' && url.endsWith('/auth/session')
          ? Response.json(session)
          : Response.json({ code: 'VERBIS_LAUNCH_DENIED' }, { status: 403 }),
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  const open = vi.spyOn(window, 'open').mockReturnValue(null),
    navigate = vi.fn();
  const ui = mount(<LaunchPage navigate={navigate} />);
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('agent.launch.genesysLink') }));
  expect(open).toHaveBeenCalledWith(
    `/api/v1/genesys-cloud/connectors/${connectorId}/oauth/authorize`,
    'verbis-genesys-link',
    'popup,width=520,height=720',
  );
  const count = fetcher.mock.calls.length;
  act(() => {
    message('https://untrusted.example.test', 'linked');
    message(location.origin, 'failed');
  });
  expect(fetcher).toHaveBeenCalledTimes(count);
  fetcher.mockResolvedValue(Response.json({ sessionId: connectorId, path: '/s/' + connectorId }));
  act(() => {
    message(location.origin, 'linked');
  });
  await waitFor(() => {
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/s/' + connectorId);
  });
  ui.unmount();
  act(() => {
    message(location.origin, 'linked');
  });
  expect(navigate).toHaveBeenCalledTimes(1);
});
it('offers a manual retry when a connector popup is blocked', async () => {
  window.history.replaceState(
    null,
    '',
    '/launch#connector=' + connectorId + '&conversation=synthetic',
  );
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation((url) =>
      Promise.resolve(
        typeof url === 'string' && url.endsWith('/auth/session')
          ? Response.json(session)
          : Response.json({ code: 'VERBIS_LAUNCH_DENIED' }, { status: 403 }),
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  const navigate = vi.fn();
  mount(<LaunchPage navigate={navigate} />);
  const retry = await screen.findByRole('button', { name: i18n.t('agent.launch.retry') });
  fetcher.mockResolvedValue(Response.json({ sessionId: connectorId, path: '/s/' + connectorId }));
  fireEvent.click(retry);
  await waitFor(() => {
    expect(navigate).toHaveBeenCalledOnce();
  });
});
it.each(['linked', 'failed'])(
  'scrubs callback material and reports %s to the same-origin opener',
  (status) => {
    window.history.replaceState(null, '', '/genesys/linked?private=hidden#status=' + status);
    const postMessage = vi.fn();
    vi.stubGlobal('opener', { postMessage });
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    mount(<GenesysLinkedPage />);
    expect(location.hash).toBe('');
    expect(location.search).toBe('');
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      { type: LINK_MESSAGE, status },
      location.origin,
    );
    expect(close).toHaveBeenCalledOnce();
    expect(screen.getByRole(status === 'linked' ? 'status' : 'alert').textContent).toBe(
      i18n.t(`agent.genesysLinked.${status}`),
    );
  },
);
it('renders a failed callback safely without an opener and displays the pending session identity', () => {
  vi.stubGlobal('opener', null);
  mount(<GenesysLinkedPage />);
  expect(screen.getByRole('alert').textContent).toBe(i18n.t('agent.genesysLinked.failed'));
  mount(<SessionPage sessionId={connectorId} />);
  expect(document.querySelector('[data-session-id]')?.getAttribute('data-session-id')).toBe(
    connectorId,
  );
});
it('renders linked and unlinked Engage connectors, opens delegation, and refreshes only on trusted messages', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json([
      { connectorId, linked: false, expiresAt: null },
      {
        connectorId: '01928f3a-0000-7000-8000-000000000002',
        linked: true,
        expiresAt: '2026-10-03T10:00:00Z',
      },
    ]),
  );
  vi.stubGlobal('fetch', fetcher);
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const ui = mount(<EngageLinksCard />);
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('agent.engageLink.link') }));
  expect(open).toHaveBeenCalledWith(
    `/api/v1/genesys-engage/connectors/${connectorId}/oauth/authorize`,
    'verbis-genesys-link',
    'popup,width=520,height=720',
  );
  expect(screen.getByRole('status')).toBeDefined();
  const count = fetcher.mock.calls.length;
  act(() => {
    message('https://untrusted.example.test', 'linked');
  });
  expect(fetcher).toHaveBeenCalledTimes(count);
  fetcher.mockResolvedValue(Response.json([]));
  act(() => {
    message(location.origin, 'failed');
  });
  await waitFor(() => {
    expect(screen.queryByRole('heading')).toBeNull();
  });
  ui.unmount();
  const done = fetcher.mock.calls.length;
  act(() => {
    message(location.origin, 'linked');
  });
  expect(fetcher).toHaveBeenCalledTimes(done);
});
it('hides the Engage card when no delegated connectors are available', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }));
  vi.stubGlobal('fetch', fetcher);
  const ui = mount(<EngageLinksCard />);
  await waitFor(() => {
    expect(fetcher).toHaveBeenCalledOnce();
  });
  expect(ui.container.textContent).toBe('');
});
