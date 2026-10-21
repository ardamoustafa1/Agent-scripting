import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useNavigate, useBlocker } from 'react-router-dom';
import { z } from 'zod';

import { useAbility } from '@verbis/authz/react';
import {
  IntegrationSaveSchema,
  IntegrationRecordSchema,
  IntegrationConsoleSchema,
  IntegrationDefinitionSchema,
  IntegrationProfileSchema,
  type IntegrationDefinition,
} from '@verbis/shared-types';
import { Button, Input, Textarea, Select, Tabs, Alert, Badge, Dialog, Checkbox } from '@verbis/ui';

import { request, ApiError } from '../api/client.js';
import { KeyValueField } from '../preview/key-value-field.js';
import { useWorkspace } from '../workspace/context.js';
import { Loading, Failure, Forbidden } from '../workspace/states.js';

import { AuthEditor } from './auth.js';
import {
  BodyField,
  ProfileFields,
  ProfileSummary,
  SampleDataField,
  SchemaFieldsEditor,
  TestInputFields,
  TraceView,
  UrlListField,
} from './forms.js';
import {
  defaults,
  importCurl,
  openApiOperations,
  inferSchema,
  fields,
  type Operation,
} from './importers.js';
import { JsonField } from './json-field.js';
import { MappingEditor } from './mapping.js';
import { sampleFromSchema } from './schema-fields.js';
import { SqlEditor } from './sql-form.js';
import { emptySqlForm, sqlDefinitionPatch, sqlFormOf, withoutSql } from './sql-model.js';
import './styles.css';

type Draft = z.infer<typeof IntegrationSaveSchema>;
type Record = z.infer<typeof IntegrationRecordSchema>;
type Trace = z.infer<typeof IntegrationConsoleSchema>;
const object = z.record(z.string(), z.unknown());
/** Mirrors the save schema's reserved headers so authors see the reason as they type. */
const RESERVED_HEADER =
  /^(authorization|proxy-authorization|cookie|host|connection|content-length|transfer-encoding)$/i;
export default function IntegrationEditor() {
  const { id } = useParams(),
    { session } = useWorkspace(),
    ability = useAbility();
  const isNew = id === 'new';
  const query = useQuery({
    queryKey: [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      'integration',
      id,
    ],
    queryFn: ({ signal }) =>
      request(`/v1/data-sources/${id ?? ''}`, IntegrationRecordSchema, { signal }),
    enabled: !isNew,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  if (isNew && !ability.can('create', 'Integration')) return <Forbidden />;
  if (isNew) return <Editor />;
  if (query.isError)
    return (
      <Failure
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  if (!query.data) return <Loading />;
  return <Editor key={`${query.data.id}-${query.data.version}`} initial={query.data} />;
}
function Editor({ initial }: { initial?: Record | undefined }) {
  const { t } = useTranslation(),
    { session, environment } = useWorkspace(),
    ability = useAbility(),
    navigate = useNavigate(),
    cache = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() =>
    initial
      ? IntegrationSaveSchema.parse({
          key: initial.key,
          protocol: initial.protocol,
          definition: (() => {
            const { pendingPromotion: _pending, ...definition } = initial.definition;
            return definition;
          })(),
          policy: initial.policy,
        })
      : defaults(),
  );
  const [tab, setTab] = useState(initial ? 'request' : 'import'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(JSON.stringify(draft)),
    [destination, setDestination] = useState('');
  const dirty = saved !== JSON.stringify(draft),
    editable = ability.can(initial ? 'update' : 'create', 'Integration');
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (destination && !dirty) {
      void navigate(destination);
    }
  }, [destination, dirty, navigate]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        Reflect.set(event, 'returnValue', '');
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('beforeunload', unload);
    };
  }, [dirty]);
  const patch = (value: Partial<IntegrationDefinition>) => {
    const { pendingPromotion: _pending, ...safe } = value;
    setDraft((d) => ({ ...d, definition: { ...d.definition, ...safe } }));
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (document.querySelector('[data-json-invalid="true"]')) throw new Error('INVALID_JSON');
      const body = IntegrationSaveSchema.parse(draft);
      const row = await request(
        initial ? `/v1/data-sources/${initial.id}` : '/v1/data-sources',
        IntegrationRecordSchema,
        {
          method: initial ? 'PUT' : 'POST',
          body,
          csrf: session.csrfToken,
          ...(initial ? { ifMatch: `"${initial.version}"` } : {}),
        },
      );
      setSaved(JSON.stringify(draft));
      cache.setQueryData(
        [
          'workspace',
          session.user.tenantId,
          session.user.id,
          session.session.id,
          'integration',
          row.id,
        ],
        row,
      );
      void cache.invalidateQueries({
        queryKey: [
          'workspace',
          session.user.tenantId,
          session.user.id,
          session.session.id,
          'integrations',
        ],
      });
      setDestination(`/integrations/${row.id}`);
    } catch (e) {
      setError(
        e instanceof ApiError && (e.status === 409 || e.status === 412) ? 'conflict' : 'saveError',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ig-editor">
      <Link to="/integrations" className="dw-back">
        {t('designer.workspace.back')}
      </Link>
      <div className="dw-page-heading">
        <div>
          <Badge>{draft.protocol.toUpperCase()}</Badge>
          <h1>{initial?.key ?? t('designer.integrations.create')}</h1>
          <p>{t('designer.integrations.serverOnly')}</p>
        </div>
        <Button
          disabled={!editable || busy}
          loading={busy}
          onClick={() => {
            void save();
          }}
        >
          {t('designer.integrations.save')}
        </Button>
      </div>
      {error && <Alert tone="danger" title={t(`designer.integrations.${error}`)} />}
      <Tabs
        label={t('designer.integrations.editor')}
        value={tab}
        onValueChange={setTab}
        items={[
          'import',
          'request',
          'schemas',
          'mapping',
          'resilience',
          'mocks',
          'console',
          'profiles',
        ].map((value) => ({
          value,
          label: t(`designer.integrations.tabs.${value}`),
          content: (
            <fieldset
              disabled={(value === 'profiles' ? false : !editable) || busy}
              className={`ig-stack ig-panel ig-panel-${value}`}
            >
              {value === 'import' && (
                <ImportWizard
                  initial={initial}
                  draft={draft}
                  patch={patch}
                  onProtocol={(protocol) => {
                    setDraft({
                      ...draft,
                      protocol,
                      definition: {
                        ...withoutSql(draft.definition),
                        method: protocol === 'rest' ? 'GET' : 'POST',
                        ...(protocol === 'sql' ? sqlDefinitionPatch(emptySqlForm()) : {}),
                        ...(protocol === 'soap'
                          ? {
                              soap: {
                                namespace: '',
                                operation: '',
                                action: '',
                              },
                            }
                          : {}),
                        ...(protocol === 'graphql'
                          ? {
                              graphql: {
                                query: 'query { __typename }',
                                maxDepth: 8,
                                maxComplexity: 200,
                              },
                            }
                          : {}),
                      },
                    });
                  }}
                />
              )}
              {value === 'request' && (
                <>
                  <Input
                    label={t('designer.integrations.key')}
                    value={draft.key}
                    readOnly={Boolean(initial)}
                    onChange={(e) => {
                      setDraft({ ...draft, key: e.target.value });
                    }}
                  />
                  <Select
                    label={t('designer.integrations.protocol')}
                    value={draft.protocol}
                    options={['rest', 'soap', 'graphql', 'sql'].map((value) => ({
                      value,
                      label: t(`designer.integrations.protocols.${value}`),
                    }))}
                    onValueChange={(protocol) => {
                      const type = IntegrationSaveSchema.shape.protocol.parse(protocol);
                      setDraft({
                        ...draft,
                        protocol: type,
                        definition: {
                          ...withoutSql(draft.definition),
                          method: type === 'rest' ? 'GET' : 'POST',
                          ...(type === 'sql' ? sqlDefinitionPatch(emptySqlForm()) : {}),
                          ...(type === 'soap'
                            ? {
                                soap: {
                                  namespace: '',
                                  operation: '',
                                  action: '',
                                },
                              }
                            : {}),
                          ...(type === 'graphql'
                            ? {
                                graphql: {
                                  query: 'query { __typename }',
                                  maxDepth: 8,
                                  maxComplexity: 200,
                                },
                              }
                            : {}),
                        },
                      });
                    }}
                  />
                  {draft.protocol === 'sql' ? (
                    <SqlEditor
                      value={sqlFormOf(draft.definition)}
                      change={(_form, definitionPatch) => {
                        patch(definitionPatch);
                      }}
                    />
                  ) : (
                    <>
                      <Select
                        label={t('designer.integrations.method')}
                        value={draft.definition.method}
                        options={['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({
                          value,
                          label: value,
                        }))}
                        onValueChange={(method) => {
                          patch({ method: IntegrationDefinitionSchema.shape.method.parse(method) });
                        }}
                      />
                      <Input
                        label={t('designer.integrations.baseUrl')}
                        placeholder="https://api.example.com"
                        value={draft.definition.baseUrl}
                        onChange={(e) => {
                          patch({ baseUrl: e.target.value });
                        }}
                      />
                      <Input
                        label={t('designer.integrations.endpoint')}
                        value={draft.definition.endpoint}
                        onChange={(e) => {
                          patch({ endpoint: e.target.value });
                        }}
                      />
                      <p>{t('designer.integrations.templateHelp')}</p>
                      <KeyValueField
                        label={t('designer.integrations.headers')}
                        keyLabel={t('designer.integrations.forms.headerName')}
                        valueLabel={t('designer.integrations.forms.headerValue')}
                        keyError={(key) =>
                          RESERVED_HEADER.test(key)
                            ? t('designer.integrations.forms.reservedHeader')
                            : undefined
                        }
                        value={draft.definition.headers}
                        change={(value) => {
                          patch({ headers: z.record(z.string(), z.string()).parse(value) });
                        }}
                      />
                      <KeyValueField
                        label={t('designer.integrations.query')}
                        keyLabel={t('designer.integrations.forms.queryName')}
                        valueLabel={t('designer.integrations.forms.queryValue')}
                        value={draft.definition.query}
                        change={(value) => {
                          patch({ query: z.record(z.string(), z.string()).parse(value) });
                        }}
                      />
                      {!['GET', 'HEAD'].includes(draft.definition.method) && (
                        <BodyField
                          value={draft.definition.body}
                          onChange={(body) => {
                            patch({ body });
                          }}
                        />
                      )}
                      <AuthEditor
                        value={draft.definition.auth}
                        change={(auth) => {
                          patch({ auth });
                        }}
                      />
                      {draft.protocol === 'soap' && (
                        <fieldset className="ig-schema">
                          <legend>{t('designer.integrations.soap')}</legend>
                          {(['namespace', 'operation', 'action'] as const).map((field) => (
                            <Input
                              key={field}
                              label={t(`designer.integrations.forms.soap.${field}`)}
                              value={draft.definition.soap?.[field] ?? ''}
                              onChange={(e) => {
                                patch({
                                  soap: {
                                    namespace: draft.definition.soap?.namespace ?? '',
                                    operation: draft.definition.soap?.operation ?? '',
                                    action: draft.definition.soap?.action ?? '',
                                    [field]: e.target.value,
                                  },
                                });
                              }}
                            />
                          ))}
                        </fieldset>
                      )}
                      {draft.protocol === 'graphql' && (
                        <>
                          <Textarea
                            label={t('designer.integrations.graphqlQuery')}
                            value={draft.definition.graphql?.query ?? ''}
                            onChange={(e) => {
                              patch({
                                graphql: {
                                  query: e.target.value,
                                  maxDepth: draft.definition.graphql?.maxDepth ?? 8,
                                  maxComplexity: draft.definition.graphql?.maxComplexity ?? 200,
                                },
                              });
                            }}
                          />
                          {(['maxDepth', 'maxComplexity'] as const).map((limit) => (
                            <Input
                              key={limit}
                              type="number"
                              min={1}
                              max={limit === 'maxDepth' ? 20 : 5000}
                              label={t(`designer.integrations.forms.${limit}`)}
                              value={
                                draft.definition.graphql?.[limit] ??
                                (limit === 'maxDepth' ? 8 : 200)
                              }
                              onChange={(e) => {
                                patch({
                                  graphql: {
                                    query: draft.definition.graphql?.query ?? '',
                                    maxDepth: draft.definition.graphql?.maxDepth ?? 8,
                                    maxComplexity: draft.definition.graphql?.maxComplexity ?? 200,
                                    [limit]: Number(e.target.value),
                                  },
                                });
                              }}
                            />
                          ))}
                        </>
                      )}
                    </>
                  )}
                </>
              )}
              {value === 'schemas' && (
                <SchemaEditor
                  draft={draft}
                  patch={patch}
                  onPolicy={(policy) => {
                    setDraft({ ...draft, policy });
                  }}
                />
              )}
              {value === 'mapping' && (
                <>
                  <MappingEditor
                    sample={draft.definition.mock?.response}
                    value={draft.definition.mapping.response ?? ''}
                    onChange={(response) => {
                      patch({ mapping: { ...draft.definition.mapping, response } });
                    }}
                  />
                  <details className="pv-advanced">
                    <summary>{t('designer.integrations.forms.requestMappingAdvanced')}</summary>
                    <Textarea
                      label={t('designer.integrations.requestMapping')}
                      value={draft.definition.mapping.request ?? ''}
                      onChange={(e) => {
                        patch({
                          mapping: { ...draft.definition.mapping, request: e.target.value },
                        });
                      }}
                    />
                  </details>
                  <Console draft={draft} autoPreview id={initial?.id} disabled={!editable} />
                </>
              )}
              {value === 'resilience' && (
                <>
                  {(
                    [
                      'timeoutMs',
                      'retries',
                      'breakerThreshold',
                      'breakerResetMs',
                      'concurrency',
                      'cacheTtlSeconds',
                      'maxResponseBytes',
                    ] as const
                  ).map((key) => (
                    <Input
                      key={key}
                      label={t(`designer.integrations.policy.${key}`)}
                      type="number"
                      value={draft.policy[key]}
                      onChange={(e) => {
                        setDraft({
                          ...draft,
                          policy: { ...draft.policy, [key]: Number(e.target.value) },
                        });
                      }}
                    />
                  ))}
                  <UrlListField
                    label={t('designer.integrations.allowedOrigins')}
                    help={t('designer.integrations.forms.allowedOriginsHelp')}
                    values={draft.policy.allowedOrigins}
                    onChange={(allowedOrigins) => {
                      setDraft((d) => ({ ...d, policy: { ...d.policy, allowedOrigins } }));
                    }}
                  />
                  <Checkbox
                    label={t('designer.integrations.allowHttp')}
                    checked={draft.policy.allowHttp}
                    onCheckedChange={(allowHttp) => {
                      setDraft({
                        ...draft,
                        policy: { ...draft.policy, allowHttp: allowHttp === true },
                      });
                    }}
                  />
                  <Checkbox
                    label={t('designer.integrations.forms.useFallback')}
                    checked={draft.policy.fallback !== undefined}
                    onCheckedChange={(checked) => {
                      setDraft((d) => {
                        const { fallback: _previous, ...policy } = d.policy;
                        return {
                          ...d,
                          policy:
                            checked === true
                              ? {
                                  ...policy,
                                  fallback: sampleFromSchema(d.definition.outputSchema) ?? {},
                                }
                              : policy,
                        };
                      });
                    }}
                  />
                  {draft.policy.fallback !== undefined && (
                    <SampleDataField
                      label={t('designer.integrations.fallback')}
                      value={draft.policy.fallback}
                      schema={draft.definition.outputSchema}
                      onChange={(fallback) => {
                        setDraft((d) => ({ ...d, policy: { ...d.policy, fallback } }));
                      }}
                    />
                  )}
                  <p>{t('designer.integrations.resilienceHelp')}</p>
                </>
              )}
              {value === 'mocks' && (
                <>
                  <Checkbox
                    label={t('designer.integrations.mockEnabled')}
                    checked={draft.definition.mock?.enabled ?? false}
                    onCheckedChange={(enabled) => {
                      patch({
                        mock: {
                          response: draft.definition.mock?.response ?? {},
                          enabled: enabled === true,
                        },
                      });
                    }}
                  />
                  <SampleDataField
                    label={t('designer.integrations.mockResponse')}
                    value={draft.definition.mock?.response ?? {}}
                    schema={draft.definition.outputSchema}
                    onChange={(response) => {
                      patch({
                        mock: { enabled: draft.definition.mock?.enabled ?? false, response },
                      });
                    }}
                  />
                  <MockScenarios draft={draft} patch={patch} />
                </>
              )}
              {value === 'console' && (
                <Console draft={draft} id={initial?.id} disabled={!editable} />
              )}
              {value === 'profiles' && (
                <Profiles initial={initial} draft={draft} patch={patch} dirty={dirty} />
              )}
            </fieldset>
          ),
        }))}
      />
      <Dialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset();
        }}
        title={t('designer.integrations.unsaved')}
        description={t('designer.integrations.unsavedHelp')}
      >
        <Button
          onClick={() => {
            if (blocker.state === 'blocked') blocker.reset();
          }}
        >
          {t('designer.integrations.stay')}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            if (blocker.state === 'blocked') blocker.proceed();
          }}
        >
          {t('designer.integrations.leave')}
        </Button>
      </Dialog>
      <span className="ig-environment">{environment}</span>
    </section>
  );
}
function ImportWizard({
  initial,
  draft,
  patch,
  onProtocol,
}: {
  onProtocol: (protocol: Draft['protocol']) => void;
  initial?: Record | undefined;
  draft: Draft;
  patch: (value: Partial<IntegrationDefinition>) => void;
}) {
  const { t } = useTranslation(),
    { session, environment } = useWorkspace();
  const [source, setSource] = useState(''),
    [operations, setOperations] = useState<Operation[]>([]),
    [chosen, setChosen] = useState(''),
    [error, setError] = useState(false),
    [schema, setSchema] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  return (
    <>
      <h2>{t('designer.integrations.wizard')}</h2>
      <Select
        label={t('designer.integrations.protocol')}
        value={draft.protocol}
        options={['rest', 'soap', 'graphql', 'sql'].map((value) => ({
          value,
          label: t(`designer.integrations.protocols.${value}`),
        }))}
        onValueChange={(value) => {
          onProtocol(IntegrationSaveSchema.shape.protocol.parse(value));
        }}
      />
      {draft.protocol === 'sql' ? (
        <Alert title={t('designer.integrations.sql.noImport')} tone="info" />
      ) : (
        <>
          <p>{t('designer.integrations.importHelp')}</p>
          <label>
            {t('designer.integrations.file')}
            <input
              type="file"
              accept={draft.protocol === 'soap' ? '.wsdl,.xml' : '.json,.yaml,.yml'}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 1048576) {
                  setError(true);
                  return;
                }
                void file
                  .text()
                  .then(setSource)
                  .catch(() => {
                    setError(true);
                  });
              }}
            />
          </label>
          <Textarea
            label={t('designer.integrations.importSource')}
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
            }}
          />
          <Button
            disabled={
              busy ||
              (draft.protocol !== 'rest' && !initial) ||
              (draft.protocol === 'graphql' && environment === 'prod')
            }
            loading={busy}
            onClick={() => {
              setError(false);
              setBusy(true);
              void (async () => {
                if (draft.protocol === 'rest') {
                  if (source.trim().startsWith('curl')) patch(importCurl(source));
                  else {
                    const { parse } = await import('yaml');
                    const parsed: unknown = parse(source, { maxAliasCount: 0 });
                    setOperations(openApiOperations(parsed));
                  }
                } else if (draft.protocol === 'soap' && initial) {
                  const result = await request(
                    `/v1/data-sources/${initial.id}/wsdl`,
                    z.object({
                      operations: z.array(z.object({ name: z.string(), action: z.string() })),
                      namespace: z.string().optional(),
                    }),
                    { method: 'POST', csrf: session.csrfToken, body: { xml: source } },
                  );
                  setOperations(
                    result.operations.map((operation) => ({
                      key: operation.name,
                      label: operation.name,
                      definition: {
                        soap: {
                          namespace: result.namespace ?? draft.definition.soap?.namespace ?? '',
                          operation: operation.name,
                          action: operation.action,
                        },
                        method: 'POST',
                      },
                    })),
                  );
                } else if (initial && environment !== 'prod')
                  setSchema(
                    await request(`/v1/data-sources/${initial.id}/introspection`, object, {
                      method: 'POST',
                      csrf: session.csrfToken,
                      body: { environment },
                    }),
                  );
              })()
                .catch(() => {
                  setError(true);
                })
                .finally(() => {
                  setBusy(false);
                });
            }}
          >
            {t(
              draft.protocol === 'graphql'
                ? 'designer.integrations.introspect'
                : 'designer.integrations.import',
            )}
          </Button>
          {!initial && draft.protocol !== 'rest' && (
            <Alert title={t('designer.integrations.saveFirst')} tone="info" />
          )}
          {!!operations.length && (
            <Select
              label={t('designer.integrations.operation')}
              value={chosen}
              options={operations.map((o) => ({ value: o.key, label: o.label }))}
              onValueChange={(key) => {
                setChosen(key);
                const value = operations.find((o) => o.key === key);
                if (value) patch(value.definition);
              }}
            />
          )}
          {schema !== null && (
            <details>
              <summary>{t('designer.integrations.forms.introspected')}</summary>
              <pre className="ig-code">{JSON.stringify(schema, null, 2)}</pre>
            </details>
          )}
          {error && <Alert title={t('designer.integrations.importError')} tone="danger" />}
        </>
      )}
    </>
  );
}
function SchemaEditor({
  draft,
  patch,
  onPolicy,
}: {
  draft: Draft;
  patch: (value: Partial<IntegrationDefinition>) => void;
  onPolicy: (value: Draft['policy']) => void;
}) {
  const { t } = useTranslation();
  const [sample, setSample] = useState<unknown>(draft.definition.mock?.response ?? {}),
    [error, setError] = useState(false);
  return (
    <>
      <JsonField
        label={t('designer.integrations.sampleResponse')}
        value={sample}
        change={setSample}
      />
      <Button
        onClick={() => {
          try {
            patch({
              outputSchema: inferSchema(sample),
              mock: { enabled: false, response: sample },
            });
            setError(false);
          } catch {
            setError(true);
          }
        }}
      >
        {t('designer.integrations.infer')}
      </Button>
      <SchemaFieldsEditor
        label={t('designer.integrations.inputSchema')}
        help={t('designer.integrations.forms.inputSchemaHelp')}
        schema={draft.definition.inputSchema}
        onChange={(inputSchema) => {
          patch({ inputSchema });
        }}
      />
      <SchemaFieldsEditor
        label={t('designer.integrations.outputSchema')}
        help={t('designer.integrations.forms.outputSchemaHelp')}
        schema={draft.definition.outputSchema}
        onChange={(outputSchema) => {
          patch({ outputSchema });
        }}
      />
      <Checkbox
        label={t('designer.integrations.containsPii')}
        checked={draft.policy.containsPii}
        onCheckedChange={(containsPii) => {
          onPolicy({ ...draft.policy, containsPii: containsPii === true });
        }}
      />
      {fields(sample).map((path) => (
        <Checkbox
          key={path}
          label={`${t('designer.integrations.pii')} · ${path}`}
          checked={draft.policy.piiPaths.includes(path)}
          onCheckedChange={(checked) => {
            onPolicy({
              ...draft.policy,
              piiPaths: checked
                ? [...new Set([...draft.policy.piiPaths, path])]
                : draft.policy.piiPaths.filter((p) => p !== path),
            });
          }}
        />
      ))}
      {error && <Alert title={t('designer.integrations.invalidJson')} tone="danger" />}
    </>
  );
}
function MockScenarios({
  draft,
  patch,
}: {
  draft: Draft;
  patch: (value: Partial<IntegrationDefinition>) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Button
        onClick={() => {
          patch({
            mockScenarios: [
              ...draft.definition.mockScenarios,
              {
                key: `scenario-${draft.definition.mockScenarios.length + 1}`,
                kind: 'success',
                response: {},
                delayMs: 0,
              },
            ],
          });
        }}
      >
        {t('designer.integrations.addScenario')}
      </Button>
      {draft.definition.mockScenarios.map((scenario, index) => {
        const update = (change: Partial<typeof scenario>) => {
          patch({
            mockScenarios: draft.definition.mockScenarios.map((s, i) =>
              i === index ? { ...s, ...change } : s,
            ),
          });
        };
        return (
          <section key={index} className="ig-card">
            <Input
              label={t('designer.integrations.scenario')}
              value={scenario.key}
              onChange={(e) => {
                update({ key: e.target.value });
              }}
            />
            <Select
              label={t('designer.integrations.scenarioKind')}
              value={scenario.kind}
              options={['success', 'empty', 'error', 'delay'].map((value) => ({
                value,
                label: t(`designer.integrations.scenarios.${value}`),
              }))}
              onValueChange={(value) => {
                update({
                  kind: IntegrationDefinitionSchema.shape.mockScenarios
                    .unwrap()
                    .element.shape.kind.parse(value),
                  ...(value === 'empty' ? { response: [] } : {}),
                });
              }}
            />
            <Input
              type="number"
              min={0}
              max={10000}
              label={t('designer.integrations.delay')}
              value={scenario.delayMs}
              onChange={(e) => {
                update({ delayMs: Number(e.target.value) });
              }}
            />
            <SampleDataField
              label={t('designer.integrations.mockResponse')}
              value={scenario.response}
              schema={draft.definition.outputSchema}
              onChange={(response) => {
                update({ response });
              }}
            />
            <Button
              variant="ghost"
              onClick={() => {
                patch({
                  mockScenarios: draft.definition.mockScenarios.filter((_, i) => i !== index),
                });
              }}
            >
              {t('designer.integrations.remove')}
            </Button>
          </section>
        );
      })}
    </>
  );
}
function Console({
  draft,
  id,
  autoPreview = false,
  disabled,
}: {
  draft: Draft;
  id?: string | undefined;
  autoPreview?: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation(),
    { session, environment } = useWorkspace(),
    ability = useAbility();
  const [input, setInput] = useState<unknown>({}),
    [scenario, setScenario] = useState('default'),
    [history, setHistory] = useState<Trace[]>([]),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [live, setLive] = useState(false),
    [automatic, setAutomatic] = useState(false);
  const requestVersion = useRef(0);
  const inputHost = useRef<HTMLDivElement>(null);
  const run = async (signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    setBusy(true);
    setError(false);
    try {
      if (inputHost.current?.querySelector('[data-json-invalid="true"]'))
        throw new Error('INVALID_JSON');
      const body = IntegrationSaveSchema.parse(draft),
        call = { input, environment, ...(scenario === 'default' ? {} : { scenario }) };
      const trace = await request(
        live && id ? `/v1/data-sources/${id}/test` : '/v1/data-sources/preview',
        IntegrationConsoleSchema,
        {
          method: 'POST',
          csrf: session.csrfToken,
          body: live ? call : { source: body, call },
          ...(signal ? { signal } : {}),
        },
      );
      if (!signal?.aborted && version === requestVersion.current)
        setHistory((h) => [trace, ...h].slice(0, 10));
    } catch {
      if (!signal?.aborted && version === requestVersion.current) setError(true);
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  };
  const content = JSON.stringify({ draft, input, scenario });
  useEffect(() => {
    if (!autoPreview || !automatic || disabled) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void run(abort.signal);
    }, 600);
    return () => {
      clearTimeout(timer);
      abort.abort();
    }; /* latest draft captured by content */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, automatic, autoPreview, disabled]);
  return (
    <>
      <p>{t('designer.integrations.redacted')}</p>
      <div ref={inputHost}>
        <TestInputFields schema={draft.definition.inputSchema} value={input} onChange={setInput} />
      </div>
      <Select
        label={t('designer.integrations.scenario')}
        value={scenario}
        options={['default', ...draft.definition.mockScenarios.map((s) => s.key)].map((value) => ({
          value,
          label: value === 'default' ? t('designer.integrations.forms.defaultScenario') : value,
        }))}
        onValueChange={setScenario}
      />
      {autoPreview ? (
        <Checkbox
          checked={automatic}
          label={t('designer.integrations.livePreview')}
          onCheckedChange={(value) => {
            setAutomatic(value === true);
          }}
        />
      ) : (
        <Checkbox
          label={t('designer.integrations.liveSandbox')}
          disabled={!id || environment === 'prod' || !ability.can('execute', 'Integration')}
          checked={live}
          onCheckedChange={(value) => {
            setLive(value === true);
            setScenario('default');
          }}
        />
      )}
      {live && <Alert title={t('designer.integrations.savedDefinition')} tone="info" />}
      <Button
        loading={busy}
        disabled={disabled || busy}
        onClick={() => {
          void run();
        }}
      >
        {t('designer.integrations.send')}
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          setHistory([]);
        }}
      >
        {t('designer.integrations.clearHistory')}
      </Button>
      {error && <Alert title={t('designer.integrations.testError')} tone="danger" />}
      {history.map((trace, i) => (
        <details key={i} open={i === 0}>
          <summary>
            {t('designer.integrations.duration', { value: trace.durationMs.toFixed(1) })}{' '}
            {t(trace.mock ? 'designer.integrations.mock' : 'designer.integrations.live')} ·{' '}
            {trace.error ?? t('designer.integrations.success')}
          </summary>
          <TraceView trace={trace} />
        </details>
      ))}
    </>
  );
}
function Profiles({
  initial,
  draft,
  patch,
  dirty,
}: {
  initial?: Record | undefined;
  draft: Draft;
  patch: (value: Partial<IntegrationDefinition>) => void;
  dirty: boolean;
}) {
  const { t } = useTranslation(),
    { session } = useWorkspace(),
    ability = useAbility(),
    cache = useQueryClient();
  const [reason, setReason] = useState(''),
    [from, setFrom] = useState('test'),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const refresh = (row: Record) => {
    cache.setQueryData(
      [
        'workspace',
        session.user.tenantId,
        session.user.id,
        session.session.id,
        'integration',
        row.id,
      ],
      row,
    );
  };
  const promote = (approve: boolean) => {
    if (!initial) return;
    setBusy(true);
    setError(false);
    void request(
      `/v1/data-sources/${initial.id}/promotion${approve ? '/approve' : ''}`,
      IntegrationRecordSchema,
      {
        method: 'POST',
        csrf: session.csrfToken,
        ifMatch: `"${initial.version}"`,
        ...(approve ? {} : { body: { from, reason } }),
      },
    )
      .then(refresh)
      .catch(() => {
        setError(true);
      })
      .finally(() => {
        setBusy(false);
        setConfirm(false);
      });
  };
  return (
    <>
      <div className="ig-profile-grid">
        {(['dev', 'test', 'prod'] as const).map((env) => (
          <section className="ig-card" key={env}>
            <h2>{t(`designer.workspace.env.${env}`)}</h2>
            <fieldset disabled={env === 'prod' || !ability.can('update', 'Integration')}>
              <ProfileFields
                value={
                  draft.definition.profiles[env] ?? {
                    baseUrl: draft.definition.baseUrl,
                    auth: draft.definition.auth,
                  }
                }
                onChange={(value) => {
                  if (env === 'prod') return;
                  const parsed = IntegrationProfileSchema.safeParse(value);
                  // A URL is incomplete while typing; keep the text and validate on save.
                  patch({
                    profiles: {
                      ...draft.definition.profiles,
                      [env]: parsed.success ? parsed.data : value,
                    },
                  });
                }}
              />
            </fieldset>
            <Badge>
              {env === 'prod'
                ? t('designer.integrations.approvalRequired')
                : t('designer.integrations.editable')}
            </Badge>
          </section>
        ))}
      </div>
      <Select
        label={t('designer.integrations.promoteFrom')}
        value={from}
        options={['dev', 'test'].map((value) => ({
          value,
          label: t(`designer.workspace.env.${value}`),
        }))}
        onValueChange={setFrom}
      />
      <Input
        label={t('designer.integrations.reason')}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
        }}
      />
      <Button
        loading={busy}
        disabled={!initial || dirty || !reason || !ability.can('update', 'Integration')}
        onClick={() => {
          promote(false);
        }}
      >
        {t('designer.integrations.requestPromotion')}
      </Button>
      {initial?.definition.pendingPromotion && (
        <Alert title={t('designer.integrations.pendingApproval')} tone="warning">
          <p>{initial.definition.pendingPromotion.reason}</p>
          <Button
            disabled={
              dirty ||
              busy ||
              !ability.can('approve', 'Integration') ||
              initial.definition.pendingPromotion.requestedBy === session.user.id
            }
            onClick={() => {
              setConfirm(true);
            }}
          >
            {t('designer.integrations.approve')}
          </Button>
        </Alert>
      )}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('designer.integrations.approve')}
        description={t('designer.integrations.approveHelp')}
      >
        <ProfileSummary value={initial?.definition.pendingPromotion?.profile} />
        <Button
          loading={busy}
          onClick={() => {
            promote(true);
          }}
        >
          {t('designer.integrations.confirmApproval')}
        </Button>
      </Dialog>
      {error && <Alert title={t('designer.integrations.promotionError')} tone="danger" />}
    </>
  );
}
