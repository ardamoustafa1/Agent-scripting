import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  type Node as GraphNode,
  type Edge as GraphEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Runtime,
  ScriptRenderer,
  NodeDecorationContext,
  type NodeDecorationProps,
} from '@verbis/core-runtime';
import type { ScriptDocument } from '@verbis/script-schema';
import { Badge, Select, Tabs, DataTable } from '@verbis/ui';

import { editorRegistry } from '../editor/store.js';

import {
  componentName,
  describePath,
  displayValue,
  edgeName,
  fieldChanges,
  stepName,
  type DiffKind,
} from './diff-text.js';
import { compareNodes, compareItems, type Change } from './diff.js';

function Screen({
  document,
  page,
  changes,
  side,
}: {
  document: ScriptDocument;
  page: string;
  changes: Map<string, Change>;
  side: 'before' | 'after';
}) {
  const { t } = useTranslation();
  const runtime = useMemo(() => {
    const value = new Runtime({
      document,
      registry: editorRegistry,
      simulation: true,
      simulationTimers: false,
      ports: { sessionEvent: () => undefined },
    });
    value.store.set('runtime.page', page);
    return value;
  }, [document, page]);
  useEffect(
    () => () => {
      runtime.dispose();
    },
    [runtime],
  );
  const Decoration = useMemo(
    () =>
      function DiffNode({ node, children }: NodeDecorationProps) {
        const change = changes.get(node.id) ?? 'unchanged';
        return (
          <div className={`lc-diff-node lc-${change}`} data-change={change}>
            <span className="lc-diff-label">
              {componentName(node.type, node.id, t)}{' '}
              {change !== 'unchanged' && (
                <Badge
                  tone={
                    change === 'added' ? 'success' : change === 'removed' ? 'danger' : 'warning'
                  }
                >
                  {t(`designer.lifecycle.${change}`)}
                </Badge>
              )}
            </span>
            {children}
          </div>
        );
      },
    [changes, t],
  );
  return (
    <section aria-label={t(`designer.lifecycle.${side}`)}>
      <h3>{t(`designer.lifecycle.${side}`)}</h3>
      <div className="lc-diff-screen" ref={(element) => element?.setAttribute('inert', '')}>
        <NodeDecorationContext.Provider value={Decoration}>
          <ScriptRenderer runtime={runtime} autoStart={false} />
        </NodeDecorationContext.Provider>
      </div>
    </section>
  );
}
function Flow({
  document,
  other,
  side,
}: {
  document: ScriptDocument;
  other: ScriptDocument;
  side: 'before' | 'after';
}) {
  const { t } = useTranslation();
  const nodes = compareItems(
    side === 'before' ? document.flow.nodes : other.flow.nodes,
    side === 'before' ? other.flow.nodes : document.flow.nodes,
    (v) => v.id,
  );
  const edges = compareItems(
    side === 'before' ? document.flow.edges : other.flow.edges,
    side === 'before' ? other.flow.edges : document.flow.edges,
    (v) => v.id,
  );
  const graphNodes: GraphNode[] = document.flow.nodes.map((node, index) => {
    const change = nodes.find((n) => n.id === node.id)?.change ?? 'unchanged';
    return {
      id: node.id,
      position: node.position ?? { x: (index % 3) * 220, y: Math.floor(index / 3) * 140 },
      className: `lc-${change}`,
      data: {
        label: (
          <>
            <Badge>{t(`designer.flow.types.${node.type}`)}</Badge>
            <strong>{stepName(document, node, t)}</strong>
            {change !== 'unchanged' && <span>{t(`designer.lifecycle.${change}`)}</span>}
          </>
        ),
      },
    };
  });
  const graphEdges: GraphEdge[] = document.flow.edges.map((edge) => {
    const change = edges.find((e) => e.id === edge.id)?.change ?? 'unchanged';
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      ...(change === 'unchanged' ? {} : { label: t(`designer.lifecycle.${change}`) }),
      className: `lc-flow-${change}`,
    };
  });
  return (
    <section aria-label={t(`designer.lifecycle.${side}`)}>
      <h3>{t(`designer.lifecycle.${side}`)}</h3>
      <div className="lc-flow-diff">
        <ReactFlowProvider>
          <ReactFlow
            nodes={graphNodes}
            edges={graphEdges}
            nodesDraggable={false}
            nodesConnectable={false}
            fitView
          >
            <Background />
            <Controls showInteractive={false} />
            <MiniMap />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </section>
  );
}
export function VisualDiff({
  before,
  after,
  patch = [],
}: {
  before: ScriptDocument;
  after: ScriptDocument;
  patch?: { op: 'add' | 'remove' | 'replace'; path: string; value?: unknown }[];
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(after.pages[0]?.id ?? before.pages[0]?.id ?? '');
  const changes = useMemo(() => compareNodes(before, after), [before, after]);
  const pageIds = [...new Set([...before.pages, ...after.pages].map((p) => p.id))];
  const table = (
    rows: ReturnType<typeof compareItems<unknown>>,
    kindOf: (value: unknown) => DiffKind,
    nameOf: (id: string) => string,
  ) => (
    <DataTable
      label={t('designer.lifecycle.diff')}
      data={rows.filter((r) => r.change !== 'unchanged')}
      getRowId={(r) => r.id}
      columns={[
        {
          id: 'id',
          header: t('designer.workspace.name'),
          accessor: (r) => nameOf(r.id),
        },
        {
          id: 'change',
          header: t('designer.lifecycle.diff'),
          accessor: (r) => r.change,
          cell: (r) => (
            <Badge
              tone={
                r.change === 'added' ? 'success' : r.change === 'removed' ? 'danger' : 'warning'
              }
            >
              {t(`designer.lifecycle.${r.change}`)}
            </Badge>
          ),
        },
        {
          id: 'details',
          header: t('designer.lifecycle.diffText.whatChanged'),
          accessor: (r) => r.change,
          cell: (r) => <ChangeDetails row={r} kind={kindOf(r.after ?? r.before)} />,
        },
      ]}
    />
  );
  const flowItems: ReturnType<typeof compareItems<unknown>> = [
    ...compareItems(before.flow.nodes, after.flow.nodes, (v) => v.id),
    ...compareItems(before.flow.edges, after.flow.edges, (v) => v.id),
  ];
  const isEdge = (value: unknown) =>
    value !== null && typeof value === 'object' && 'from' in value && 'to' in value;
  const flowName = (id: string) => {
    const doc =
      after.flow.nodes.some((n) => n.id === id) || after.flow.edges.some((e) => e.id === id)
        ? after
        : before;
    const node = doc.flow.nodes.find((n) => n.id === id);
    if (node) return stepName(doc, node, t);
    const edge = doc.flow.edges.find((e) => e.id === id);
    return edge ? edgeName(doc, edge, t) : id;
  };
  return (
    <Tabs
      label={t('designer.lifecycle.diff')}
      items={[
        {
          value: 'screens',
          label: t('designer.lifecycle.screenDiff'),
          content: (
            <>
              <Select
                label={t('designer.editor.pages')}
                value={page}
                onValueChange={setPage}
                options={pageIds.map((value) => ({
                  value,
                  label:
                    after.pages.find((p) => p.id === value)?.name ??
                    before.pages.find((p) => p.id === value)?.name ??
                    value,
                }))}
              />
              <div className="lc-diff-pair">
                <Screen document={before} page={page} changes={changes} side="before" />
                <Screen document={after} page={page} changes={changes} side="after" />
              </div>
            </>
          ),
        },
        {
          value: 'flow',
          label: t('designer.lifecycle.flowDiff'),
          content: (
            <>
              <div className="lc-diff-pair">
                <Flow document={before} other={after} side="before" />
                <Flow document={after} other={before} side="after" />
              </div>
              {table(flowItems, (value) => (isEdge(value) ? 'edge' : 'flowNode'), flowName)}
            </>
          ),
        },
        {
          value: 'variables',
          label: t('designer.workspace.nav.variables'),
          content: table(
            compareItems(before.variables, after.variables, (v) => v.key),
            () => 'variable',
            (id) => id,
          ),
        },
        {
          value: 'sources',
          label: t('designer.lifecycle.sourceDiff'),
          content: table(
            compareItems(before.dataSources, after.dataSources, (v) => v.id),
            () => 'dataSource',
            (id) => id,
          ),
        },
        {
          value: 'all',
          label: t('designer.lifecycle.jsonDiff'),
          content: (
            <>
              {patch.length === 0 && <p>{t('designer.lifecycle.diffText.noChanges')}</p>}
              <ol className="lc-change-list">
                {patch.map((item, index) => {
                  const change =
                    item.op === 'add' ? 'added' : item.op === 'remove' ? 'removed' : 'changed';
                  return (
                    <li key={`${String(index)}-${item.path}`} className={`lc-${change}`}>
                      <Badge>{t(`designer.lifecycle.${change}`)}</Badge>{' '}
                      {describePath(item.path, item.op === 'remove' ? before : after, t)}
                      {item.op !== 'remove' && <> · {displayValue(item.value, t)}</>}
                    </li>
                  );
                })}
              </ol>
              <details className="pv-advanced">
                <summary>{t('designer.lifecycle.diffText.technical')}</summary>
                <div className="lc-diff-pair">
                  <pre aria-label={t('designer.lifecycle.before')}>
                    {JSON.stringify(before, null, 2)}
                  </pre>
                  <pre aria-label={t('designer.lifecycle.after')}>
                    {JSON.stringify(after, null, 2)}
                  </pre>
                </div>
              </details>
            </>
          ),
        },
      ]}
    />
  );
}

/** What changed in one row: added items in brief, changed fields as "before → after". */
function ChangeDetails({
  row,
  kind,
}: {
  row: { before: unknown; after: unknown; change: Change };
  kind: DiffKind;
}) {
  const { t } = useTranslation();
  if (row.change === 'added' || row.change === 'removed')
    return <span>{t(`designer.lifecycle.diffText.${row.change}`)}</span>;
  const fields = fieldChanges(row.before, row.after, t, kind);
  return (
    <ul className="lc-field-changes">
      {fields.map((field) => (
        <li key={field.field}>
          <strong>{field.field}</strong>
          {': '}
          {t('designer.preview.changedValue', { before: field.before, after: field.after })}
        </li>
      ))}
    </ul>
  );
}
