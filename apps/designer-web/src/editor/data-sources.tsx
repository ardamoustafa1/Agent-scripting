import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import {
  DataSourceRefSchema,
  walkNodes,
  validateSemantics,
  type DataSourceRef,
} from '@verbis/script-schema';
import { Alert, Button, Dialog, Input, Select } from '@verbis/ui';

import { request } from '../api/client.js';
import { JsonField } from '../integrations/json-field.js';
import { useWorkspace } from '../workspace/context.js';

import { useEditor, type EditorStore } from './store.js';

const Sources = z.object({
  data: z.array(
    z.object({ id: z.uuid(), key: z.string(), version: z.int().positive(), protocol: z.string() }),
  ),
  page: z.object({ nextCursor: z.string().nullable() }),
});
export function DataSources({ store }: { store: EditorStore }) {
  const { t } = useTranslation(),
    { session } = useWorkspace(),
    state = useEditor(store);
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState(''),
    [editing, setEditing] = useState<string | null>(null),
    [inputs, setInputs] = useState<DataSourceRef['inputs']>({}),
    [outputs, setOutputs] = useState<DataSourceRef['outputs']>({}),
    [timeout, setTimeout] = useState(5000),
    [error, setError] = useState(false);
  const sources = useInfiniteQuery({
    queryKey: [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      'editor-sources',
      search.trim(),
    ],
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) =>
      request(
        `/v1/data-sources?limit=100${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ''}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        Sources,
        { signal },
      ),
    getNextPageParam: (page) => page.page.nextCursor ?? undefined,
    enabled: open,
  });
  const rows = sources.data?.pages.flatMap((p) => p.data) ?? [];
  const used = new Set<string>();
  walkNodes(state.document, ({ node }) => {
    if (typeof node.props['ds'] === 'string') used.add(node.props['ds']);
    return true;
  });
  for (const flow of [state.document.flow, ...state.document.subflows])
    for (const node of flow.nodes) if (node.type === 'dataSource') used.add(node.dataSource);
  for (const ds of state.document.dataSources) {
    const candidate = structuredClone(state.document);
    candidate.dataSources = candidate.dataSources.filter((row) => row.id !== ds.id);
    if (
      validateSemantics(candidate).some(
        (issue) => issue.code === 'DATASOURCE_REF_BROKEN' && issue.params?.['dataSource'] === ds.id,
      )
    )
      used.add(ds.id);
  }
  const source = rows.find((row) => row.id === selected);
  const reset = () => {
    setSelected('');
    setEditing(null);
    setInputs({});
    setOutputs({});
    setTimeout(5000);
    setError(false);
  };
  const apply = () => {
    if (!source || document.querySelector('[data-json-invalid="true"]')) {
      setError(true);
      return;
    }
    const bound = DataSourceRefSchema.safeParse({
      id: editing ?? source.key.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase()),
      ref: `tenant-datasource:${source.key}`,
      version: source.version,
      inputs,
      outputs,
      policy: {
        ...state.document.dataSources.find((ds) => ds.id === editing)?.policy,
        timeoutMs: timeout,
      },
    });
    if (
      !bound.success ||
      state.document.dataSources.some(
        (ds) => ds.id !== editing && (ds.id === bound.data.id || ds.ref === bound.data.ref),
      )
    ) {
      setError(true);
      return;
    }
    store.execute(() => {
      store.edit((doc) => {
        const index = doc.dataSources.findIndex((ds) => ds.id === editing);
        if (index < 0) doc.dataSources.push(bound.data);
        else doc.dataSources[index] = bound.data;
      });
    });
    reset();
  };
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('designer.editor.manageSources')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('designer.editor.manageSources')}
        description={t('designer.integrations.serverOnly')}
      >
        <section className="ig-stack">
          <ul>
            {state.document.dataSources.map((ds) => (
              <li key={ds.id}>
                <strong>{ds.id}</strong>{' '}
                {t('designer.editor.sourceBindingSummary', { ref: ds.ref, version: ds.version })}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(ds.id);
                    setSelected(
                      rows.find((row) => `tenant-datasource:${row.key}` === ds.ref)?.id ?? '',
                    );
                    setInputs(ds.inputs);
                    setOutputs(ds.outputs);
                    setTimeout(ds.policy.timeoutMs);
                  }}
                >
                  {t('designer.editor.apply')}
                </Button>
                <Button
                  variant="ghost"
                  disabled={used.has(ds.id)}
                  title={used.has(ds.id) ? t('designer.editor.sourceInUse') : undefined}
                  onClick={() => {
                    store.execute(() => {
                      store.edit((doc) => {
                        doc.dataSources = doc.dataSources.filter((row) => row.id !== ds.id);
                      });
                    });
                  }}
                >
                  {t('designer.editor.delete')}
                </Button>
              </li>
            ))}
          </ul>
          {sources.isError && <Alert tone="danger" title={t('designer.editor.sourceLoadFailed')} />}
          <Input
            label={t('designer.integrations.search')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setSelected('');
            }}
          />
          <Select
            label={t('designer.editor.tenantIntegration')}
            value={selected}
            options={rows.map((row) => ({ value: row.id, label: `${row.key} · v${row.version}` }))}
            onValueChange={setSelected}
          />
          {sources.hasNextPage && (
            <Button
              loading={sources.isFetchingNextPage}
              onClick={() => void sources.fetchNextPage()}
            >
              {t('designer.workspace.loadMore')}
            </Button>
          )}
          <p>{t('designer.editor.sourceMappingHint')}</p>
          <JsonField
            label={t('designer.editor.sourceInputs')}
            value={inputs}
            change={(value) => {
              setInputs(DataSourceRefSchema.shape.inputs.parse(value));
            }}
          />
          <JsonField
            label={t('designer.editor.sourceOutputs')}
            value={outputs}
            change={(value) => {
              setOutputs(DataSourceRefSchema.shape.outputs.parse(value));
            }}
          />
          <Input
            type="number"
            min={100}
            max={30000}
            label={t('designer.editor.sourceTimeout')}
            value={timeout}
            onChange={(event) => {
              setTimeout(Number(event.target.value));
            }}
          />
          {error && <Alert tone="danger" title={t('designer.editor.sourceInvalid')} />}
          <Button disabled={!source || state.writeSuspended} onClick={apply}>
            {t(editing ? 'designer.editor.apply' : 'designer.editor.addSource')}
          </Button>
          {editing && (
            <Button variant="ghost" onClick={reset}>
              {t('designer.editor.cancel')}
            </Button>
          )}
        </section>
      </Dialog>
    </>
  );
}
