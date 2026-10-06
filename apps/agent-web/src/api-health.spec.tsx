import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { api } from './desktop/api.js';
import { useApiHealth } from './use-api-health.js';

const clients: QueryClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => {
    client.clear();
  });
  vi.unstubAllGlobals();
});
it.each([
  [
    'up',
    Response.json({
      status: 'ok',
      service: 'synthetic',
      version: '1',
      checks: { database: { status: 'up' } },
    }),
  ],
  ['down', new Response('<html>SPA fallback</html>')],
  ['down', Response.json({ status: 'ok' })],
  ['down', Response.json({ status: 'degraded', service: 'synthetic', version: '1', checks: {} })],
  ['down', new Response(null, { status: 503 })],
] as const)(
  'reports API %s only after validating the readiness response',
  async (expected, response) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(response));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    const view = renderHook(() => useApiHealth(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    expect(view.result.current).toBe('unknown');
    await waitFor(() => {
      expect(view.result.current).toBe(expected);
    });
  },
);
it('rejects traversal and external request paths before sending credentials', async () => {
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  for (const path of [
    'https://untrusted.example.test/v1/sessions',
    '/v1/../auth/session',
    '/public/foo',
    '/v1/https://untrusted.example.test',
  ])
    await expect(api(path, z.unknown())).rejects.toMatchObject({
      status: 400,
      code: 'VERBIS_CLIENT_PATH',
    });
  expect(fetcher).not.toHaveBeenCalled();
});
it('sends sequenced mutations with CSRF and cancellation, validates success bodies, and keeps malformed errors safe', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ sequence: 2 }));
  vi.stubGlobal('fetch', fetcher);
  const abort = new AbortController();
  await expect(
    api(
      '/v1/sessions/synthetic/commands',
      z.object({ sequence: z.number() }),
      'synthetic-csrf',
      { sequence: 1 },
      abort.signal,
    ),
  ).resolves.toEqual({ sequence: 2 });
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/sessions/synthetic/commands',
    expect.objectContaining({
      credentials: 'same-origin',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: abort.signal,
      method: 'POST',

      body: '{"sequence":1}',
    }),
  );
  expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
    'x-csrf-token': 'synthetic-csrf',
    'content-type': 'application/json',
  });
  fetcher.mockResolvedValue(new Response('private malformed exception', { status: 500 }));
  await expect(api('/auth/session', z.unknown())).rejects.toMatchObject({
    status: 500,
    code: 'VERBIS_HTTP_UNAVAILABLE',
  });
  fetcher.mockResolvedValue(
    Response.json({ code: 'VERBIS_FORBIDDEN', detail: 'private' }, { status: 403 }),
  );
  await expect(api('/auth/session', z.unknown())).rejects.toMatchObject({
    status: 403,
    code: 'VERBIS_FORBIDDEN',
  });
  fetcher.mockResolvedValue(Response.json({ sequence: 'wrong' }));
  await expect(
    api('/v1/sessions/synthetic/state', z.object({ sequence: z.number() })),
  ).rejects.toThrow();
});
