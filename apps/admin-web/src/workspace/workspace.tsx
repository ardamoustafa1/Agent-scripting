import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  ShieldCheck,
  Users,
  Plug,
  KeyRound,
  ScrollText,
  LockKeyhole,
  Database,
  Palette,
  PhoneCall,
  Activity,
  LogOut,
  PanelLeft,
  Layers3,
} from 'lucide-react';
import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { abilityFromSerialized, MePermissionsSchema } from '@verbis/authz';
import { AccessLayout, Button, UiProvider, THEMES, useTheme, type Theme } from '@verbis/ui';

import { fetchSession, logout, type AuthSession } from '../auth/auth-api.js';
import { AuthSection } from '../auth/auth-section.js';

import { allowed as canAccess, AccessContext } from './access.js';
import { AdminContext, RecordSchema, request, record, text } from './api.js';
import { Feedback, useLabels } from './widgets.js';
import './workspace.css';

const AiSettings = lazy(() => import('./ai-page.js'));
const Analytics = lazy(() => import('./analytics-page.js'));
const Tenants = lazy(() =>
  import('./tenant-pages.js').then((module) => ({ default: module.Tenants })),
);
const Security = lazy(() =>
  import('./tenant-pages.js').then((module) => ({ default: module.Security })),
);
const Branding = lazy(() =>
  import('./tenant-pages.js').then((module) => ({ default: module.Branding })),
);
const DataManagement = lazy(() =>
  import('./tenant-pages.js').then((module) => ({ default: module.DataManagement })),
);
const Identity = lazy(() =>
  import('./identity-pages.js').then((module) => ({ default: module.Identity })),
);
const UsersPage = lazy(() =>
  import('./identity-pages.js').then((module) => ({ default: module.Users })),
);
const Connectors = lazy(() =>
  import('./operations-pages.js').then((module) => ({ default: module.Connectors })),
);
const Secrets = lazy(() =>
  import('./operations-pages.js').then((module) => ({ default: module.Secrets })),
);
const Audit = lazy(() =>
  import('./operations-pages.js').then((module) => ({ default: module.Audit })),
);
const Simulator = lazy(() =>
  import('./operations-pages.js').then((module) => ({ default: module.Simulator })),
);
const Health = lazy(() =>
  import('./operations-pages.js').then((module) => ({ default: module.Health })),
);
const pages = [
  { id: 'analytics', subject: 'Report', action: 'read', icon: Activity, view: Analytics },
  { id: 'tenants', subject: 'Tenant', action: 'manage', icon: Building2, view: Tenants },
  {
    id: 'identity',
    subject: 'IdentityProvider',
    action: 'manage',
    icon: ShieldCheck,
    view: Identity,
  },
  { id: 'users', subject: 'User', action: 'read', icon: Users, view: UsersPage },
  { id: 'connectors', subject: 'Connector', action: 'manage', icon: Plug, view: Connectors },
  { id: 'secrets', subject: 'Secret', action: 'manage', icon: KeyRound, view: Secrets },
  { id: 'ai', subject: 'Tenant', action: 'manage', icon: Activity, view: AiSettings },
  { id: 'audit', subject: 'Audit', action: 'read', icon: ScrollText, view: Audit },
  { id: 'security', subject: 'Tenant', action: 'manage', icon: LockKeyhole, view: Security },
  { id: 'data', subject: 'Tenant', action: 'manage', icon: Database, view: DataManagement },
  { id: 'branding', subject: 'Tenant', action: 'manage', icon: Palette, view: Branding },
  { id: 'simulator', subject: 'Connector', action: 'manage', icon: PhoneCall, view: Simulator },
  { id: 'systemHealth', subject: 'Connector', action: 'read', icon: Activity, view: Health },
] as const;
export class WorkspaceBoundary extends Component<
  { children: ReactNode; message: string },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? <p role="alert">{this.props.message}</p> : this.props.children;
  }
}
export function AdminWorkspace() {
  const l = useLabels(),
    session = useQuery({ queryKey: ['auth-session'], queryFn: fetchSession, retry: false });
  if (session.isPending)
    return (
      <AccessLayout appName={l('title')}>
        <p role="status">{l('loading')}</p>
      </AccessLayout>
    );
  if (session.isError)
    return (
      <AccessLayout appName={l('title')}>
        <Feedback error={session.error} />
        <Button onClick={() => void session.refetch()}>{l('retry')}</Button>
      </AccessLayout>
    );
  if (!session.data)
    return (
      <AccessLayout appName={l('title')}>
        <AuthSection title={l('title')} />
      </AccessLayout>
    );
  return (
    <AdminContext.Provider value={session.data}>
      <Authenticated session={session.data} />
    </AdminContext.Provider>
  );
}
function Authenticated({ session }: { session: AuthSession }) {
  const l = useLabels(),
    { i18n } = useTranslation(),
    [theme, setTheme] = useTheme(),
    client = useQueryClient(),
    [filter, setFilter] = useState(''),
    [compact, setCompact] = useState(false),
    [error, setError] = useState<unknown>(),
    [route, setRoute] = useState(() => location.hash.slice(1));
  const scope = ['admin', session.user.tenantId, session.user.id];
  const grants = useQuery({
    queryKey: [...scope, 'permissions'],
    queryFn: ({ signal }) => request('/v1/me/permissions', MePermissionsSchema, { signal }),
    retry: false,
  });
  const tenant = useQuery({
    queryKey: [...scope, 'tenant'],
    queryFn: ({ signal }) => request('/v1/tenant', RecordSchema, { signal }),
    retry: false,
  });
  useEffect(() => {
    const changed = () => {
      setRoute(location.hash.slice(1));
    };
    window.addEventListener('hashchange', changed);
    return () => {
      window.removeEventListener('hashchange', changed);
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = i18n.language;
    document.title = `Verbis · ${l('title')}`;
  }, [i18n.language, l]);
  const ability = grants.data
      ? abilityFromSerialized(
          grants.data.rules as unknown as Parameters<typeof abilityFromSerialized>[0],
        )
      : null,
    allowed = pages.filter(
      (page) =>
        (page.id !== 'tenants' ||
          (session.user.authMethod === 'sso' && grants.data?.roles.includes('super_admin'))) &&
        canAccess(ability, page.action, page.subject),
    );
  const active = allowed.find((page) => page.id === route) ?? allowed[0],
    View = active?.view;
  const settings = record(tenant.data?.['settings']),
    brand = record(settings['brand']);
  return (
    <AccessContext.Provider value={ability}>
      <UiProvider
        i18n={i18n}
        theme={theme}
        {...(text(brand, 'primaryColor')
          ? { brand: { name: text(brand, 'name'), primaryColor: text(brand, 'primaryColor') } }
          : {})}
      >
        <a className="aw-skip" href="#admin-main" tabIndex={0}>
          {l('skip')}
        </a>
        <div className="aw-layout" data-compact={compact}>
          <aside className="aw-rail vb-brand-surface">
            <a className="aw-wordmark" href="#systemHealth">
              <Layers3 className="aw-mark" size={28} aria-hidden />
              <span>
                {l('productName')} <small>{l('title')}</small>
              </span>
            </a>
            <p className="aw-caption">{l('workspace')}</p>
            <nav aria-label={l('navigation')}>
              {allowed
                .filter((page) =>
                  l(page.id)
                    .toLocaleLowerCase(i18n.language)
                    .includes(filter.toLocaleLowerCase(i18n.language)),
                )
                .map((page) => (
                  <a
                    key={page.id}
                    href={`#${page.id}`}
                    aria-label={l(page.id)}
                    aria-current={active?.id === page.id ? 'page' : undefined}
                  >
                    <page.icon size={18} aria-hidden />
                    <span>{l(page.id)}</span>
                  </a>
                ))}
            </nav>
            <div className="aw-rail-footer">
              <ShieldCheck size={16} aria-hidden />
              <span>
                {session.user.authMethod === 'sso' ? l('ssoSession') : l('emergencySession')}
              </span>
            </div>
          </aside>
          <div className="aw-body">
            <header className="aw-topbar">
              <Button
                variant="ghost"
                aria-label={l('navigation')}
                aria-expanded={!compact}
                onClick={() => {
                  setCompact(!compact);
                }}
              >
                <PanelLeft size={18} />
              </Button>
              <span className="aw-tenant">{text(tenant.data ?? {}, 'name') || l('workspace')}</span>
              <label className="aw-search">
                <span className="vb-sr-only">{l('search')}</span>
                <input
                  type="search"
                  placeholder={l('search')}
                  value={filter}
                  onChange={(event) => {
                    setFilter(event.target.value);
                  }}
                />
              </label>
              <label>
                <span className="vb-sr-only">{l('theme')}</span>
                <select
                  value={theme}
                  onChange={(event) => {
                    setTheme(event.target.value as Theme);
                  }}
                >
                  {THEMES.map((value) => (
                    <option key={value} value={value}>
                      {l(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="vb-sr-only">{l('language')}</span>
                <select
                  value={i18n.language.startsWith('en') ? 'en' : 'tr'}
                  onChange={(event) => void i18n.changeLanguage(event.target.value)}
                >
                  <option value="tr">{l('tr')}</option>
                  <option value="en">{l('en')}</option>
                </select>
              </label>
              <Button
                variant="ghost"
                aria-label={l('logout')}
                onClick={() =>
                  void logout(session.csrfToken)
                    .then((url) => {
                      client.clear();
                      window.location.assign(url);
                    })
                    .catch(setError)
                }
              >
                <LogOut size={18} />
              </Button>
            </header>
            <main id="admin-main" tabIndex={-1} className="aw-main">
              <div className="aw-heading">
                <span className="aw-caption">{l('controlCenter')}</span>
                <h1>{active ? l(active.id) : l('title')}</h1>
                <p>{l('intro')}</p>
              </div>
              <Feedback error={error ?? grants.error ?? tenant.error} />
              {grants.isPending ? (
                <p role="status">{l('loading')}</p>
              ) : View ? (
                <WorkspaceBoundary key={active.id} message={l('failed')}>
                  <Suspense fallback={<p role="status">{l('loading')}</p>}>
                    <View />
                  </Suspense>
                </WorkspaceBoundary>
              ) : (
                <p>{l('denied')}</p>
              )}
            </main>
          </div>
        </div>
      </UiProvider>
    </AccessContext.Provider>
  );
}
