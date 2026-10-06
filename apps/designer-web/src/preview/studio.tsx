import { useEffect, useState, useSyncExternalStore, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { useAbility } from '@verbis/authz/react';
import type { DataSourceRequest } from '@verbis/core-runtime';
import { createI18n, type I18nInstance } from '@verbis/i18n';
import {
  ActionSchema,
  PreviewContextSchema,
  PreviewMockSchema,
  JsonValueSchema,
  ChannelTypeSchema,
  type TestScenario,
  type JsonValue,
} from '@verbis/script-schema';
import { PreviewLiveResultSchema } from '@verbis/shared-types';
import {
  Button,
  Input,
  Select,
  Checkbox,
  Badge,
  Alert,
  Tabs,
  Dialog,
  type Theme,
} from '@verbis/ui';

import { request } from '../api/client.js';
import { useEditor, type EditorStore } from '../editor/store.js';
import { JsonField } from '../integrations/json-field.js';
import { useWorkspace } from '../workspace/context.js';

import { PreviewController } from './controller.js';
import { DevicePreview } from './device.js';
import { previewLint } from './lint.js';
import { RegressionPanel } from './regression-panel.js';
import './styles.css';

const FlowDesigner = lazy(() =>
  import('../flow/designer.js').then((m) => ({ default: m.FlowDesigner })),
);
const none = () => () => undefined;
const zero = () => 0;
function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function project(value: JsonValue, path: string): JsonValue {
  let result: JsonValue = value;
  for (const part of path.slice(1).match(/[A-Za-z_][A-Za-z0-9_]*|\d+/g) ?? []) {
    if (Array.isArray(result)) result = result[Number(part)] ?? null;
    else if (result && typeof result === 'object') result = result[part] ?? null;
    else return null;
  }
  return result;
}
export function PreviewStudio({
  store,
  scriptId,
  number,
  documentVersion,
  versionState,
  dirty,
}: {
  store: EditorStore;
  scriptId: string;
  number: number;
  documentVersion?: number | undefined;
  versionState: string;
  dirty: boolean;
}) {
  const state = useEditor(store),
    { t } = useTranslation(),
    { session } = useWorkspace(),
    ability = useAbility();
  const [context, setContext] = useState(() =>
    PreviewContextSchema.parse({
      interaction: { channel: 'voice', ani: '', attachedData: {}, customer: {} },
      campaign: { id: '', name: '' },
    }),
  );
  const [mocks, setMocks] = useState<TestScenario['dataSources']>(() =>
    Object.fromEntries(
      state.document.dataSources.map((source) => [
        source.id,
        PreviewMockSchema.parse({
          outputs: Object.fromEntries(Object.keys(source.outputs).map((key) => [key, null])),
        }),
      ]),
    ),
  );
  const [liveSources, setLiveSources] = useState<Set<string>>(new Set());
  const [controller, setController] = useState<PreviewController | null>(null),
    [run, setRun] = useState(0),
    [i18n, setI18n] = useState<I18nInstance | null>(null);
  const [theme, setTheme] = useState<Theme>('light'),
    [width, setWidth] = useState(1280),
    [height, setHeight] = useState(800);
  const [tab, setTab] = useState('context'),
    [saveDialog, setSaveDialog] = useState(false),
    [name, setName] = useState(''),
    [synthetic, setSynthetic] = useState(false),
    [error, setError] = useState(false);
  useSyncExternalStore(controller?.subscribe ?? none, controller?.getSnapshot ?? zero, zero);
  useEffect(() => {
    let cancelled = false;
    void createI18n(context.locale).then((instance) => {
      if (!cancelled) setI18n(instance);
    });
    return () => {
      cancelled = true;
    };
  }, [context.locale]);
  useEffect(() => {
    const live = async (input: DataSourceRequest) => {
      const response = await request(
        `/v1/scripts/${scriptId}/versions/${number}/preview/data-sources/${input.id}`,
        PreviewLiveResultSchema,
        {
          method: 'POST',
          body: { input: input.inputs, environment: 'test' },
          csrf: session.csrfToken,
          signal: input.signal,
        },
      );
      const definition = state.document.dataSources.find((source) => source.id === input.id);
      return Object.fromEntries(
        Object.entries(definition?.outputs ?? {}).map(([key, mapping]) => [
          key,
          project(JsonValueSchema.parse(response.value), mapping.path),
        ]),
      );
    };
    let active: PreviewController | undefined;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        active = new PreviewController(state.document, context, mocks, live, liveSources);
        setController(active);
        setError(false);
        active.start();
      } catch {
        setError(true);
        setController(null);
      }
    });
    return () => {
      cancelled = true;
      active?.dispose();
    };
    // Context/data source edits become effective atomically through Restart; no keystroke resets the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, state.document, scriptId, number, session.csrfToken]);
  const runtime = controller?.runtime;
  const scenarios = state.document.testScenarios ?? [];
  const updateContext = (input: unknown) => {
    const next = PreviewContextSchema.safeParse(input);
    if (next.success) setContext(next.data);
    else setError(true);
  };
  const breakpoint = (key: string, checked: boolean) => {
    if (!runtime) return;
    if (checked) runtime.executor.debugger.breakpoints.add(key);
    else runtime.executor.debugger.breakpoints.delete(key);
    controller.notify();
  };
  const saveScenario = () => {
    try {
      const scenario = controller?.scenario(name);
      if (!scenario || !synthetic) return;
      store.edit((document) => {
        document.testScenarios = [...(document.testScenarios ?? []), scenario];
      });
      setSaveDialog(false);
      setName('');
      setSynthetic(false);
    } catch {
      setError(true);
    }
  };
  return (
    <section className="pv-studio" aria-label={t('designer.preview.title')}>
      <div className="pv-toolbar">
        <Badge tone="info">{t('designer.preview.simulation')}</Badge>
        <Button
          onClick={() => {
            setRun((value) => value + 1);
          }}
        >
          {t('designer.preview.restart')}
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            runtime?.executor.debugger.paused ? controller?.resume() : controller?.pause()
          }
        >
          {t(
            runtime?.executor.debugger.paused
              ? 'designer.preview.resume'
              : 'designer.preview.pause',
          )}
        </Button>
        <Button
          variant="secondary"
          onClick={() => controller?.step()}
          disabled={!runtime?.executor.debugger.paused}
        >
          {t('designer.preview.step')}
        </Button>
        <Select
          label={t('designer.preview.device')}
          value={String(width)}
          options={[375, 768, 1280, 1920].map((size) => ({
            value: String(size),
            label: `${size}px`,
          }))}
          onValueChange={(value) => {
            setWidth(Number(value));
          }}
        />
        <Input
          label={t('designer.preview.width')}
          type="number"
          min={320}
          max={1920}
          value={width}
          onChange={(e) => {
            setWidth(Math.max(320, Math.min(1920, Number(e.target.value))));
          }}
        />
        <Input
          label={t('designer.preview.height')}
          type="number"
          min={320}
          max={1200}
          value={height}
          onChange={(e) => {
            setHeight(Math.max(320, Math.min(1200, Number(e.target.value))));
          }}
        />
        <Select
          label={t('designer.preview.theme')}
          value={theme}
          options={['light', 'dark', 'high-contrast'].map((value) => ({
            value,
            label: t(`common.theme.${value}`),
          }))}
          onValueChange={(value) => {
            setTheme(value as Theme);
          }}
        />
        <Select
          label={t('designer.preview.language')}
          value={context.locale}
          options={[
            { value: 'tr', label: t('common.locale.tr') },
            { value: 'en', label: t('common.locale.en') },
          ]}
          onValueChange={(value) => {
            updateContext({ ...context, locale: value });
            setRun((v) => v + 1);
          }}
        />
        <Button
          disabled={
            versionState !== 'draft' ||
            scenarios.length >= 20 ||
            (controller?.liveUsed ?? false) ||
            (controller?.branched ?? false) ||
            (runtime?.executor.busy ?? false) ||
            !runtime ||
            dirty
          }
          onClick={() => {
            setError(false);
            setSaveDialog(true);
          }}
        >
          {t('designer.preview.saveScenario')}
        </Button>
      </div>
      {controller?.branched && <Alert title={t('designer.preview.branchHelp')} tone="info" />}
      {(error || controller?.error) && <Alert title={t('designer.preview.failed')} tone="danger" />}
      <div className="pv-layout">
        <aside className="pv-sidebar">
          <Tabs
            label={t('designer.preview.panels')}
            value={tab}
            onValueChange={setTab}
            items={[
              {
                value: 'context',
                label: t('designer.preview.context'),
                content: (
                  <div className="pv-panel">
                    <p>{t('designer.preview.contextHelp')}</p>
                    <Select
                      label={t('designer.preview.loadScenario')}
                      value=""
                      options={scenarios.map((s) => ({ value: s.id, label: s.name }))}
                      onValueChange={(id) => {
                        const scenario = scenarios.find((s) => s.id === id);
                        if (scenario) {
                          setContext(scenario.context);
                          setMocks(scenario.dataSources);
                          setLiveSources(new Set());
                          setRun((v) => v + 1);
                        }
                      }}
                    />
                    <Select
                      label={t('designer.preview.channel')}
                      value={textValue(context.interaction['channel'], 'voice')}
                      options={ChannelTypeSchema.options.map((value) => ({
                        value,
                        label: t(`designer.preview.channels.${value}`),
                      }))}
                      onValueChange={(value) => {
                        updateContext({
                          ...context,
                          interaction: { ...context.interaction, channel: value },
                        });
                      }}
                    />
                    <Input
                      label={t('designer.preview.ani')}
                      value={textValue(context.interaction['ani'])}
                      onChange={(e) => {
                        updateContext({
                          ...context,
                          interaction: { ...context.interaction, ani: e.target.value },
                        });
                      }}
                    />
                    <JsonField
                      label={t('designer.preview.campaign')}
                      value={context.campaign}
                      change={(value) => {
                        updateContext({ ...context, campaign: value });
                      }}
                    />
                    <JsonField
                      label={t('designer.preview.attachedData')}
                      value={context.interaction['attachedData']}
                      change={(value) => {
                        updateContext({
                          ...context,
                          interaction: { ...context.interaction, attachedData: value },
                        });
                      }}
                    />
                    <JsonField
                      label={t('designer.preview.customer')}
                      value={context.interaction['customer']}
                      change={(value) => {
                        updateContext({
                          ...context,
                          interaction: { ...context.interaction, customer: value },
                        });
                      }}
                    />
                    <JsonField
                      label={t('designer.preview.initialState')}
                      value={context}
                      change={updateContext}
                    />
                  </div>
                ),
              },
              {
                value: 'data',
                label: t('designer.preview.dataSources'),
                content: (
                  <div className="pv-panel">
                    <p>{t('designer.preview.mockHelp')}</p>
                    {state.document.dataSources.map((source) => (
                      <fieldset key={source.id}>
                        <legend>{source.id}</legend>
                        <Checkbox
                          label={t('designer.preview.liveTest')}
                          checked={liveSources.has(source.id)}
                          disabled={!ability.can('execute', 'Integration') || dirty}
                          onCheckedChange={(checked) => {
                            setLiveSources((before) => {
                              const next = new Set(before);
                              if (checked === true) next.add(source.id);
                              else next.delete(source.id);
                              return next;
                            });
                          }}
                        />
                        <Select
                          label={t('designer.preview.mockKind')}
                          value={mocks[source.id]?.kind ?? 'success'}
                          options={['success', 'empty', 'error', 'delay'].map((value) => ({
                            value,
                            label: t(`designer.preview.mocks.${value}`),
                          }))}
                          onValueChange={(value) => {
                            setMocks((before) => ({
                              ...before,
                              [source.id]: PreviewMockSchema.parse({
                                ...before[source.id],
                                kind: value,
                                delayMs: value === 'delay' ? 1000 : 0,
                              }),
                            }));
                          }}
                        />
                        <JsonField
                          label={t('designer.preview.mockOutputs')}
                          value={mocks[source.id]?.outputs ?? {}}
                          change={(value) => {
                            const parsed = PreviewMockSchema.safeParse({
                              ...mocks[source.id],
                              outputs: value,
                            });
                            if (parsed.success)
                              setMocks((before) => ({ ...before, [source.id]: parsed.data }));
                            else setError(true);
                          }}
                        />
                      </fieldset>
                    ))}
                  </div>
                ),
              },
              {
                value: 'watch',
                label: t('designer.preview.watch'),
                content: (
                  <div className="pv-panel">
                    <p>{t('designer.preview.watchHelp')}</p>
                    {state.document.variables.map((variable) => (
                      <div key={variable.key}>
                        <Badge>{variable.scope}</Badge>
                        {variable.key}
                        {runtime &&
                          (['pii', 'pci'].includes(runtime.store.classification(variable.key)) ? (
                            <p>{t('designer.preview.masked')}</p>
                          ) : variable.scope === 'global' ? (
                            <pre>
                              {JSON.stringify(runtime.store.variable(variable.key), null, 2)}
                            </pre>
                          ) : (
                            <JsonField
                              label={variable.key}
                              value={runtime.store.variable(variable.key)}
                              change={(value) => {
                                try {
                                  const parsed = JsonValueSchema.parse(value);
                                  runtime.store.setVariable(variable.key, parsed);
                                  runtime.recordInput({
                                    type: 'variable',
                                    variable: variable.key,
                                    value: parsed,
                                  });
                                } catch {
                                  setError(true);
                                }
                              }}
                            />
                          ))}
                      </div>
                    ))}
                  </div>
                ),
              },
              {
                value: 'breakpoints',
                label: t('designer.preview.breakpoints'),
                content: (
                  <div className="pv-panel">
                    <p>{t('designer.preview.breakpointHelp')}</p>
                    {state.document.pages.map((page) => (
                      <Checkbox
                        key={page.id}
                        label={page.name}
                        checked={
                          runtime?.executor.debugger.breakpoints.has(`page:${page.id}`) ?? false
                        }
                        onCheckedChange={(value) => {
                          breakpoint(`page:${page.id}`, value === true);
                        }}
                      />
                    ))}
                    {ActionSchema.options
                      .map((schema) => schema.shape.type.value)
                      .map((type) => (
                        <Checkbox
                          key={type}
                          label={t(`designer.preview.actions.${type}`)}
                          checked={
                            runtime?.executor.debugger.breakpoints.has(`action:${type}`) ?? false
                          }
                          onCheckedChange={(value) => {
                            breakpoint(`action:${type}`, value === true);
                          }}
                        />
                      ))}
                  </div>
                ),
              },
              {
                value: 'lint',
                label: t('designer.preview.lint'),
                content: (
                  <div className="pv-panel">
                    <ul>
                      {previewLint(state.document, store.issues()).map((issue, index) => (
                        <li key={index}>
                          <Badge tone={issue.severity === 'error' ? 'danger' : 'warning'}>
                            {t(`designer.preview.severity.${issue.severity}`)}
                          </Badge>
                          <p>{t(issue.messageKey, issue.params ?? {})}</p>
                          <code>{issue.path}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              },
              {
                value: 'scenarios',
                label: t('designer.preview.scenarios'),
                content: (
                  <>
                    <ul>
                      {scenarios.map((scenario) => (
                        <li key={scenario.id}>
                          {scenario.name}
                          <Button
                            variant="ghost"
                            disabled={versionState !== 'draft'}
                            onClick={() => {
                              store.edit((document) => {
                                document.testScenarios = document.testScenarios?.filter(
                                  (s) => s.id !== scenario.id,
                                );
                              });
                            }}
                          >
                            {t('designer.preview.delete')}
                          </Button>
                        </li>
                      ))}
                    </ul>
                    <RegressionPanel
                      scriptId={scriptId}
                      number={number}
                      documentVersion={documentVersion}
                      state={versionState}
                      dirty={dirty}
                    />
                  </>
                ),
              },
            ]}
          />
        </aside>
        <div className="pv-stage">
          {runtime && i18n && (
            <DevicePreview
              runtime={runtime}
              width={width}
              height={height}
              theme={theme}
              i18n={i18n}
              title={t('designer.preview.deviceFrame')}
            />
          )}
          <p role="status">
            {t('designer.preview.page')}:{' '}
            {state.document.pages.find((page) => page.id === runtime?.store.get('runtime.page'))
              ?.name ?? '—'}{' '}
            · {t('designer.preview.outcome')}: {controller?.outcome ?? '—'}
          </p>
        </div>
      </div>
      <details className="pv-flow" open>
        <summary>{t('designer.preview.liveFlow')}</summary>
        <Suspense fallback={null}>
          <FlowDesigner
            store={store}
            readOnly
            openPage={() => undefined}
            {...(controller
              ? {
                  trace: {
                    nodes: controller.visitedNodes,
                    edges: controller.visitedEdges,
                    current: controller.currentNode,
                  },
                }
              : {})}
          />
        </Suspense>
      </details>
      <section className="pv-timeline" aria-label={t('designer.preview.timeline')}>
        <h2>{t('designer.preview.timeline')}</h2>
        <p>{t('designer.preview.timeTravelHelp')}</p>
        <ol>
          {controller?.timeline.map((row) => (
            <li key={row.id}>
              <time>{new Date(row.event.timestamp ?? 0).toLocaleTimeString(context.locale)}</time>
              <Badge
                tone={
                  row.event.phase === 'failed'
                    ? 'danger'
                    : row.event.phase === 'waiting'
                      ? 'warning'
                      : 'neutral'
                }
              >
                {t(`designer.preview.phases.${row.event.phase}`)}
              </Badge>
              <code>
                {row.event.action} {row.event.node} {row.event.path} {row.event.code}
              </code>
              {row.event.durationMs !== undefined && (
                <span>
                  {row.event.durationMs} {t('designer.preview.milliseconds')}
                </span>
              )}
              {row.event.path && (
                <Checkbox
                  label={t('designer.preview.breakHere')}
                  checked={runtime?.executor.debugger.breakpoints.has(row.event.path) ?? false}
                  onCheckedChange={(value) => {
                    breakpoint(row.event.path ?? '', value === true);
                  }}
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={!row.snapshot}
                onClick={() => {
                  controller.jump(row.id);
                }}
              >
                {t('designer.preview.jump')}
              </Button>
            </li>
          ))}
        </ol>
      </section>
      <Dialog
        open={saveDialog}
        onOpenChange={setSaveDialog}
        title={t('designer.preview.saveScenario')}
        description={t('designer.preview.syntheticHelp')}
      >
        <Input
          label={t('designer.preview.scenarioName')}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <Checkbox
          label={t('designer.preview.syntheticConfirm')}
          checked={synthetic}
          onCheckedChange={(value) => {
            setSynthetic(value === true);
          }}
        />
        <Button disabled={!synthetic || !name.trim()} onClick={saveScenario}>
          {t('designer.preview.saveScenario')}
        </Button>
      </Dialog>
    </section>
  );
}
