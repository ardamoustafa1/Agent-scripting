import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

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
