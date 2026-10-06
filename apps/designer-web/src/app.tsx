import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import { abilityFromSerialized } from '@verbis/authz';
import { AbilityProvider } from '@verbis/authz/react';
import { UiProvider, useTheme } from '@verbis/ui';

import { session, permissions } from './api/client.js';
import { Loading, Failure } from './workspace/states.js';

const Login = lazy(() => import('./pages/login.js'));
const Shell = lazy(() => import('./workspace/shell.js'));
function SessionApp() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useTheme();
  const auth = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: ({ signal }) => session(signal),
    retry: false,
    refetchInterval: 60000,
  });
  const access = useQuery({
    queryKey: ['auth', 'permissions', auth.data?.user.tenantId, auth.data?.user.id],
    queryFn: ({ signal }) => permissions(signal),
    enabled: !!auth.data,
    retry: false,
    refetchInterval: 60000,
  });
  const ability = useMemo(() => {
    try {
      return access.data
        ? abilityFromSerialized(
            access.data.rules as unknown as Parameters<typeof abilityFromSerialized>[0],
          )
        : null;
    } catch {
      return null;
    }
  }, [access.data]);
  useEffect(() => {
    document.documentElement.lang = i18n.language;
    document.title = `${t('common.productName')} · ${t('designer.workspace.studio')}`;
  }, [t, i18n.language]);
  return (
    <UiProvider i18n={i18n} theme={theme}>
      <Suspense fallback={<Loading />}>
        {auth.isPending ? (
          <Loading />
        ) : auth.isError ? (
          <Failure
            retry={() => {
              void auth.refetch();
            }}
          />
        ) : !auth.data ? (
          <Login />
        ) : access.isError ? (
          <Failure
            retry={() => {
              void access.refetch();
            }}
          />
        ) : !ability ? (
          access.data ? (
            <Failure
              retry={() => {
                void access.refetch();
              }}
            />
          ) : (
            <Loading />
          )
        ) : access.data?.principal.tenantId !== auth.data.user.tenantId ||
          access.data.principal.id !== auth.data.user.id ? (
          <Failure
            retry={() => {
              void auth.refetch();
            }}
          />
        ) : (
          <AbilityProvider ability={ability}>
            <Shell session={auth.data} theme={theme} setTheme={setTheme} />
          </AbilityProvider>
        )}
      </Suspense>
    </UiProvider>
  );
}

export function createDesignerRouter() {
  return createBrowserRouter([{ path: '*', element: <SessionApp /> }]);
}
let browserRouter: ReturnType<typeof createDesignerRouter> | undefined;
function applicationRouter() {
  browserRouter ??= createDesignerRouter();
  return browserRouter;
}
/** The browser router lives for the application lifetime; StrictMode effect cleanup must not dispose it. */
export function App({ router }: { router?: ReturnType<typeof createDesignerRouter> } = {}) {
  return <RouterProvider router={router ?? applicationRouter()} />;
}
