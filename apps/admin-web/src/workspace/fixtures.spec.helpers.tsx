import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, vi } from 'vitest';

import { createAbility, type AppAbility } from '@verbis/authz';
import { createI18n } from '@verbis/i18n';
import { UiProvider } from '@verbis/ui';

import { AccessContext } from './access.js';
import { AdminContext } from './api.js';

const clients: QueryClient[] = [];
const i18nPromise = createI18n('en');
export const syntheticId = '01928f3a-0000-7000-8000-000000000001';
afterEach(() => {
  clients.splice(0).forEach((client) => {
    client.clear();
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
export async function mountAdmin(
  children: ReactNode,
  responses: Record<string, unknown> = {},
  ability: AppAbility = createAbility([{ action: 'manage', subject: 'all' }]),
) {
  const i18n = await i18nPromise;
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
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
  const requests: { path: string; method: string; body: unknown; init: RequestInit | undefined }[] =
    [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation((url, init) => {
    const raw = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    const path = raw.replace(/^\/api/, ''),
      method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ path, method, body, init });
    const value =
      responses[method + ' ' + path] ??
      responses[path] ??
      (method === 'GET' ? [] : { id: syntheticId, version: 2 });
    return Promise.resolve(value instanceof Response ? value.clone() : Response.json(value));
  });
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const session = {
    user: { id: syntheticId, tenantId: syntheticId, authMethod: 'sso' as const },
    session: { id: syntheticId, protocol: 'oidc' as const, expiresAt: '2026-10-04T10:00:00Z' },
    csrfToken: 'synthetic-csrf',
  };
  const ui = render(
    <QueryClientProvider client={client}>
      <AdminContext.Provider value={session}>
        <AccessContext.Provider value={ability}>
          <UiProvider i18n={i18n}>{children}</UiProvider>
        </AccessContext.Provider>
      </AdminContext.Provider>
    </QueryClientProvider>,
  );
  return {
    ui,
    requests,
    fetcher,
    responses,
    client,
    i18n,
    label: (key: string) => i18n.t(`adminWorkspace.${key}`),
  };
}
