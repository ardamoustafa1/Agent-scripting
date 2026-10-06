import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { type ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, vi } from 'vitest';

import { createAbility, type AppAbility } from '@verbis/authz';
import { AbilityProvider } from '@verbis/authz/react';
import { createI18n } from '@verbis/i18n';
import { UiProvider } from '@verbis/ui';

import { SessionSchema } from './api/client.js';
import { sessionFixture } from './test-fixtures.js';
import { WorkspaceContext } from './workspace/context.js';

const clients: QueryClient[] = [];
const routers: ReturnType<typeof createMemoryRouter>[] = [];
const locale = createI18n('en');
afterEach(() => {
  clients.splice(0).forEach((c) => {
    c.clear();
  });
  routers.splice(0).forEach((router) => {
    router.dispose();
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
export async function mountDesigner(
  children: ReactNode,
  responses: Record<string, unknown> = {},
  options: {
    ability?: AppAbility;
    path?: string;
    route?: string;
    environment?: 'dev' | 'test' | 'prod';
  } = {},
) {
  const i18n = await locale;
  // jsdom has no CSS.escape; fixture IDs are safe kebab-case identifiers.
  vi.stubGlobal('CSS', {
    escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (character) => '\\' + character),
  });
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const requests: { path: string; method: string; body: unknown; init: RequestInit | undefined }[] =
    [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation((url, init) => {
    const raw = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    const path = raw.replace(/^\/api/, ''),
      method = init?.method ?? 'GET';
    requests.push({
      path,
      method,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      init,
    });
    const value = responses[`${method} ${path}`] ?? responses[path] ?? (method === 'GET' ? [] : {});
    return Promise.resolve(value instanceof Response ? value.clone() : Response.json(value));
  });
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const router = createMemoryRouter([{ path: options.route ?? '*', element: children }], {
    initialEntries: [options.path ?? '/'],
  });
  routers.push(router);
  const ui = render(
    <QueryClientProvider client={client}>
      <WorkspaceContext.Provider
        value={{
          session: SessionSchema.parse(sessionFixture),
          environment: options.environment ?? 'dev',
        }}
      >
        <AbilityProvider
          ability={options.ability ?? createAbility([{ action: 'manage', subject: 'all' }])}
        >
          <UiProvider i18n={i18n}>
            <RouterProvider router={router} />
          </UiProvider>
        </AbilityProvider>
      </WorkspaceContext.Provider>
    </QueryClientProvider>,
  );
  return {
    router,
    ui,
    i18n,
    requests,
    responses,
    fetcher,
    client,
    label: (key: string) => i18n.t(`designer.${key}`),
  };
}
