import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers3, Radio, Settings2, LogOut } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { io } from 'socket.io-client';
import { z } from 'zod';

import { AdminBrandSchema } from '@verbis/shared-types';
import {
  UiProvider,
  AccessLayout,
  BrandLogo,
  Button,
  Input,
  Select,
  Alert,
  Badge,
  Skeleton,
  Dialog,
  useTheme,
  THEMES,
  type Theme,
} from '@verbis/ui';

import { EngageLinksCard } from '../launch/engage-links-card.js';
import { LINKED_PATH } from '../launch/genesys-link.js';
import { GenesysLinkedPage } from '../launch/genesys-linked-page.js';
import { fetchAgentSession, type LaunchApiError } from '../launch/launch-api.js';
import { LaunchPage } from '../launch/launch-page.js';
import { useLaunchOffers } from '../launch/use-launch-offers.js';

import { api, View, Desktop } from './api.js';
import { FailureNotice } from './failure-notice.js';
import { type AgentFailure } from './failure.js';
import { DraftVault } from './vault.js';
import './styles.css';

const loadSessionView = () => import('./session-view.js');
const SessionView = lazy(() =>
  loadSessionView().then((module) => ({ default: module.SessionView })),
);
const Sessions = z.object({
  data: z.array(
    z.object({ id: z.uuid(), userId: z.uuid(), state: z.string(), startedAt: z.string() }),
  ),
  page: z.object({ nextCursor: z.string().nullable() }),
});
const Preferences = z.object({
  size: z.enum(['small', 'medium', 'large']),
  density: z.enum(['comfortable', 'compact']),
});
function readPreferences() {
  try {
    return Preferences.parse(JSON.parse(localStorage.getItem('verbis.agent.preferences') ?? '{}'));
  } catch {
    return Preferences.parse({ size: 'medium', density: 'comfortable' });
  }
}
export function AgentWorkspace() {
  const { t, i18n } = useTranslation(),
    client = useQueryClient(),
    [theme, setTheme] = useTheme();
  const [path, setPath] = useState(() => window.location.pathname),
    [opened, setOpened] = useState<string[]>(() => {
      const id = /^\/s\/([0-9a-f-]{36})$/.exec(window.location.pathname)?.[1];
      return id ? [id] : [];
    }),
    [active, setActive] = useState<string | null>(
      () => /^\/s\/([0-9a-f-]{36})$/.exec(window.location.pathname)?.[1] ?? null,
    ),
    [status, setStatus] = useState<Record<string, string>>({}),
    [identities, setIdentities] = useState<
      Record<string, { channel: string; customer: string | null; startedAt: string }>
    >({}),
    [unread, setUnread] = useState<string[]>([]),
    [settings, setSettings] = useState(false),
    [prefs, setPrefs] = useState(readPreferences),
    [supervisor, setSupervisor] = useState(false),
    [loggingOut, setLoggingOut] = useState(false),
    [logoutFailed, setLogoutFailed] = useState(false),
    [launchFailure, setLaunchFailure] = useState<AgentFailure | null>(null);
  const onLaunchFailure = useCallback((error: LaunchApiError) => {
    setLaunchFailure({
      kind: [401, 403].includes(error.status) ? 'authorization' : 'network',
      correlationId: error.correlationId,
    });
  }, []);
  const onIdentity = useCallback((id: string, desktop: Desktop) => {
    setIdentities((previous) => {
      const next = {
        channel: desktop.interaction.channel,
        customer: desktop.interaction.customerName,
        startedAt: desktop.startedAt,
      };
      return JSON.stringify(previous[id]) === JSON.stringify(next)
        ? previous
        : { ...previous, [id]: next };
    });
  }, []);
  const auth = useQuery({ queryKey: ['agent', 'auth'], queryFn: fetchAgentSession, retry: false });
  const session = auth.data,
    valid = session?.user.authMethod === 'sso';
  useEffect(() => {
    if (valid) void loadSessionView();
  }, [valid]);
  const key = ['agent', session?.user.tenantId, session?.user.id, session?.session?.id];
  const tenantBrand = useQuery({
    queryKey: [...key, 'brand'],
    queryFn: () =>
      api('/v1/tenant', z.object({ settings: z.object({ brand: AdminBrandSchema.optional() }) })),
    enabled: valid,
  });
  const brand = tenantBrand.data?.settings.brand;
  const vault = useMemo(
    () =>
      session
        ? new DraftVault(
            `${session.user.tenantId}:${session.user.id}:${session.session?.id ?? 'legacy'}`,
          )
        : null,
    [session],
  );
  const permissions = useQuery({
    queryKey: [...key, 'permissions'],
    queryFn: () => api('/v1/me/permissions', z.object({ roles: z.array(z.string()) })),
    enabled: valid,
  });
  const recent = useQuery({
    queryKey: [...key, 'sessions'],
    queryFn: () => api('/v1/sessions?limit=100&sort=-startedAt', Sessions),
    enabled: valid,
    refetchInterval: 30000,
  });
  useEffect(() => {
    if (!valid || !vault) return;
    for (const row of recent.data?.data ?? []) {
      if (
        row.userId !== session.user.id ||
        !['launching', 'active', 'paused', 'wrapup'].includes(row.state)
      )
        continue;
      void client
        .query({
          queryKey: ['agent', 'desktop', vault.partition, row.id],
          queryFn: ({ signal }) =>
            api(`/v1/sessions/${row.id}/desktop`, Desktop, undefined, undefined, signal),
          staleTime: 10000,
          gcTime: 60000,
        })
        .then((desktop) => {
          onIdentity(row.id, desktop);
        })
        .catch(() => undefined);
    }
  }, [valid, vault, recent.data, session?.user.id, client, onIdentity]);
  const navigate = useCallback((next: string) => {
    const id = /^\/s\/([0-9a-f-]{36})$/.exec(next)?.[1];
    if (!id) return;
    setLaunchFailure(null);
    window.history.pushState(null, '', next);
    setPath(next);
    setOpened((previous) => (previous.includes(id) ? previous : [...previous, id]));
    setActive(id);
    setUnread((previous) => (previous.includes(id) ? previous : [...previous, id]));
  }, []);
  const connectorStatus = useLaunchOffers(valid && path !== LINKED_PATH, navigate, onLaunchFailure);
  const onStatus = useCallback((id: string, state: string, unseen: boolean) => {
    if (unseen) setUnread((previous) => (previous.includes(id) ? previous : [...previous, id]));
    setStatus((previous) => (previous[id] === state ? previous : { ...previous, [id]: state }));
  }, []);
  useEffect(() => {
    const pop = () => {
      setPath(window.location.pathname);
      setActive(/^\/s\/([0-9a-f-]{36})$/.exec(window.location.pathname)?.[1] ?? null);
    };
    window.addEventListener('popstate', pop);
    return () => {
      window.removeEventListener('popstate', pop);
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = i18n.language;
    document.title = `${t('common.productName')} · ${t('agent.hello.appName')}`;
  }, [i18n.language, t]);
  useEffect(() => {
    try {
      localStorage.setItem('verbis.agent.preferences', JSON.stringify(prefs));
    } catch {
      /* Embedded storage may be restricted; preferences still work for this tab. */
    }
  }, [prefs]);
  const ids = [
    ...new Set([
      ...opened,
      ...(recent.data?.data
        .filter(
          (row) =>
            row.userId === session?.user.id &&
            ['launching', 'active', 'paused', 'wrapup'].includes(row.state),
        )
        .map((row) => row.id) ?? []),
    ]),
  ];
  ids.sort((a, b) => {
    const time = (id: string) =>
      identities[id]?.startedAt ?? recent.data?.data.find((row) => row.id === id)?.startedAt ?? '';
    return time(a).localeCompare(time(b));
  });
  const embedded = window.self !== window.top;
  const selected = active ?? ids[0] ?? null;
  if (path === '/launch') return <LaunchPage navigate={navigate} />;
  if (path === LINKED_PATH) return <GenesysLinkedPage />;
  if (auth.isPending) return <Skeleton height="80vh" />;
  if (!valid) return <SignIn />;
  const canWatch =
    permissions.data?.roles.some((role) =>
      ['supervisor', 'tenant_admin', 'super_admin'].includes(role),
    ) ?? false;
  return (
    <UiProvider
      i18n={i18n}
      theme={theme}
      {...(brand
        ? {
            brand: {
              name: brand.name,
              primaryColor: brand.primaryColor,
              ...(brand.logoUrl ? { logoUrl: brand.logoUrl } : {}),
            },
          }
        : {})}
    >
      <div
        className={`ag-workspace ${embedded ? 'ag-embedded' : ''}`}
        data-density={embedded ? 'compact' : prefs.density}
        data-size={prefs.size}
      >
        <a
          className="vb-skip-link"
          tabIndex={0}
          href={selected ? `#script-${selected}` : '#agent-waiting'}
        >
          {t('common.skipToContent')}
        </a>
        <header className="ag-topbar vb-brand-surface">
          <div className="ag-brand">
            <Layers3 size={24} aria-hidden />
            {brand ? (
              <BrandLogo
                brand={{
                  name: brand.name,
                  primaryColor: brand.primaryColor,
                  ...(brand.logoUrl ? { logoUrl: brand.logoUrl } : {}),
                }}
              />
            ) : (
              <strong>{t('common.productName')}</strong>
            )}
            <span>{brand?.agentTitle.length ? brand.agentTitle : t('agent.hello.appName')}</span>
          </div>
          <div className="ag-actions">
            {canWatch && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSupervisor((v) => !v);
                }}
              >
                {t('agent.desktop.supervisor')}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('agent.desktop.preferences')}
              onClick={() => {
                setSettings(true);
              }}
            >
              <Settings2 size={17} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('agent.desktop.logout')}
              loading={loggingOut}
              onClick={() => {
                setLoggingOut(true);
                setLogoutFailed(false);
                void api('/auth/logout', z.unknown(), session.csrfToken, {})
                  .then(async () => {
                    try {
                      await vault?.clear();
                    } finally {
                      client.clear();
                      window.location.assign('/');
                    }
                  })
                  .catch(() => {
                    setLogoutFailed(true);
                  })
                  .finally(() => {
                    setLoggingOut(false);
                  });
              }}
            >
              <LogOut size={17} />
            </Button>
          </div>
        </header>
        {launchFailure && <FailureNotice failure={launchFailure} />}
        {logoutFailed && <Alert tone="danger" title={t('agent.desktop.failed')} />}
        {supervisor ? (
          <Supervisor identity={key.join(':')} csrf={session.csrfToken} />
        ) : ids.length && vault ? (
          <main id="agent-interactions">
            <div className="ag-tabs" role="tablist" aria-label={t('agent.desktop.interactions')}>
              {ids.map((id, index) => (
                <button
                  type="button"
                  key={id}
                  role="tab"
                  aria-selected={selected === id}
                  aria-controls={`interaction-${id}`}
                  id={`tab-${id}`}
                  tabIndex={selected === id ? 0 : -1}
                  onClick={() => {
                    setActive(id);
                    setUnread((list) => list.filter((value) => value !== id));
                  }}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const next =
                      event.key === 'Home'
                        ? ids[0]
                        : event.key === 'End'
                          ? ids.at(-1)
                          : ids[
                              (index + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) %
                                ids.length
                            ];
                    if (next) {
                      setActive(next);
                      setUnread((previous) => previous.filter((id) => id !== next));
                      document.getElementById(`tab-${next}`)?.focus();
                    }
                  }}
                >
                  <span className="ag-tab-label" title={identities[id]?.customer ?? undefined}>
                    {identities[id]
                      ? `${t(`agent.desktop.channels.${identities[id].channel}`)} · ${identities[id].customer ?? t('agent.desktop.customer')}`
                      : t('agent.desktop.tab', { number: index + 1 })}
                  </span>
                  <Badge tone={status[id] === 'wrapup' ? 'warning' : 'neutral'}>
                    {t(`agent.desktop.states.${status[id] ?? 'active'}`)}
                  </Badge>
                  {unread.includes(id) && selected !== id && (
                    <span className="ag-unread" aria-label={t('agent.desktop.unread')} />
                  )}
                </button>
              ))}
            </div>
            <Suspense fallback={<Skeleton height="24rem" />}>
              {ids.map((id) => (
                <div
                  key={id}
                  id={`interaction-${id}`}
                  role="tabpanel"
                  aria-labelledby={`tab-${id}`}
                  hidden={selected !== id}
                  {...(selected !== id ? { inert: '' } : {})}
                >
                  <SessionView
                    id={id}
                    csrf={session.csrfToken}
                    vault={vault}
                    active={selected === id}
                    onStatus={onStatus}
                    onIdentity={onIdentity}
                  />
                </div>
              ))}
            </Suspense>
          </main>
        ) : (
          <main id="agent-waiting" className="ag-waiting">
            <div className="ag-wait-icon">
              <Radio size={38} />
            </div>
            <h1>{brand?.waitingText.length ? brand.waitingText : t('agent.launch.waiting')}</h1>
            <p>{t('agent.hello.description')}</p>
            <Badge tone="info">{t(`agent.desktop.connection.${connectorStatus}`)}</Badge>
            <EngageLinksCard />
            <h2>{t('agent.desktop.recent')}</h2>
            <ul>
              {recent.data?.data
                .filter((row) => row.userId === session.user.id)
                .slice(0, 8)
                .map((row) => (
                  <li key={row.id}>
                    {new Date(row.startedAt).toLocaleString(i18n.language)}{' '}
                    <Badge>{t(`agent.desktop.states.${row.state}`)}</Badge>
                  </li>
                ))}
            </ul>
          </main>
        )}
        <Dialog
          open={settings}
          onOpenChange={setSettings}
          title={t('agent.desktop.preferences')}
          description={t('agent.desktop.preferencesHelp')}
        >
          <Select
            label={t('agent.desktop.fontSize')}
            value={prefs.size}
            onValueChange={(value) => {
              setPrefs((previous) => ({ ...previous, size: Preferences.shape.size.parse(value) }));
            }}
            options={['small', 'medium', 'large'].map((value) => ({
              value,
              label: t(`agent.desktop.sizes.${value}`),
            }))}
          />
          <Select
            label={t('agent.desktop.density')}
            value={prefs.density}
            onValueChange={(value) => {
              setPrefs((previous) => ({
                ...previous,
                density: Preferences.shape.density.parse(value),
              }));
            }}
            options={['comfortable', 'compact'].map((value) => ({
              value,
              label: t(`agent.desktop.densities.${value}`),
            }))}
          />
          <Select
            label={t('common.theme.label')}
            value={theme}
            onValueChange={(value) => {
              setTheme(value as Theme);
            }}
            options={THEMES.map((value) => ({ value, label: t(`common.theme.${value}`) }))}
          />
          <Select
            label={t('common.locale.label')}
            value={i18n.language.startsWith('en') ? 'en' : 'tr'}
            onValueChange={(value) => void i18n.changeLanguage(value)}
            options={['tr', 'en'].map((value) => ({ value, label: t(`common.locale.${value}`) }))}
          />
        </Dialog>
      </div>
    </UiProvider>
  );
}
function SignIn() {
  const { t } = useTranslation();
  const [tenant, setTenant] = useState(''),
    [providers, setProviders] = useState<{ id: string; displayName: string }[]>([]),
    [error, setError] = useState(false),
    [discovering, setDiscovering] = useState(false);
  const discovery = useRef(0);
  useEffect(
    () => () => {
      discovery.current += 1;
    },
    [],
  );
  return (
    <AccessLayout appName={t('agent.hello.appName')}>
      <div className="vb-stack">
        <h2>{t('agent.desktop.signIn')}</h2>
        <p>{t('agent.launch.signedOut')}</p>
        <Input
          label={t('agent.desktop.tenant')}
          value={tenant}
          onChange={(event) => {
            discovery.current += 1;
            setTenant(event.target.value);
            setProviders([]);
            setError(false);
            setDiscovering(false);
          }}
        />
        <Button
          loading={discovering}
          disabled={!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenant)}
          onClick={() => {
            const attempt = ++discovery.current;
            setDiscovering(true);
            setProviders([]);
            setError(false);
            void api(
              '/auth/discover',
              z.object({
                providers: z.array(z.object({ id: z.string(), displayName: z.string() })),
              }),
              undefined,
              { tenant },
            )
              .then((result) => {
                if (attempt !== discovery.current) return;
                setProviders(result.providers);
                setError(false);
              })
              .catch(() => {
                if (attempt !== discovery.current) return;
                setError(true);
              })
              .finally(() => {
                if (attempt === discovery.current) setDiscovering(false);
              });
          }}
        >
          {t('agent.desktop.continue')}
        </Button>
        {providers.map((provider) => (
          <a
            className="ag-sso-link"
            key={provider.id}
            href={`/api/auth/login?${new URLSearchParams({ tenant, idp: provider.id, app: 'agent', returnTo: '/' }).toString()}`}
          >
            {provider.displayName}
          </a>
        ))}
        {error && <Alert tone="danger" title={t('agent.desktop.failed')} />}
      </div>
    </AccessLayout>
  );
}
function Supervisor({ identity, csrf }: { identity: string; csrf: string }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [watch, setWatch] = useState('');
  const list = useQuery({
    queryKey: ['agent', identity, 'supervisor'],
    queryFn: () => api('/v1/supervisor/sessions?limit=50&sort=-startedAt', Sessions),
    refetchInterval: () =>
      watch &&
      ['completed', 'abandoned', 'expired'].includes(
        client.getQueryData<View>(['agent', identity, 'supervisor', watch])?.state ?? '',
      )
        ? false
        : 30000,
  });
  const state = useQuery({
    queryKey: ['agent', identity, 'supervisor', watch],
    queryFn: () => api(`/v1/supervisor/sessions/${watch}/state`, View),
    enabled: !!watch,
    refetchInterval: (query) =>
      ['completed', 'abandoned', 'expired'].includes(query.state.data?.state ?? '') || connected
        ? false
        : 10000,
  });
  useEffect(() => {
    if (!watch) return;
    let closed = false;
    const socket = io('/runtime', {
      transports: ['websocket'],
      auth: (callback) => {
        void api(
          `/v1/supervisor/sessions/${watch}/socket-ticket`,
          z.object({ ticket: z.string() }),
          csrf,
          { afterSequence: 0 },
        )
          .then(({ ticket }) => {
            if (!closed) callback({ ticket });
          })
          .catch(() => {
            if (!closed) callback({});
          });
      },
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
    socket.on('connect', () => {
      setConnected(true);
    });
    socket.on('disconnect', () => {
      setConnected(false);
    });
    socket.on('connect_error', () => {
      setConnected(false);
    });
    socket.on('runtime.resume', (input: unknown) => {
      const parsed = z.object({ snapshot: View }).safeParse(input);
      if (parsed.success)
        client.setQueryData(['agent', identity, 'supervisor', watch], parsed.data.snapshot);
    });
    socket.on('runtime.event', () => {
      void client.invalidateQueries(
        {
          queryKey: ['agent', identity, 'supervisor', watch],
          exact: true,
        },
        { cancelRefetch: false },
      );
      void client.invalidateQueries({ queryKey: ['agent', identity, 'supervisor'], exact: true });
    });
    socket.on('runtime.error', () => {
      setConnected(false);
      socket.disconnect();
    });
    return () => {
      closed = true;
      setConnected(false);
      socket.disconnect();
    };
  }, [watch, identity, csrf, client]);
  return (
    <main className="ag-supervisor">
      <h1>{t('agent.desktop.supervisor')}</h1>
      <p>{t('agent.desktop.supervisorReadOnly')}</p>
      {list.isError && <Alert tone="danger" title={t('agent.desktop.failed')} />}
      {list.isSuccess && list.data.data.length === 0 && (
        <p role="status">{t('agent.desktop.noMonitorSessions')}</p>
      )}
      <Select
        label={t('agent.desktop.interaction')}
        disabled={!list.data?.data.length}
        value={watch}
        onValueChange={setWatch}
        options={(list.data?.data ?? []).map((row) => ({
          value: row.id,
          label: `${row.id.slice(0, 8)} · ${t(`agent.desktop.states.${row.state}`)}`,
        }))}
      />
      {state.data && (
        <>
          <Badge>{t(`agent.desktop.states.${state.data.state}`)}</Badge>
          <dl>
            {Object.entries(state.data.snapshot.variables).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {state.isError && <Alert tone="danger" title={t('agent.desktop.failed')} />}
    </main>
  );
}
