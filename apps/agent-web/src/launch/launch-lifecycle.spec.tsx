import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import {
  fetchAgentSession,
  launchSocketTicket,
  redeemCode,
  reportIgnoredParams,
} from './launch-api.js';
import { useLaunchOffers } from './use-launch-offers.js';
import { useLaunch } from './use-launch.js';

const sockets = vi.hoisted(() => ({
  handlers: new Map<string, (value?: unknown) => void>(),
  disconnect: vi.fn(),
  auth: undefined as
    ((callback: (credentials: Record<string, string>) => void) => void) | undefined,
}));
vi.mock('socket.io-client', () => ({
  io: (_namespace: string, options: { auth: typeof sockets.auth }) => {
    sockets.auth = options.auth;
    return {
      on: (event: string, callback: (value?: unknown) => void) => {
        sockets.handlers.set(event, callback);
      },
      disconnect: sockets.disconnect,
    };
  },
}));
const session = {
    user: { id: 'synthetic-user', tenantId: 'synthetic-tenant', authMethod: 'sso' },
    csrfToken: 'synthetic-csrf',
  },
  launched = {
    sessionId: '01928f3a-0000-7000-8000-000000000001',
    path: '/s/01928f3a-0000-7000-8000-000000000001',
  };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  sockets.handlers.clear();
  sockets.auth = undefined;
  window.history.replaceState(null, '', '/');
});
function requestUrl(url: Parameters<typeof fetch>[0]): string {
  return typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
}
function network(auth = session, launch = Response.json(launched)) {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation((url) =>
      Promise.resolve(
        requestUrl(url).endsWith('/auth/session') ? Response.json(auth) : launch.clone(),
      ),
    );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
function wrapper({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}
it.each([
  ['code=' + 'a'.repeat(43), '/redeem'],
  ['jws=abc.def.ghi', '/jws'],
  ['connector=01928f3a-0000-7000-8000-000000000001&conversation=synthetic', '/embedded'],
])(
  'launches verified material %s exactly once in StrictMode and scrubs the URL before fetch',
  async (fragment, endpoint) => {
    window.history.replaceState(null, '', '/launch?user=private#' + fragment);
    const fetch = network(),
      navigate = vi.fn();
    const view = renderHook(() => useLaunch({ navigate }), { wrapper });
    expect(location.search).toBe('');
    expect(location.hash).toBe('');
    await waitFor(() => {
      expect(view.result.current.status).toBe('launched');
    });
    expect(navigate).toHaveBeenCalledExactlyOnceWith(launched.path);
    expect(fetch.mock.calls.filter(([url]) => requestUrl(url).endsWith(endpoint))).toHaveLength(1);
  },
);
it.each(['signedOut', 'breakGlass', 'noLaunch', 'denied'])(
  'keeps unauthorized or absent launches in the %s state',
  async (state) => {
    window.history.replaceState(null, '', '/launch');
    const fetch = network();
    if (state === 'signedOut') fetch.mockResolvedValue(new Response(null, { status: 401 }));
    if (state === 'breakGlass')
      fetch.mockResolvedValue(
        Response.json({ ...session, user: { ...session.user, authMethod: 'break_glass' } }),
      );
    if (state === 'denied') fetch.mockRejectedValue(new Error('synthetic network failure'));
    const navigate = vi.fn(),
      view = renderHook(() => useLaunch({ navigate }));
    await waitFor(() => {
      expect(view.result.current.status).toBe(state);
    });
    expect(navigate).not.toHaveBeenCalled();
  },
);
it('allows re-verifying an embedded hint after a denied launch and refuses malformed success bodies', async () => {
  window.history.replaceState(
    null,
    '',
    '/launch#connector=01928f3a-0000-7000-8000-000000000001&conversation=synthetic',
  );
  const fetch = network(session, Response.json({ code: 'VERBIS_LAUNCH_DENIED' }, { status: 403 })),
    navigate = vi.fn(),
    view = renderHook(() => useLaunch({ navigate }));
  await waitFor(() => {
    expect(view.result.current.status).toBe('denied');
  });
  const state = view.result.current;
  if (state.status !== 'denied') throw new Error('Expected denied launch');
  expect(state.connectorId).toBe('01928f3a-0000-7000-8000-000000000001');
  fetch.mockResolvedValue(Response.json(launched));
  await act(async () => {
    state.retry?.();
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(navigate).toHaveBeenCalledWith(launched.path);
  });
  fetch.mockResolvedValue(Response.json({ path: 'https://evil.example.test/' }));
  await expect(redeemCode('a'.repeat(43), 'csrf')).rejects.toMatchObject({
    code: 'VERBIS_HTTP_UNAVAILABLE',
  });
});
it('validates session and socket-ticket bodies and treats ignored URL-parameter signals as best effort', async () => {
  const fetch = network();
  fetch.mockResolvedValue(new Response('{broken'));
  expect(await fetchAgentSession()).toBeNull();
  await expect(launchSocketTicket('csrf')).rejects.toMatchObject({
    code: 'VERBIS_HTTP_UNAVAILABLE',
  });
  fetch.mockResolvedValue(Response.json({ ticket: 'synthetic-ticket', namespace: '/launch' }));
  expect(await launchSocketTicket('csrf')).toBe('synthetic-ticket');
  const count = fetch.mock.calls.length;
  await reportIgnoredParams([], 'csrf');
  expect(fetch).toHaveBeenCalledTimes(count);
  fetch.mockResolvedValue(new Response(null, { status: 204 }));
  await reportIgnoredParams(['userid'], 'csrf');
  fetch.mockRejectedValue(new Error('synthetic'));
  await expect(reportIgnoredParams(['userid'], 'csrf')).resolves.toBeUndefined();
  fetch.mockResolvedValue(new Response('{broken', { status: 500 }));
  await expect(redeemCode('a'.repeat(43), 'csrf')).rejects.toMatchObject({
    code: 'VERBIS_HTTP_UNAVAILABLE',
  });
});
it('authenticates launch sockets, validates offers, updates connection state and disconnects on unmount', async () => {
  const fetch = network(),
    navigate = vi.fn(),
    view = renderHook(() => useLaunchOffers(true, navigate));
  await waitFor(() => {
    expect(sockets.auth).toBeDefined();
  });
  fetch.mockResolvedValueOnce(Response.json({ ticket: 'synthetic-ticket', namespace: '/launch' }));
  const credentials = vi.fn();
  sockets.auth?.(credentials);
  await waitFor(() => {
    expect(credentials).toHaveBeenCalledWith({ ticket: 'synthetic-ticket' });
  });
  act(() => {
    sockets.handlers.get('connect')?.();
  });
  expect(view.result.current).toBe('connected');
  for (const invalid of [null, {}, { code: 1 }, { code: 'invalid' }])
    sockets.handlers.get('launch.offer')?.(invalid);
  expect(navigate).not.toHaveBeenCalled();
  sockets.handlers.get('launch.offer')?.({ code: 'a'.repeat(43) });
  await waitFor(() => {
    expect(navigate).toHaveBeenCalledWith(launched.path);
  });
  act(() => {
    sockets.handlers.get('disconnect')?.();
  });
  expect(view.result.current).toBe('disconnected');
  act(() => {
    sockets.handlers.get('connect_error')?.();
  });
  expect(view.result.current).toBe('disconnected');
  view.unmount();
  expect(sockets.disconnect).toHaveBeenCalled();
});
it('does not connect a disabled offer hook or a signed-out agent and declines ticket failures', async () => {
  const fetch = network();
  const disabled = renderHook(() => useLaunchOffers(false, vi.fn()));
  expect(fetch).not.toHaveBeenCalled();
  disabled.unmount();
  fetch.mockResolvedValue(new Response(null, { status: 401 }));
  const signedOut = renderHook(() => useLaunchOffers(true, vi.fn()));
  await act(async () => {
    await Promise.resolve();
  });
  expect(sockets.auth).toBeUndefined();
  signedOut.unmount();
  fetch.mockResolvedValue(Response.json(session));
  renderHook(() => useLaunchOffers(true, vi.fn()));
  await waitFor(() => {
    expect(sockets.auth).toBeDefined();
  });
  fetch.mockRejectedValue(new Error('synthetic'));
  const callback = vi.fn();
  sockets.auth?.(callback);
  await waitFor(() => {
    expect(callback).toHaveBeenCalledWith({});
  });
  sockets.handlers.get('launch.offer')?.({ code: 'a'.repeat(43) });
  await act(async () => {
    await Promise.resolve();
  });
});
it('does not navigate after the launch page has unmounted while redemption is pending', async () => {
  window.history.replaceState(null, '', '/launch#code=' + 'a'.repeat(43));
  let finish: ((response: Response) => void) | undefined;
  const fetch = network();
  fetch.mockImplementation((url) =>
    requestUrl(url).endsWith('/auth/session')
      ? Promise.resolve(Response.json(session))
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  const navigate = vi.fn(),
    view = renderHook(() => useLaunch({ navigate }));
  await waitFor(() => {
    expect(finish).toBeDefined();
  });
  view.unmount();
  await act(async () => {
    finish?.(Response.json(launched));
    await Promise.resolve();
  });
  expect(navigate).not.toHaveBeenCalled();
});

it('does not navigate when an offered launch resolves after unmount', async () => {
  let finish: ((response: Response) => void) | undefined;
  const fetch = network(),
    navigate = vi.fn();
  const view = renderHook(() => useLaunchOffers(true, navigate));
  await waitFor(() => {
    expect(sockets.auth).toBeDefined();
  });
  fetch.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  sockets.handlers.get('launch.offer')?.({ code: 'a'.repeat(43) });
  await waitFor(() => {
    expect(finish).toBeDefined();
  });
  view.unmount();
  await act(async () => {
    finish?.(Response.json(launched));
    await Promise.resolve();
  });
  expect(navigate).not.toHaveBeenCalled();
  const calls = fetch.mock.calls.length;
  sockets.handlers.get('launch.offer')?.({ code: 'b'.repeat(43) });
  expect(fetch).toHaveBeenCalledTimes(calls);
});
