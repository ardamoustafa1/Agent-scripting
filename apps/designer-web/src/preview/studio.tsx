import { useEffect, useState, useSyncExternalStore, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

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
  Toolbar,
  ToolbarToggleGroup,
  ToolbarToggleItem,
  type Theme,
} from '@verbis/ui';

import { request } from '../api/client.js';
import { useEditor, type EditorStore } from '../editor/store.js';
import { ValueEditor, valueKind } from '../editor/value-editor.js';
import { variableName } from '../flow/model.js';
import { JsonField } from '../integrations/json-field.js';
import { describePath, displayValue, nodeTitle } from '../lifecycle/diff-text.js';
import { humanize } from '../words.js';
import { useWorkspace } from '../workspace/context.js';

import { expectedFields, formatScalar, parseScalar, readPath, writePath } from './context-paths.js';
import { PreviewController } from './controller.js';
import { CoveragePanel, type CoverageTrace } from './coverage-panel.js';
import { DevicePreview } from './device.js';
import { KeyValueField } from './key-value-field.js';
import { previewLint } from './lint.js';
import { RegressionPanel } from './regression-panel.js';
import { sampleFromSchema } from './sample.js';
import './styles.css';

const FlowDesigner = lazy(() =>
  import('../flow/designer.js').then((m) => ({ default: m.FlowDesigner })),
);
const SampleSources = z.object({
  data: z.array(
    z.object({
      key: z.string(),
      version: z.number().int(),
      definition: z.object({ outputSchema: z.record(z.string(), z.unknown()).default({}) }),
    }),
  ),
});
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
      // The agent desktop supplies the signed-in agent; scripts greet with `agent.firstName`.
      agent: { firstName: t('designer.preview.sampleAgent') },
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
  // Agents never see a bare page: by default the preview draws the agent desktop's frame.
  const [frame, setFrame] = useState<'agent' | 'script'>('agent');
  const [theme, setTheme] = useState<Theme>('light'),
    [width, setWidth] = useState(1280),
    [height, setHeight] = useState(800);
  const [coverageTrace, setCoverageTrace] = useState<CoverageTrace | null>(null);
  const [samples, setSamples] = useState<
    Record<string, { state: 'loading' | 'done' | 'missing' | 'failed'; generation: number }>
  >({});
  const fillSample = async (source: (typeof state.document.dataSources)[number]) => {
    const key = source.ref.replace(/^tenant-datasource:/, '');
    const generation = (samples[source.id]?.generation ?? 0) + 1;
    setSamples((before) => ({ ...before, [source.id]: { state: 'loading', generation } }));
    try {
      const page = await request(
        `/v1/data-sources?limit=20&q=${encodeURIComponent(key)}`,
        SampleSources,
      );
      const row = page.data.find((candidate) => candidate.key === key);
      if (!row) {
        setSamples((before) => ({ ...before, [source.id]: { state: 'missing', generation } }));
        return;
      }
      const sample = JsonValueSchema.parse(sampleFromSchema(row.definition.outputSchema));
      const outputs = Object.fromEntries(
        Object.entries(source.outputs).map(([name, output]) => [
          name,
          project(sample, output.path),
        ]),
      );
      setMocks((before) => ({
        ...before,
        [source.id]: PreviewMockSchema.parse({
          ...before[source.id],
          kind: 'success',
          delayMs: 0,
          outputs,
        }),
      }));
      setSamples((before) => ({ ...before, [source.id]: { state: 'done', generation } }));
    } catch {
      setSamples((before) => ({ ...before, [source.id]: { state: 'failed', generation } }));
    }
  };
  const [watches, setWatches] = useState<string[]>([]),
    [watchDraft, setWatchDraft] = useState('');
  const [tab, setTab] = useState('context'),
    [saveDialog, setSaveDialog] = useState(false),
    [name, setName] = useState(''),
    [synthetic, setSynthetic] = useState(false),
    [recordingError, setRecordingError] = useState<'blocked' | 'failed' | null>(null),
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
  const expected = expectedFields(state.document);
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
    setRecordingError(null);
    try {
      const scenario = controller?.scenario(name);
      if (!scenario || !synthetic) return;
      store.edit((document) => {
        document.testScenarios = [...(document.testScenarios ?? []), scenario];
      });
      setSaveDialog(false);
      setName('');
      setSynthetic(false);
    } catch (cause) {
      setRecordingError(
        cause instanceof Error && cause.message === 'VERBIS_PREVIEW_SYNTHETIC_ONLY'
          ? 'blocked'
          : 'failed',
      );
    }
  };
  return (
    <section className="pv-studio" aria-label={t('designer.preview.title')}>
      <div className="pv-toolbar">
        <Badge tone="info">{t('designer.preview.simulation')}</Badge>
        <div role="group" className="pv-run" aria-label={t('designer.preview.groups.run')}>
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
          <Button
            variant="secondary"
            disabled={!controller || controller.timeline.filter((row) => row.snapshot).length < 2}
            onClick={() => {
              controller?.stepBack();
            }}
          >
            {t('designer.preview.stepBack')}
          </Button>
        </div>
        <div role="group" className="pv-env" aria-label={t('designer.preview.groups.environment')}>
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
        </div>
        <Button
          className="pv-save"
          variant="secondary"
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
            setRecordingError(null);
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
                          // Saved scenarios rarely name an agent; keep the greeting readable.
                          setContext(
                            Object.keys(scenario.context.agent).length > 0
                              ? scenario.context
                              : {
                                  ...scenario.context,
                                  agent: { firstName: t('designer.preview.sampleAgent') },
                                },
                          );
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
                    <Input
                      label={t('designer.preview.agentName')}
                      hint={t('designer.preview.agentNameHelp')}
                      value={textValue(context.agent['firstName'])}
                      onChange={(e) => {
                        updateContext({
                          ...context,
                          agent: { ...context.agent, firstName: e.target.value },
                        });
                      }}
                    />
                    {expected.length > 0 && (
                      <fieldset className="pv-expected">
                        <legend>{t('designer.preview.expectedData')}</legend>
                        <p className="ed-help">{t('designer.preview.expectedHelp')}</p>
                        {expected.map((field) => {
                          const current = readPath(context, field.path);
                          const write = (value: JsonValue) => {
                            updateContext(writePath(context, field.path, value));
                          };
                          const label = `${field.variable} · ${field.path}`;
                          return field.type === 'boolean' ? (
                            <Select
                              key={field.path}
                              label={label}
                              value={current === true ? 'true' : 'false'}
                              options={[
                                { value: 'true', label: t('designer.value.yes') },
                                { value: 'false', label: t('designer.value.no') },
                              ]}
                              onValueChange={(choice) => {
                                write(choice === 'true');
                              }}
                            />
                          ) : (
                            <Input
                              key={field.path}
                              label={label}
                              type={field.type === 'number' ? 'number' : 'text'}
                              value={textValue(current)}
                              onChange={(event) => {
                                const next = event.target.value;
                                write(
                                  field.type === 'number'
                                    ? next === ''
                                      ? null
                                      : Number(next)
                                    : next,
                                );
                              }}
                            />
                          );
                        })}
                      </fieldset>
                    )}
                    <KeyValueField
                      label={t('designer.preview.attachedData')}
                      value={context.interaction['attachedData']}
                      change={(value) => {
                        updateContext({
                          ...context,
                          interaction: { ...context.interaction, attachedData: value },
                        });
                      }}
                    />
                    <KeyValueField
                      label={t('designer.preview.customer')}
                      value={context.interaction['customer']}
                      change={(value) => {
                        updateContext({
                          ...context,
                          interaction: { ...context.interaction, customer: value },
                        });
                      }}
                    />
                    <KeyValueField
                      label={t('designer.preview.campaign')}
                      value={context.campaign}
                      change={(value) => {
                        updateContext({ ...context, campaign: value });
                      }}
                    />
                    {/* Whole-state JSON stays available for power users, out of the way. */}
                    <details className="pv-advanced">
                      <summary>{t('designer.preview.advancedState')}</summary>
                      <JsonField
                        label={t('designer.preview.initialState')}
                        value={context}
                        change={updateContext}
                      />
                    </details>
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
                        <legend>{humanize(source.id)}</legend>
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
                        {ability.can('read', 'Integration') && (
                          <div className="pv-sample">
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={samples[source.id]?.state === 'loading'}
                              onClick={() => {
                                void fillSample(source);
                              }}
                            >
                              {t('designer.preview.sampleFromSchema')}
                            </Button>
                            <span role="status">
                              {samples[source.id] && samples[source.id]?.state !== 'loading'
                                ? t(
                                    `designer.preview.sample.${samples[source.id]?.state ?? 'done'}`,
                                  )
                                : ''}
                            </span>
                          </div>
                        )}
                        {/* One typed field per declared output; the whole response stays as JSON
                            under "advanced" for nested lists. */}
                        {Object.entries(source.outputs).map(([key, output]) => {
                          const variable = state.document.variables.find(
                            (v) => v.key === output.variable,
                          );
                          // The field reads as the variable it fills, else as its name in words.
                          const field = variable
                            ? variableName(state.document, variable.key)
                            : humanize(key);
                          const write = (value: JsonValue) => {
                            const parsed = PreviewMockSchema.safeParse({
                              ...mocks[source.id],
                              outputs: { ...mocks[source.id]?.outputs, [key]: value },
                            });
                            if (parsed.success)
                              setMocks((before) => ({ ...before, [source.id]: parsed.data }));
                          };
                          if (!variable)
                            return (
                              <Input
                                key={`${source.id}.${key}.${String(samples[source.id]?.generation ?? 0)}`}
                                label={t('designer.preview.mockField', { field })}
                                hint={t('designer.preview.mockScalarHint')}
                                value={formatScalar(mocks[source.id]?.outputs[key])}
                                onChange={(event) => {
                                  write(parseScalar(event.target.value));
                                }}
                              />
                            );
                          return (
                            <ValueEditor
                              key={`${source.id}.${key}.${String(samples[source.id]?.generation ?? 0)}`}
                              label={t('designer.preview.mockField', { field })}
                              value={mocks[source.id]?.outputs[key] ?? null}
                              kind={valueKind(variable.type)}
                              choices={variable.enumValues?.map((value) => ({
                                value,
                                label: value,
                              }))}
                              variables={[]}
                              allowSources={false}
                              onChange={write}
                            />
                          );
                        })}
                        <details
                          className="pv-advanced"
                          open={Object.keys(source.outputs).length === 0}
                        >
                          <summary>{t('designer.preview.advancedResponse')}</summary>
                          <JsonField
                            key={`${source.id}-${String(samples[source.id]?.generation ?? 0)}-${JSON.stringify(mocks[source.id]?.outputs ?? {})}`}
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
                        </details>
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
                    <form
                      className="pv-watch-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const expression = watchDraft.trim();
                        if (expression && !watches.includes(expression) && watches.length < 20)
                          setWatches([...watches, expression]);
                        setWatchDraft('');
                      }}
                    >
                      <Input
                        label={t('designer.preview.watchExpression')}
                        value={watchDraft}
                        maxLength={500}
                        onChange={(e) => {
                          setWatchDraft(e.target.value);
                        }}
                      />
                      <Button type="submit" variant="secondary" size="sm">
                        {t('designer.preview.addWatch')}
                      </Button>
                    </form>
                    {watches.length > 0 && (
                      <ul className="pv-watches" aria-label={t('designer.preview.watchList')}>
                        {watches.map((expression) => {
                          const result = controller?.watch(expression);
                          return (
                            <li key={expression}>
                              <code>{expression}</code>
                              <output>
                                {!result
                                  ? '—'
                                  : result.status === 'masked'
                                    ? t('designer.preview.masked')
                                    : result.status === 'error'
                                      ? t('designer.preview.watchError')
                                      : JSON.stringify(result.value)}
                              </output>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={t('designer.preview.removeWatch', { expression })}
                                onClick={() => {
                                  setWatches(watches.filter((value) => value !== expression));
                                }}
                              >
                                {t('designer.preview.remove')}
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {state.document.variables.map((variable) => {
                      const kind = valueKind(variable.type);
                      const set = (value: unknown) => {
                        if (!runtime) return;
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
                      };
                      const current: unknown = runtime?.store.variable(variable.key);
                      const literal = JsonValueSchema.safeParse(current ?? null);
                      return (
                        <div key={variable.key}>
                          <Badge>{t(`designer.variables.scopes.${variable.scope}`)}</Badge>
                          {variable.key}
                          {runtime &&
                            (['pii', 'pci'].includes(runtime.store.classification(variable.key)) ? (
                              <p>{t('designer.preview.masked')}</p>
                            ) : variable.scope === 'global' ? (
                              <p>{displayValue(current, t)}</p>
                            ) : kind === 'array' || kind === 'object' || !literal.success ? (
                              // Lists and objects keep the JSON field: it follows runtime changes.
                              <JsonField label={variable.key} value={current} change={set} />
                            ) : (
                              <ValueEditor
                                label={variable.key}
                                value={literal.data}
                                kind={kind}
                                choices={variable.enumValues?.map((value) => ({
                                  value,
                                  label: value,
                                }))}
                                variables={[]}
                                allowSources={false}
                                onChange={set}
                              />
                            ))}
                        </div>
                      );
                    })}
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
                          <p className="pv-issue-path">
                            {describePath(issue.path, state.document, t)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              },
              {
                value: 'coverage',
                label: t('designer.coverage.tab'),
                content: (
                  <CoveragePanel
                    store={store}
                    editable={versionState === 'draft'}
                    onTrace={setCoverageTrace}
                  />
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
          <Toolbar label={t('designer.preview.frame')}>
            <ToolbarToggleGroup
              type="single"
              className="ed-live-segment pv-frame-toggle"
              aria-label={t('designer.preview.frame')}
              value={frame}
              onValueChange={(value) => {
                if (value === 'agent' || value === 'script') setFrame(value);
              }}
            >
              {(['agent', 'script'] as const).map((value) => (
                <ToolbarToggleItem key={value} value={value}>
                  {t(`designer.preview.frames.${value}`)}
                </ToolbarToggleItem>
              ))}
            </ToolbarToggleGroup>
          </Toolbar>
          {runtime && i18n && (
            <DevicePreview
              runtime={runtime}
              width={width}
              height={height}
              theme={theme}
              i18n={i18n}
              title={t('designer.preview.deviceFrame')}
              agentFrame={frame === 'agent'}
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
            {...(tab === 'coverage' && coverageTrace
              ? { trace: coverageTrace }
              : controller
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
              <span className="pv-event">
                {t(`designer.preview.actions.${row.event.action}`, {
                  defaultValue: row.event.action,
                })}
                {row.event.node && <> · {nodeTitle(state.document, row.event.node, t)}</>}
                {row.event.path?.startsWith('/') && (
                  <> · {describePath(row.event.path, state.document, t)}</>
                )}
                {row.event.code && <small> · {row.event.code}</small>}
              </span>
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
              {(() => {
                const changes = controller.changes(row.id);
                return changes.length > 0 ? (
                  <ul className="pv-changes" aria-label={t('designer.preview.changes')}>
                    {changes.map((change) => (
                      <li key={change.variable}>
                        <code>{change.variable}</code>{' '}
                        {change.masked
                          ? t('designer.preview.changedMasked')
                          : t('designer.preview.changedValue', {
                              before: displayValue(change.before, t),
                              after: displayValue(change.after, t),
                            })}
                      </li>
                    ))}
                  </ul>
                ) : null;
              })()}
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
        {recordingError && (
          <Alert
            title={t(
              recordingError === 'blocked'
                ? 'designer.preview.recordingBlocked'
                : 'designer.preview.failed',
            )}
            tone="danger"
          />
        )}
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
