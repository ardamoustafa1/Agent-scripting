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
              {node.id}{' '}
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
            <strong>{node.id}</strong>
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
      label: change === 'unchanged' ? edge.id : t(`designer.lifecycle.${change}`),
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
  const table = (rows: ReturnType<typeof compareItems<unknown>>) => (
    <DataTable
      label={t('designer.lifecycle.diff')}
      data={rows.filter((r) => r.change !== 'unchanged')}
      getRowId={(r) => r.id}
      columns={[
        { id: 'id', header: t('designer.workspace.name'), accessor: (r) => r.id },
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
          id: 'before',
          header: t('designer.lifecycle.before'),
          accessor: (r) => JSON.stringify(r.before),
          cell: (r) => <pre>{JSON.stringify(r.before, null, 2)}</pre>,
        },
        {
          id: 'after',
          header: t('designer.lifecycle.after'),
          accessor: (r) => JSON.stringify(r.after),
          cell: (r) => <pre>{JSON.stringify(r.after, null, 2)}</pre>,
        },
      ]}
    />
  );
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
                options={pageIds.map((value) => ({ value, label: value }))}
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
              {table([
                ...compareItems(before.flow.nodes, after.flow.nodes, (v) => v.id),
                ...compareItems(before.flow.edges, after.flow.edges, (v) => v.id),
              ])}
            </>
          ),
        },
        {
          value: 'variables',
          label: t('designer.workspace.nav.variables'),
          content: table(compareItems(before.variables, after.variables, (v) => v.key)),
        },
        {
          value: 'sources',
          label: t('designer.lifecycle.sourceDiff'),
          content: table(compareItems(before.dataSources, after.dataSources, (v) => v.id)),
        },
        {
          value: 'json',
          label: t('designer.lifecycle.jsonDiff'),
          content: (
            <>
              <ol>
                {patch.map((item, index) => (
                  <li
                    key={`${index}-${item.path}`}
                    className={`lc-${item.op === 'add' ? 'added' : item.op === 'remove' ? 'removed' : 'changed'}`}
                  >
                    <Badge>
                      {t(
                        `designer.lifecycle.${item.op === 'add' ? 'added' : item.op === 'remove' ? 'removed' : 'changed'}`,
                      )}
                    </Badge>{' '}
                    <code>{item.path}</code>
                    <pre>{JSON.stringify(item.value, null, 2)}</pre>
                  </li>
                ))}
              </ol>
              <div className="lc-diff-pair">
                <pre>{JSON.stringify(before, null, 2)}</pre>
                <pre>{JSON.stringify(after, null, 2)}</pre>
              </div>
            </>
          ),
        },
      ]}
    />
  );
}
