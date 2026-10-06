import { useQueryClient } from '@tanstack/react-query';
import {
  Phone,
  MessageSquare,
  Mail,
  ChevronLeft,
  ChevronRight,
  PanelRight,
  CheckCircle2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { ComponentProvider, type ComponentEnvironment } from '@verbis/components';
import { ScriptRenderer, useRuntimePaths } from '@verbis/core-runtime';
import {
  Alert,
  Checkbox,
  Badge,
  Button,
  Input,
  Textarea,
  Select,
  MultiSelect,
  Progress,
  Tabs,
  Kbd,
  Skeleton,
} from '@verbis/ui';

import { agentScreenReady, agentLaunchFailed } from '../observability.js';

import { AgentAiPanel } from './ai-panel.js';
import { api, Desktop } from './api.js';
import { AgentController } from './controller.js';
import { FailureNotice } from './failure-notice.js';
import { classifyAgentFailure, type AgentFailure } from './failure.js';
import { type DraftVault } from './vault.js';

export function SessionView({
  id,
  csrf,
  vault,
  active,
  onStatus,
  onIdentity,
}: {
  id: string;
  csrf: string;
  vault: DraftVault;
  active: boolean;
  onStatus: (id: string, state: string, unseen: boolean) => void;
  onIdentity?: ((id: string, desktop: Desktop) => void) | undefined;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [controller, setController] = useState<AgentController | null>(null),
    [error, setError] = useState<AgentFailure | null>(null),
    [attempt, setAttempt] = useState(0),
    [hasActivated, setHasActivated] = useState(active);
  if (active && !hasActivated) setHasActivated(true);
  const locale = useRef(i18n.language);
  useEffect(() => {
    locale.current = i18n.language;
  }, [i18n.language]);
  useEffect(() => {
    if (!hasActivated) return;
    let cancelled = false,
      instance: AgentController | undefined;
    const isCancelled = () => cancelled;
    void client
      .query({
        queryKey: ['agent', 'desktop', vault.partition, id],
        queryFn: ({ signal }) =>
          api(`/v1/sessions/${id}/desktop`, Desktop, undefined, undefined, signal),
        staleTime: 10000,
        gcTime: 60000,
      })
      .then(async (desktop) => {
        if (cancelled) return;
        onIdentity?.(id, desktop);
        instance = new AgentController(id, desktop, csrf, vault, locale.current);
        setController(instance);
        await instance.initialize();
        if (!isCancelled()) agentScreenReady(id);
      })
      .catch((cause: unknown) => {
        instance?.dispose();
        if (!cancelled) {
          agentLaunchFailed(id);
          const failure = classifyAgentFailure(cause);
          setError(failure);
          void api(
            `/v1/sessions/${id}/desktop/failure`,
            z.object({ recorded: z.boolean() }),
            csrf,
            failure,
          ).catch(() => undefined);
        }
      });
    return () => {
      cancelled = true;
      instance?.dispose();
    };
  }, [id, csrf, vault, client, attempt, hasActivated, onIdentity]);
  useEffect(() => {
    controller?.runtime.store.setLocale(i18n.language);
  }, [controller, i18n.language]);
  if (error)
    return (
      <section
        className="ag-session-failure"
        id={`script-${id}`}
        tabIndex={-1}
        hidden={!active}
        {...(!active ? { inert: '' } : {})}
      >
        <h1>{t('agent.desktop.script')}</h1>
        <FailureNotice failure={error}>
          <Button
            onClick={() => {
              void client.invalidateQueries({
                queryKey: ['agent', 'desktop', vault.partition, id],
              });
              setError(null);
              setController(null);
              setAttempt((value) => value + 1);
            }}
          >
            {t('agent.desktop.retry')}
          </Button>
        </FailureNotice>
      </section>
    );
  return controller ? (
    <Interaction
      controller={controller}
      csrf={csrf}
      active={active}
      onStatus={onStatus}
      onIdentity={onIdentity}
    />
  ) : (
    <Skeleton height="24rem" />
  );
}
function Interaction({
  csrf,
  controller: c,
  active,
  onStatus,
  onIdentity,
}: {
  controller: AgentController;
  csrf: string;
  active: boolean;
  onStatus: (id: string, state: string, unseen: boolean) => void;
  onIdentity?: ((id: string, desktop: Desktop) => void) | undefined;
}) {
  const { t } = useTranslation(),
    s = useSyncExternalStore(c.subscribe, c.getSnapshot, c.getSnapshot);
  useRuntimePaths(c.runtime, ['runtime.page', 'runtime.errors', 'vars.*']);
  const componentEnvironment = useMemo<ComponentEnvironment>(
    () => ({
      mediaOrigins: [],
      frameOrigins: [],
      knowledgeOrigins: [],
      features: [],
      now: Date.now,
      ...(c.desktop.secureCapture
        ? {
            secureCapture: {
              ...c.desktop.secureCapture,
              sessionId: c.id,
              confirmReceipt: (variable, receipt, signal) =>
                c.confirmSecureReceipt(variable, receipt, signal),
            },
          }
        : {}),
    }),
    [c],
  );
  const [side, setSide] = useState(false),
    [help, setHelp] = useState(false),
    [failure, setFailure] = useState<AgentFailure | null>(null),
    [subCodes, setSubCodes] = useState<string[]>([]),
    [elapsed, setElapsed] = useState(0);
  const page = c.runtime.store.get('runtime.page'),
    index = c.runtime.document.pages.findIndex((p) => p.id === page),
    outcome = c.desktop.campaign.outcomes.find((o) => o.code === s.disposition);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (work: () => Promise<unknown>) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setFailure(null);
      try {
        await work();
      } catch (error) {
        const failure = c.getSnapshot().dataFailure?.failure ?? classifyAgentFailure(error);
        setFailure(failure);
        void api(
          `/v1/sessions/${c.id}/desktop/failure`,
          z.object({ recorded: z.boolean() }),
          csrf,
          failure,
        ).catch(() => undefined);
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [c, csrf],
  );
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (
        c.getSnapshot().draftSaving ||
        c.getSnapshot().pending > 0 ||
        c.getSnapshot().error === 'storage'
      ) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', prevent);
    return () => {
      window.removeEventListener('beforeunload', prevent);
    };
  }, [c]);
  const next = useCallback(async () => {
    if (
      typeof page === 'string' &&
      (await c.runtime.validation.page(page, c.runtime.signal)).length
    )
      throw Error('VERBIS_VALIDATION_FAILED');
    await c.runtime.next();
    if (c.runtime.store.get('runtime.ended') === true) await c.wrapup();
  }, [c, page]);
  const elapsedText = `${Math.floor(elapsed / 60)
    .toString()
    .padStart(2, '0')}:${(elapsed % 60).toString().padStart(2, '0')}`;
  useEffect(() => {
    onStatus(c.id, s.view.state, !active);
    onIdentity?.(c.id, c.desktop);
  }, [c, s.view.state, s.view.sequence, active, onStatus, onIdentity]);
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - Date.parse(c.desktop.startedAt)) / 1000)));
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [c]);
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === '/') {
        event.preventDefault();
        setHelp((v) => !v);
        return;
      }
      if (s.readOnly || !s.online || s.view.state !== 'active') return;
      const element = event.target;
      if (
        element instanceof HTMLElement &&
        (element.closest('textarea,[contenteditable=true],[role=combobox],[role=dialog]') ||
          element.closest('button,a'))
      )
        return;
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        void run(() => c.runtime.back());
      }
      if (
        event.key === 'Enter' &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.isComposing
      ) {
        event.preventDefault();
        void run(next);
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
    };
  }, [active, c, s.readOnly, s.view.state, s.online, page, next, run]);
  const Channel =
    c.desktop.interaction.channel === 'voice'
      ? Phone
      : c.desktop.interaction.channel === 'email'
        ? Mail
        : MessageSquare;
  const actionFailure = failure ?? s.failure;
  const complete = s.view.state === 'completed',
    wrap = s.view.state === 'wrapup';
  return (
    <section
      className="ag-interaction"
      data-agent-session={c.id}
      aria-label={t('agent.desktop.interaction')}
      hidden={!active}
      {...(!active ? { inert: '' } : {})}
    >
      <header className="ag-contact">
        <div className="ag-channel">
          <Channel size={19} aria-hidden />
        </div>
        <div>
          <h1>{c.desktop.interaction.customerName ?? t('agent.desktop.customer')}</h1>
          <p>
            {[c.desktop.interaction.queue, c.desktop.campaign.name].filter(Boolean).join(' · ')}
          </p>
        </div>
        <span className="ag-duration" aria-label={t('agent.desktop.duration')}>
          {elapsedText}
        </span>
        <Badge tone={s.online ? 'success' : 'warning'}>
          {t(`agent.desktop.states.${s.view.state}`)}
        </Badge>
        <Button
          variant="ghost"
          aria-label={t('agent.desktop.sidebar')}
          onClick={() => {
            setSide((v) => !v);
          }}
        >
          <PanelRight size={18} />
        </Button>
      </header>
      <div className="ag-announcements" aria-live="polite">
        {!s.online && <Alert tone="warning" title={t('agent.desktop.offline')} />}{' '}
        {s.draftSaving && <p role="status">{t('agent.desktop.savingDraft')}</p>}
        {s.pending > 0 && <p role="status">{t('agent.desktop.pending', { count: s.pending })}</p>}
        {s.readOnly && !complete && (
          <Alert tone="info" title={t('agent.desktop.readOnly')}>
            <Button
              disabled={
                busy ||
                !s.online ||
                !['launching', 'active', 'paused', 'wrapup'].includes(s.view.state)
              }
              onClick={() => void run(() => c.takeover())}
            >
              {t('agent.desktop.takeover')}
            </Button>
          </Alert>
        )}{' '}
        {s.view.state === 'paused' && <Alert tone="info" title={t('agent.desktop.held')} />}{' '}
        {c.desktop.interaction.status === 'transferred' && (
          <Alert tone="info" title={t('agent.desktop.transferred')} />
        )}
        {['wrapup', 'abandoned'].includes(s.view.state) && (
          <Alert tone="warning" title={t('agent.desktop.ended')} />
        )}{' '}
        {actionFailure && <FailureNotice failure={actionFailure} />}
        {s.error && !s.failure && (
          <Alert
            tone="danger"
            title={t(
              s.error === 'version'
                ? 'agent.desktop.draftVersion'
                : s.error === 'conflict'
                  ? 'agent.desktop.conflict'
                  : s.error === 'storage'
                    ? 'agent.desktop.storage'
                    : 'agent.desktop.failed',
            )}
          />
        )}{' '}
        {s.error === 'conflict' && (
          <div className="ag-conflict-actions">
            <Button onClick={() => void run(() => c.resolveConflict('server'))}>
              {t('agent.desktop.useServer')}
            </Button>
            <Button variant="secondary" onClick={() => void run(() => c.resolveConflict('local'))}>
              {t('agent.desktop.keepDraft')}
            </Button>
          </div>
        )}
        {s.dataFailure && (
          <Alert tone="warning" title={t('agent.desktop.dataSourceFailed')}>
            <p>
              {t('agent.desktop.supportCode')}: <code>{s.dataFailure.failure.correlationId}</code>
            </p>
            <Button
              disabled={busy || s.readOnly || !s.online}
              onClick={() => void run(() => c.recoverDataSource('retry'))}
            >
              {t('agent.desktop.retry')}
            </Button>
            {s.dataFailure.policy === 'continue' && (
              <Button
                disabled={busy || s.readOnly || !s.online}
                onClick={() => void run(() => c.recoverDataSource('continue'))}
              >
                {t('agent.desktop.continueWithoutData')}
              </Button>
            )}
            {s.dataFailure.policy === 'manual' && (
              <fieldset disabled={busy || s.readOnly || !s.online}>
                <legend>{t('agent.desktop.manualData')}</legend>
                {[
                  ...new Set(
                    Object.values(
                      c.runtime.document.dataSources.find(
                        (source) => source.id === s.dataFailure?.sourceId,
                      )?.outputs ?? {},
                    )
                      .map((output) => output.variable)
                      .filter((key): key is string => Boolean(key)),
                  ),
                ].map((key) => (
                  <WrapField key={key} variable={key} controller={c} />
                ))}
                <Button onClick={() => void run(() => c.recoverDataSource('manual'))}>
                  {t('agent.desktop.confirmManualData')}
                </Button>
              </fieldset>
            )}
          </Alert>
        )}
        {s.notice && (
          <Alert tone="info" title={t('agent.desktop.notice')}>
            <p>{s.notice}</p>
          </Alert>
        )}
      </div>
      <div className="ag-body">
        <div className="ag-script" id={`script-${c.id}`} tabIndex={-1}>
          {complete ? (
            <div className="ag-completed">
              <CheckCircle2 size={36} aria-hidden />
              <h2>{t('agent.desktop.completed')}</h2>
              <Badge tone={s.writeback === 'success' ? 'success' : 'warning'}>
                {t(`agent.desktop.writeback.${s.writeback}`)}
              </Badge>
            </div>
          ) : wrap ? (
            <section className="ag-wrapup">
              <h2>{t('agent.desktop.wrapup')}</h2>
              <Select
                label={t('agent.desktop.disposition')}
                value={s.disposition}
                onValueChange={(value) => {
                  c.preferences({ disposition: value });
                  setSubCodes([]);
                }}
                options={c.desktop.campaign.outcomes.map((o) => ({
                  value: o.code,
                  label:
                    c.runtime.document.i18n.messages[c.runtime.store.locale]?.[o.label] ?? o.label,
                }))}
              />
              {outcome?.subCodes.length ? (
                <MultiSelect
                  label={t('agent.desktop.subCodes')}
                  value={subCodes}
                  onValueChange={setSubCodes}
                  options={outcome.subCodes.map((value) => ({ value, label: value }))}
                />
              ) : null}
              <Textarea
                label={t('agent.desktop.notes')}
                required={outcome?.requiresNote}
                maxLength={4000}
                value={s.note}
                onChange={(e) => {
                  c.preferences({ note: e.target.value });
                }}
              />
              {outcome?.requiredFields.map((key) => (
                <WrapField key={key} variable={key} controller={c} />
              ))}
              <Input
                type="datetime-local"
                label={t('agent.desktop.callback')}
                value={s.callbackAt}
                onChange={(e) => {
                  c.preferences({ callbackAt: e.target.value });
                }}
              />
              <Button
                disabled={
                  busy ||
                  s.readOnly ||
                  !s.online ||
                  !outcome ||
                  (outcome.requiresNote && !s.note.trim()) ||
                  outcome.requiredFields.some(
                    (key) =>
                      c.runtime.store.classification(key) === 'pci' ||
                      [null, ''].includes(c.runtime.store.variable(key) as null | string),
                  ) ||
                  (s.callbackAt !== '' && Number.isNaN(Date.parse(s.callbackAt)))
                }
                onClick={() => void run(() => c.complete(subCodes))}
              >
                {t('agent.desktop.submit')}
              </Button>
            </section>
          ) : (
            <fieldset
              className="ag-runtime"
              data-page-id={typeof page === 'string' ? page : undefined}
              disabled={s.readOnly || s.view.state !== 'active'}
            >
              <legend className="vb-sr-only">{t('agent.desktop.script')}</legend>
              <ComponentProvider environment={componentEnvironment}>
                <ScriptRenderer runtime={c.runtime} autoStart={false} />
              </ComponentProvider>
            </fieldset>
          )}
        </div>
        {(side || ['chat', 'email'].includes(c.desktop.interaction.channel)) && (
          <aside className="ag-sidebar" aria-label={t('agent.desktop.sidebar')}>
            <AgentAiPanel controller={c} csrf={csrf} />
            <Tabs
              label={t('agent.desktop.sidebar')}
              items={[
                {
                  value: 'customer',
                  label: t('agent.desktop.summary'),
                  content: (
                    <dl>
                      {['customerName', 'customerId', 'ani'].map((key) => (
                        <div key={key}>
                          <dt>{t(`agent.desktop.context.${key}`)}</dt>
                          <dd>{formatValue(c.desktop.interaction.context[key])}</dd>
                        </div>
                      ))}
                    </dl>
                  ),
                },
                {
                  value: 'notes',
                  label: t('agent.desktop.notes'),
                  content: (
                    <Textarea
                      label={t('agent.desktop.notes')}
                      value={s.note}
                      maxLength={4000}
                      disabled={s.readOnly}
                      onChange={(e) => {
                        c.preferences({ note: e.target.value });
                      }}
                    />
                  ),
                },
                {
                  value: 'history',
                  label: t('agent.desktop.history'),
                  content: <ContextList value={c.desktop.interaction.context['history']} />,
                },
                {
                  value: 'knowledge',
                  label: t('agent.desktop.knowledge'),
                  content: <ContextList value={c.desktop.interaction.context['knowledge']} />,
                },
                {
                  value: 'objections',
                  label: t('agent.desktop.objections'),
                  content: <ContextList value={c.desktop.interaction.context['objections']} />,
                },
                ...(c.desktop.interaction.channel === 'chat'
                  ? [
                      {
                        value: 'transcript',
                        label: t('agent.desktop.transcript'),
                        content: (
                          <ContextList
                            value={
                              c.desktop.interaction.context['channel.chat.transcript'] ??
                              c.desktop.interaction.context['transcript'] ??
                              c.desktop.interaction.context['participantData']
                            }
                          />
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </aside>
        )}
      </div>
      <footer className="ag-footer">
        <Button
          variant="secondary"
          disabled={
            busy ||
            s.readOnly ||
            !s.online ||
            s.view.state !== 'active' ||
            s.view.snapshot.history.length === 0
          }
          onClick={() => void run(() => c.runtime.back())}
        >
          <ChevronLeft size={16} />
          {t('agent.desktop.back')}
        </Button>
        <div className="ag-progress">
          <span>
            {t('agent.desktop.progress', {
              current: index + 1,
              total: c.runtime.document.pages.length,
            })}
          </span>
          <Progress
            value={Math.max(0, ((index + 1) / c.runtime.document.pages.length) * 100)}
            label={t('agent.desktop.progressLabel')}
          />
        </div>
        <Button
          variant="ghost"
          disabled={busy || s.readOnly || !s.online || !['active', 'paused'].includes(s.view.state)}
          onClick={() => void run(() => c.wrapup())}
        >
          {t('agent.desktop.wrapup')}
        </Button>
        <Button
          disabled={
            busy || s.readOnly || !s.online || Boolean(s.dataFailure) || s.view.state !== 'active'
          }
          data-agent-next=""
          onClick={() => void run(next)}
        >
          {t('agent.desktop.next')}
          <ChevronRight size={16} />
        </Button>
      </footer>
      {help && (
        <section className="ag-help" aria-label={t('agent.desktop.shortcuts')}>
          <h2>{t('agent.desktop.shortcuts')}</h2>
          <p>
            <Kbd>{t('agent.desktop.shortcutNext')}</Kbd> {t('agent.desktop.next')}
          </p>
          <p>
            <Kbd>{t('agent.desktop.shortcutBack')}</Kbd> {t('agent.desktop.back')}
          </p>
          <p>
            <Kbd>{t('agent.desktop.shortcutHelp')}</Kbd> {t('agent.desktop.shortcuts')}
          </p>
          <Button
            onClick={() => {
              setHelp(false);
            }}
          >
            {t('agent.desktop.close')}
          </Button>
        </section>
      )}
    </section>
  );
}
function ContextList({ value }: { value: unknown }) {
  const { t } = useTranslation();
  if (!Array.isArray(value) || !value.length) return <p>{t('agent.desktop.empty')}</p>;
  return (
    <ol className="ag-context-list">
      {value.slice(-100).map((item: unknown, index) => (
        <li key={index}>{typeof item === 'string' ? item : contextText(item)}</li>
      ))}
    </ol>
  );
}

function formatValue(value: unknown) {
  return value === null || value === undefined
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : '';
}

function contextText(value: unknown) {
  if (!value || typeof value !== 'object') return '';
  const entry = value as Record<string, unknown>;
  return ['sender', 'from', 'title', 'text', 'body', 'message', 'summary', 'timestamp', 'at']
    .map((key) => entry[key])
    .filter((v): v is string => typeof v === 'string')
    .join(' · ');
}

function WrapField({ variable, controller: c }: { variable: string; controller: AgentController }) {
  const { t } = useTranslation();
  const definition = c.runtime.document.variables.find((v) => v.key === variable);
  const label = c.runtime.message(variable),
    value = c.runtime.store.variable(variable);
  if (
    !definition ||
    c.runtime.store.classification(variable) === 'pci' ||
    ['object', 'array'].includes(definition.type)
  )
    return (
      <Alert tone="warning" title={t('agent.desktop.requiredScriptField', { field: label })} />
    );
  if (definition.type === 'boolean')
    return (
      <Checkbox
        label={label}
        checked={value === true}
        onCheckedChange={(checked) => {
          c.runtime.store.setVariable(variable, checked === true);
        }}
      />
    );
  if (definition.type === 'enum')
    return (
      <Select
        label={label}
        value={typeof value === 'string' ? value : ''}
        options={(definition.enumValues ?? []).map((option) => ({
          value: option,
          label: c.runtime.message(option),
        }))}
        onValueChange={(option) => {
          c.runtime.store.setVariable(variable, option);
        }}
      />
    );
  return (
    <Input
      label={label}
      required
      type={definition.type === 'number' ? 'number' : 'text'}
      value={formatValue(value)}
      onChange={(event) => {
        const next = event.target.value;
        if (definition.type === 'number')
          c.runtime.store.setVariable(variable, next === '' ? null : Number(next));
        else c.runtime.store.setVariable(variable, next);
      }}
    />
  );
}
