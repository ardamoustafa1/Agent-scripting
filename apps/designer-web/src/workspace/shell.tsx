import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Layers3,
  Megaphone,
  Workflow,
  PanelsTopLeft,
  Plug,
  Braces,
  LayoutTemplate,
  Rocket,
  Settings2,
  Search,
  Bell,
  ChevronDown,
  ArrowUpRight,
  HelpCircle,
  Globe2,
  Building2,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { useAbility } from '@verbis/authz/react';
import {
  Avatar,
  Badge,
  Button,
  CommandPalette,
  Dialog,
  DropdownMenu,
  IconButton,
  Kbd,
  Popover,
  Select,
  Tooltip,
  THEMES,
  type Theme,
} from '@verbis/ui';

import { request, type Session } from '../api/client.js';
import { Notifications } from '../lifecycle/notifications.js';

import {
  CommandRegistryProvider,
  readRecentCommands,
  useCommandRegistry,
  writeRecentCommand,
} from './commands.js';
import { WorkspaceContext } from './context.js';
import { CreateDialog } from './create-dialog.js';
import { deployment, switchEnvironment } from './deployment.js';
import { navigation } from './navigation.js';
import { Loading, Forbidden, Failure, PageBoundary } from './states.js';
import { WelcomeTour } from './welcome-tour.js';

const AiStudio = lazy(() => import('../pages/ai.js'));
const Analytics = lazy(() => import('../pages/analytics.js'));
const Release = lazy(() => import('../lifecycle/release.js'));
const Replay = lazy(() => import('../lifecycle/replay.js'));
const Assignments = lazy(() => import('../lifecycle/assignments.js'));
const Packages = lazy(() => import('../lifecycle/packages.js'));
const Templates = lazy(() => import('../lifecycle/templates.js'));
const IntegrationList = lazy(() => import('../integrations/list.js'));
const IntegrationEditor = lazy(() => import('../integrations/editor.js'));
const Library = lazy(() => import('../pages/library.js'));
const Campaign = lazy(() => import('../pages/campaign.js'));
const Editor = lazy(() => import('../editor/editor.js'));
const Script = lazy(() => import('../pages/script.js'));
const Settings = lazy(() => import('../pages/settings.js'));
const icons = {
  Activity,
  Megaphone,
  Workflow,
  PanelsTopLeft,
  Plug,
  Braces,
  LayoutTemplate,
  Rocket,
  Settings2,
};
function readTour(key: string) {
  try {
    return localStorage.getItem(key) !== 'done';
  } catch {
    return true;
  }
}
export default function Shell({
  session,
  theme,
  setTheme,
}: {
  session: Session;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}) {
  const { t, i18n } = useTranslation();
  const ability = useAbility();
  const query = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [command, setCommand] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const registry = useCommandRegistry();
  const recentKey = `verbis.commands.recent.${session.user.tenantId}.${session.user.id}`;
  const [recent, setRecent] = useState(() => readRecentCommands(recentKey));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('verbis.sidebar.collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [create, setCreate] = useState<'campaigns' | 'scripts' | null>(null);
  const [tenantSwitch, setTenantSwitch] = useState(false);
  const [tour, setTour] = useState(() =>
    readTour(`verbis.tour.${session.user.tenantId}.${session.user.id}`),
  );
  const [tourStep, setTourStep] = useState(0);
  const [logoutError, setLogoutError] = useState(false);
  const environment: 'dev' | 'test' | 'prod' = deployment.environment;
  const destinations = navigation.filter((item) =>
    item.id === 'ai' ? ability.can('create', 'Script') : ability.can('read', item.subject),
  );
  const current = navigation.find((item) => location.pathname.startsWith(`/${item.id}`));
  const first = destinations[0]?.id;
  useEffect(() => {
    document.getElementById('workspace-content')?.focus({ preventScroll: true });
  }, [location.pathname]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommand((open) => !open);
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, []);
  const finishTour = () => {
    try {
      localStorage.setItem(`verbis.tour.${session.user.tenantId}.${session.user.id}`, 'done');
    } catch {
      /* Optional preference. */
    }
    setTour(false);
  };
  const logout = () => {
    void request('/auth/logout', z.object({ redirectUrl: z.string() }), {
      method: 'POST',
      body: {},
      csrf: session.csrfToken,
    })
      .then((result) => {
        query.clear();
        const destination = new URL(result.redirectUrl, locationOrigin());
        if (
          ['https:', 'http:'].includes(destination.protocol) &&
          !destination.username &&
          !destination.password
        )
          window.location.assign(destination.href);
        else window.location.assign('/');
      })
      .catch(() => {
        setLogoutError(true);
      });
  };
  const commands = [
    ...destinations.map((item) => ({
      id: item.id,
      label: t(`designer.workspace.nav.${item.id}`),
      group: t('designer.workspace.navigate'),
      onSelect: () => navigate(`/${item.id}`),
    })),
    ...(['campaigns', 'scripts'] as const)
      .filter((kind) => ability.can('create', kind === 'campaigns' ? 'Campaign' : 'Script'))
      .map((kind) => ({
        id: `new-${kind}`,
        label: t(`designer.workspace.new.${kind}`),
        group: t('designer.workspace.actions'),
        onSelect: () => {
          setCreate(kind);
        },
      })),
    {
      id: 'refresh',
      label: t('designer.workspace.refresh'),
      onSelect: () => {
        void query.invalidateQueries({ queryKey: ['workspace'] });
      },
    },
    {
      id: 'theme',
      label: t('designer.workspace.toggleTheme'),
      onSelect: () => {
        setTheme(theme === 'dark' ? 'light' : 'dark');
      },
    },
    {
      id: 'tour',
      label: t('designer.workspace.tourTitle'),
      onSelect: () => {
        setTourStep(0);
        setTour(true);
      },
    },
    { id: 'logout', label: t('designer.workspace.logout'), onSelect: logout },
  ];
  return (
    <WorkspaceContext.Provider value={{ session, environment }}>
      <CommandRegistryProvider registry={registry}>
        <div
          className="dw-workspace"
          data-sidebar-collapsed={sidebarCollapsed}
          data-editor-route={/^\/scripts\/[^/]+\/versions\/[^/]+\/edit\/?$/.test(location.pathname)}
        >
          <a className="vb-skip-link" href="#workspace-content" tabIndex={0}>
            {t('common.skipToContent')}
          </a>
          <aside
            className="dw-rail vb-brand-surface"
            aria-label={t('designer.workspace.navigation')}
          >
            <div className="dw-rail-heading">
              <NavLink
                to={`/${first ?? 'settings'}`}
                className="dw-logo"
                aria-label={t('common.productName')}
              >
                <Layers3 size={25} aria-hidden />
                <span>{t('common.productName')}</span>
              </NavLink>
              <Tooltip
                content={t(
                  sidebarCollapsed
                    ? 'designer.workspace.expandSidebar'
                    : 'designer.workspace.collapseSidebar',
                )}
              >
                <IconButton
                  className="dw-rail-toggle"
                  label={t(
                    sidebarCollapsed
                      ? 'designer.workspace.expandSidebar'
                      : 'designer.workspace.collapseSidebar',
                  )}
                  aria-expanded={!sidebarCollapsed}
                  aria-controls="workspace-navigation"
                  onClick={() => {
                    const collapsed = !sidebarCollapsed;
                    setSidebarCollapsed(collapsed);
                    try {
                      localStorage.setItem('verbis.sidebar.collapsed', String(collapsed));
                    } catch {
                      /* The layout still works when optional storage is unavailable. */
                    }
                  }}
                >
                  {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
                </IconButton>
              </Tooltip>
            </div>
            <nav id="workspace-navigation" aria-label={t('designer.workspace.navigation')}>
              {destinations.map((item) => {
                const Icon = icons[item.icon];
                return (
                  <Tooltip key={item.id} content={t(`designer.workspace.nav.${item.id}`)}>
                    <NavLink
                      to={`/${item.id}`}
                      className="dw-nav"
                      aria-label={t(`designer.workspace.nav.${item.id}`)}
                    >
                      <Icon size={20} aria-hidden />
                      <span>{t(`designer.workspace.nav.${item.id}`)}</span>
                    </NavLink>
                  </Tooltip>
                );
              })}
            </nav>
            <div className="dw-rail-footer">
              <DropdownMenu
                label={t('designer.workspace.sidebarUserMenu')}
                trigger={
                  <Button
                    variant="ghost"
                    className="dw-rail-profile"
                    aria-label={t('designer.workspace.sidebarUserMenu')}
                  >
                    <Avatar name={t('designer.workspace.you')} size="sm" />
                    <span>{t('designer.workspace.you')}</span>
                    <ChevronDown size={14} aria-hidden />
                  </Button>
                }
                items={[{ id: 'logout', label: t('designer.workspace.logout'), onSelect: logout }]}
              />
              <Tooltip content={t('designer.workspace.tourTitle')}>
                <IconButton
                  label={t('designer.workspace.help')}
                  onClick={() => {
                    setTourStep(0);
                    setTour(true);
                  }}
                >
                  <HelpCircle size={20} />
                </IconButton>
              </Tooltip>
            </div>
          </aside>
          <div className="dw-body">
            <header className="dw-topbar">
              <div className="dw-context">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setTenantSwitch(true);
                  }}
                  endIcon={<ChevronDown size={14} aria-hidden />}
                >
                  <span className="dw-tenant-mark" aria-hidden>
                    <Building2 size={16} />
                  </span>
                  <span>{t('designer.workspace.tenant')}</span>
                </Button>
                <span className="dw-separator" aria-hidden>
                  /
                </span>
                <div className="dw-environment" data-environment={environment}>
                  <span className="dw-environment-dot" aria-hidden />
                  <Select
                    label={t('designer.workspace.environment')}
                    value={environment}
                    options={(['dev', 'test', 'prod'] as const).map((value) => ({
                      value,
                      label: t(`designer.workspace.env.${value}`),
                      disabled: value !== environment && !deployment.urls[value],
                    }))}
                    onValueChange={(value) => {
                      if (value === 'dev' || value === 'test' || value === 'prod')
                        switchEnvironment(value);
                    }}
                  />
                </div>
              </div>
              <Button
                variant="ghost"
                className="dw-global-search"
                startIcon={<Search size={16} aria-hidden />}
                onClick={() => {
                  setCommand(true);
                }}
              >
                {t('designer.workspace.search')}
                <Kbd>{t('designer.workspace.commandShortcut')}</Kbd>
              </Button>
              <div className="dw-top-actions">
                <div className="dw-locale">
                  <Globe2 size={16} aria-hidden />
                  <Select
                    label={t('common.locale.label')}
                    value={i18n.language.startsWith('en') ? 'en' : 'tr'}
                    options={['tr', 'en'].map((value) => ({
                      value,
                      label: t(`common.locale.${value}`),
                    }))}
                    onValueChange={(value) => {
                      void i18n.changeLanguage(value);
                    }}
                  />
                </div>
                <DropdownMenu
                  label={t('common.theme.label')}
                  trigger={
                    <IconButton label={t('common.theme.label')}>
                      <Settings2 size={18} />
                    </IconButton>
                  }
                  items={THEMES.map((value) => ({
                    id: value,
                    label: t(`common.theme.${value}`),
                    onSelect: () => {
                      setTheme(value);
                    },
                  }))}
                />
                <Popover
                  label={t('designer.workspace.notifications')}
                  trigger={
                    <IconButton label={t('designer.workspace.notifications')}>
                      <Bell size={18} />
                    </IconButton>
                  }
                >
                  <h3>{t('designer.workspace.notifications')}</h3>
                  <Notifications />
                  <Button
                    variant="ghost"
                    onClick={() => {
                      void navigate('/releases');
                    }}
                  >
                    {t('designer.workspace.viewApprovals')}
                    <ArrowUpRight size={14} aria-hidden />
                  </Button>
                </Popover>
                <DropdownMenu
                  label={t('designer.workspace.userMenu')}
                  trigger={
                    <Button variant="ghost" aria-label={t('designer.workspace.userMenu')}>
                      <Avatar name={t('designer.workspace.you')} size="sm" />
                      <ChevronDown size={14} aria-hidden />
                    </Button>
                  }
                  items={[
                    {
                      id: 'help',
                      label: t('designer.workspace.tourTitle'),
                      onSelect: () => {
                        setTourStep(0);
                        setTour(true);
                      },
                    },
                    { id: 'logout', label: t('designer.workspace.logout'), onSelect: logout },
                  ]}
                />
              </div>
            </header>
            <nav className="dw-breadcrumb" aria-label={t('ui.breadcrumb')}>
              <span>{t('designer.workspace.workspace')}</span>
              <span aria-hidden>/</span>
              <strong>{t(`designer.workspace.nav.${current?.id ?? 'campaigns'}`)}</strong>
              <Badge tone={environment === 'prod' ? 'success' : 'info'}>
                {t(`designer.workspace.env.${environment}`)}
              </Badge>
            </nav>
            <main id="workspace-content" tabIndex={-1} className="dw-content">
              <PageBoundary
                key={location.pathname}
                fallback={
                  <Failure
                    retry={() => {
                      window.location.reload();
                    }}
                  />
                }
              >
                <Suspense fallback={<Loading />}>
                  <Routes>
                    <Route
                      path="/"
                      element={first ? <Navigate to={`/${first}`} replace /> : <Forbidden />}
                    />
                    {destinations
                      .filter(
                        (item) =>
                          !['settings', 'integrations', 'templates', 'analytics', 'ai'].includes(
                            item.id,
                          ),
                      )
                      .map((item) => (
                        <Route
                          key={item.id}
                          path={`/${item.id}`}
                          element={
                            <Library
                              kind={item.id as Exclude<typeof item.id, 'analytics' | 'ai'>}
                              onCreate={(kind) => {
                                setCreate(kind);
                              }}
                            />
                          }
                        />
                      ))}
                    <Route
                      path="/ai"
                      element={ability.can('create', 'Script') ? <AiStudio /> : <Forbidden />}
                    />
                    <Route
                      path="/analytics"
                      element={ability.can('read', 'Report') ? <Analytics /> : <Forbidden />}
                    />
                    <Route
                      path="/templates"
                      element={ability.can('read', 'Script') ? <Templates /> : <Forbidden />}
                    />
                    <Route
                      path="/scripts/:id/versions/:number/release"
                      element={ability.can('read', 'Script') ? <Release /> : <Forbidden />}
                    />
                    <Route
                      path="/scripts/:id/versions/:number/replay"
                      element={
                        ability.can('read', 'Script') && ability.can('read', 'Session') ? (
                          <Replay />
                        ) : (
                          <Forbidden />
                        )
                      }
                    />
                    <Route
                      path="/scripts/:id/assignments"
                      element={
                        ability.can('read', 'Script') && ability.can('read', 'Campaign') ? (
                          <Assignments />
                        ) : (
                          <Forbidden />
                        )
                      }
                    />
                    <Route
                      path="/scripts/:id/packages"
                      element={ability.can('read', 'Script') ? <Packages /> : <Forbidden />}
                    />
                    <Route
                      path="/integrations"
                      element={
                        ability.can('read', 'Integration') ? <IntegrationList /> : <Forbidden />
                      }
                    />
                    <Route
                      path="/integrations/:id"
                      element={
                        ability.can('read', 'Integration') ? <IntegrationEditor /> : <Forbidden />
                      }
                    />
                    <Route
                      path="/campaigns/:id"
                      element={ability.can('read', 'Campaign') ? <Campaign /> : <Forbidden />}
                    />
                    <Route
                      path="/scripts/:id/versions/:number/edit"
                      element={ability.can('update', 'Script') ? <Editor /> : <Forbidden />}
                    />
                    <Route
                      path="/scripts/:id/*"
                      element={ability.can('read', 'Script') ? <Script /> : <Forbidden />}
                    />
                    <Route
                      path="/settings"
                      element={ability.can('read', 'Tenant') ? <Settings /> : <Forbidden />}
                    />
                    <Route path="*" element={<Forbidden />} />
                  </Routes>
                </Suspense>
              </PageBoundary>
            </main>
            <footer className="dw-footer">
              <span className="dw-live-dot" aria-hidden />
              <span>{t('designer.workspace.connected')}</span>
              <span>{t('designer.workspace.footerHint')}</span>
            </footer>
          </div>
          <CommandPalette
            enableShortcut={false}
            open={command}
            onOpenChange={setCommand}
            onQueryChange={setCommandQuery}
            recent={recent}
            onItemRun={(id) => {
              setRecent(writeRecentCommand(recentKey, id));
            }}
            items={
              command
                ? [...registry.sources().flatMap((source) => source(commandQuery)), ...commands]
                : commands
            }
          />
          {create && (
            <CreateDialog
              key={create}
              kind={create}
              open
              onOpenChange={(open) => {
                if (!open) setCreate(null);
              }}
            />
          )}
          <Dialog
            open={tenantSwitch}
            onOpenChange={setTenantSwitch}
            title={t('designer.workspace.switchTenant')}
            description={t('designer.workspace.switchTenantDetail')}
          >
            <Button onClick={logout}>{t('designer.workspace.logout')}</Button>
          </Dialog>
          <WelcomeTour
            open={tour}
            step={tourStep}
            onStepChange={setTourStep}
            onClose={finishTour}
          />
          {logoutError && (
            <Dialog
              open
              onOpenChange={() => {
                setLogoutError(false);
              }}
              title={t('designer.workspace.error')}
              description={t('designer.workspace.errorDetail')}
            >
              <Button onClick={logout}>{t('designer.workspace.retry')}</Button>
            </Dialog>
          )}
        </div>
      </CommandRegistryProvider>
    </WorkspaceContext.Provider>
  );
}
function locationOrigin() {
  return window.location.origin;
}
