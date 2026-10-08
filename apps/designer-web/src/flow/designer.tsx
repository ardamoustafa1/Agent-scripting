import {
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  MiniMap,
  Controls,
  Background,
  applyNodeChanges,
  type ReactFlowInstance,
  type Node as CanvasNode,
  type NodeProps,
  type NodeChange,
} from '@xyflow/react';
import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { ruleToExpression } from '@verbis/expr';
import { FlowNodeSchema, type FlowNode, type JsonValue } from '@verbis/script-schema';
import { Button, Badge, Input, Textarea, Select, Alert } from '@verbis/ui';

import { ExpressionEditor } from '../editor/expression-lazy.js';
import { useEditor, type EditorStore } from '../editor/store.js';
import { RuleBuilder } from '../rules/builder.js';
import { ruleFields } from '../rules/fields.js';

import { SubflowImport } from './import-dialog.js';
import { layoutEngine } from './layout-engine.js';
import {
  addFlowNode,
  connectFlow,
  mutateFlow,
  flowProblems,
  flowNodeLabel,
  removeFlowElements,
} from './model.js';

import '@xyflow/react/dist/style.css';
import './styles.css';

function conditionSummary(value: unknown): string {
  try {
    return ruleToExpression(value);
  } catch {
    return '';
  }
}

interface Data extends Record<string, unknown> {
  label: string;
  kind: string;
  problems: readonly string[];
}
type GraphNode = CanvasNode<Data>;
function FlowCard({ data }: NodeProps<GraphNode>) {
  const { t } = useTranslation();
  return (
    <div className="fd-node">
      {data.kind !== 'start' && <Handle type="target" position={Position.Top} />}
      <div className="fd-node-title">
        <Badge>{t(`designer.flow.types.${data.kind}`)}</Badge>
        <strong>{data.label}</strong>
      </div>
      {data['visited'] === true && (
        <Badge tone={data['current'] === true ? 'success' : 'info'}>
          {t(data['current'] === true ? 'designer.preview.current' : 'designer.preview.visited')}
        </Badge>
      )}
      {data.problems.length > 0 && (
        <details className="fd-node-issues">
          <summary>{t('designer.flow.issueCount', { count: data.problems.length })}</summary>
          {data.problems.map((message, i) => (
            <p key={i}>{t(message)}</p>
          ))}
        </details>
      )}
      {data.kind === 'dataSource' ? (
        <>
          <Handle id="success" type="source" position={Position.Bottom} style={{ left: '30%' }} />
          <Handle id="error" type="source" position={Position.Bottom} style={{ left: '70%' }} />
          <div className="fd-ports">
            <span>{t('designer.flow.success')}</span>
            <span>{t('designer.flow.error')}</span>
          </div>
        </>
      ) : data.kind === 'decision' ? (
        <>
          <Handle id="condition" type="source" position={Position.Bottom} style={{ left: '30%' }} />
          <Handle id="else" type="source" position={Position.Bottom} style={{ left: '70%' }} />
          <div className="fd-ports">
            <span>{t('designer.flow.condition')}</span>
            <span>{t('designer.flow.else')}</span>
          </div>
        </>
      ) : data.kind !== 'end' ? (
        <Handle type="source" position={Position.Bottom} />
      ) : null}
    </div>
  );
}
function Annotation({ data }: NodeProps<GraphNode>) {
  return <div className="fd-note">{data.label}</div>;
}
function Group({ data }: NodeProps<GraphNode>) {
  return <div className="fd-group-label">{data.label}</div>;
}
const nodeTypes = { verbis: FlowCard, note: Annotation, group: Group };

export function FlowDesigner({
  store,
  readOnly = false,
  openPage,
  trace,
}: {
  store: EditorStore;
  readOnly?: boolean;
  openPage: (id: string) => void;
  trace?: { nodes: ReadonlySet<string>; edges: ReadonlySet<string>; current?: string | undefined };
}) {
  return (
    <ReactFlowProvider>
      <FlowCanvas
        store={store}
        readOnly={readOnly}
        openPage={openPage}
        {...(trace ? { trace } : {})}
      />
    </ReactFlowProvider>
  );
}
function FlowCanvas({
  store,
  readOnly,
  openPage,
  trace,
}: {
  store: EditorStore;
  readOnly: boolean;
  openPage: (id: string) => void;
  trace?: { nodes: ReadonlySet<string>; edges: ReadonlySet<string>; current?: string | undefined };
}) {
  const state = useEditor(store),
    { t } = useTranslation();
  const [flowId, setFlowId] = useState(state.document.flow.id),
    [selection, setSelection] = useState<readonly string[]>([]),
    [selectedEdge, setEdge] = useState<string | null>(null),
    [temporary, setTemporary] = useState<Map<string, { x: number; y: number }>>(new Map()),
    [layingOut, setLayingOut] = useState(false),
    [connectTarget, setConnectTarget] = useState(''),
    [connectPort, setConnectPort] = useState('condition');
  const layoutVersion = useRef(0);
  const canvas = useRef<Pick<ReactFlowInstance<GraphNode>, 'fitView'> | null>(null);
  const [fitRevision, setFitRevision] = useState(0);
  useEffect(() => {
    if (!fitRevision) return;
    const frame = requestAnimationFrame(() => {
      void canvas.current?.fitView({ padding: 0.2 });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [fitRevision]);
  const flow =
    state.document.flow.id === flowId
      ? state.document.flow
      : (state.document.subflows.find((f) => f.id === flowId) ?? state.document.flow);
  const problems = flowProblems(state.document, flow, store.issues());
  const selected = flow.nodes.find((n) => n.id === selection[0]),
    edge = flow.edges.find((e) => e.id === selectedEdge),
    note = flow.designer?.notes.find((n) => n.id === selection[0]);
  const fields = ruleFields(state.document);
  const groups: GraphNode[] = useMemo(
    () =>
      (flow.designer?.groups ?? []).flatMap((group) => {
        const members = flow.nodes.filter((n) => group.nodes.includes(n.id));
        if (!members.length) return [];
        const positions = members.map((n) => n.position ?? { x: 0, y: 0 });
        const x = Math.min(...positions.map((p) => p.x)) - 24;
        const y = Math.min(...positions.map((p) => p.y)) - 40;
        return [
          {
            id: group.id,
            type: 'group',
            position: temporary.get(group.id) ?? { x, y },
            data: { label: group.label, kind: 'group', problems: [] },
            zIndex: -1,
            style: {
              width: Math.max(...positions.map((p) => p.x)) - x + 244,
              height: Math.max(...positions.map((p) => p.y)) - y + 124,
            },
            selected: selection.includes(group.id),
          },
        ];
      }),
    [flow.designer?.groups, flow.nodes, temporary, selection],
  );
  const traceNodes = trace?.nodes,
    traceCurrent = trace?.current;
  const selectedGroup = flow.designer?.groups.find((g) => g.id === selection[0]);
  const nodes: GraphNode[] = useMemo(
    () =>
      flow.nodes
        .map<GraphNode>((node, index) => ({
          id: node.id,
          type: 'verbis',
          position: temporary.get(node.id) ??
            node.position ?? { x: (index % 3) * 260, y: Math.floor(index / 3) * 160 },
          className: traceNodes?.has(node.id) ? 'fd-visited' : '',
          data: {
            label: flowNodeLabel(state.document, node),
            kind: node.type,
            problems: problems.get(node.id) ?? [],
            visited: traceNodes?.has(node.id) ?? false,
            current: traceCurrent === node.id,
          },
          selected: selection.includes(node.id),
        }))
        .concat(
          (flow.designer?.notes ?? []).map((note) => ({
            id: note.id,
            type: 'note',
            position: temporary.get(note.id) ?? note.position,
            data: { label: note.text, kind: 'note', problems: [] },
            selected: selection.includes(note.id),
          })),
        ),
    [flow, temporary, selection, state.document, problems, traceNodes, traceCurrent],
  );
  const canvasNodes = useMemo(() => [...groups, ...nodes], [groups, nodes]);
  const update = (next: FlowNode) => {
    if (readOnly) return;
    store.execute(() => {
      mutateFlow(store, flow.id, (f) => {
        const index = f.nodes.findIndex((n) => n.id === next.id);
        if (index >= 0) f.nodes[index] = FlowNodeSchema.parse(next);
      });
    });
  };
  const dragChanges = (changes: NodeChange<GraphNode>[]) => {
    const positions = changes.filter((c) => c.type === 'position');
    if (positions.length) {
      const updated = applyNodeChanges(positions, [...groups, ...nodes]);
      setTemporary(new Map(updated.map((n) => [n.id, n.position])));
    }
    const selections = changes.filter((c) => c.type === 'select');
    if (selections.length)
      setSelection((previous) => {
        const next = new Set(previous);
        for (const change of selections) {
          if (change.selected) next.add(change.id);
          else next.delete(change.id);
        }
        const ids = [...next];
        return ids.join('|') === previous.join('|') ? previous : ids;
      });
  };
  const condition =
    edge?.when && '$expr' in edge.when
      ? { $expr: edge.when.$expr }
      : edge?.when && '$rule' in edge.when
        ? (state.document.rules.find(
            (r) =>
              r.id === ('$rule' in (edge.when ?? {}) ? (edge.when as { $rule: string }).$rule : ''),
          )?.when ?? { $expr: 'true' })
        : { $expr: 'true' };
  const remove = () => {
    store.execute(() => {
      removeFlowElements(store, flow.id, selection, selectedEdge);
      setSelection([]);
      setEdge(null);
    });
  };
  return (
    <section className="fd-workspace">
      <div className="fd-tools">
        <SubflowImport store={store} disabled={readOnly} onImported={setFlowId} />
        <Select
          label={t('designer.flow.title')}
          value={flow.id}
          options={[state.document.flow, ...state.document.subflows].map((f) => ({
            value: f.id,
            label: f.name ?? f.id,
          }))}
          onValueChange={(value) => {
            setFlowId(value);
            setSelection([]);
            setEdge(null);
            setTemporary(new Map());
          }}
        />
        {(
          [
            'start',
            'page',
            'decision',
            'dataSource',
            'setVariable',
            'subflow',
            'transfer',
            'end',
          ] as const
        ).map((type) => (
          <Button
            key={type}
            size="sm"
            variant="ghost"
            disabled={
              readOnly ||
              (type === 'dataSource' && !state.document.dataSources.length) ||
              (type === 'setVariable' &&
                !state.document.variables.some((v) => v.scope !== 'global')) ||
              (type === 'subflow' && !state.document.subflows.some((f) => f.id !== flow.id))
            }
            onClick={() => {
              store.execute(() => {
                addFlowNode(store, flow.id, type, `flow-${crypto.randomUUID()}`);
              });
            }}
          >
            {t(`designer.flow.types.${type}`)}
          </Button>
        ))}
        <Button
          disabled={readOnly}
          loading={layingOut}
          onClick={() => {
            const snapshot = store.getSnapshot().document,
              revision = ++layoutVersion.current;
            setLayingOut(true);
            void layoutEngine()
              .then((elk) =>
                elk.layout({
                  id: flow.id,
                  layoutOptions: {
                    'elk.algorithm': 'layered',
                    'elk.direction': 'DOWN',
                    'elk.spacing.nodeNode': '90',
                    'elk.layered.spacing.nodeNodeBetweenLayers': '140',
                    'elk.spacing.edgeNode': '40',
                    'elk.spacing.edgeEdge': '30',
                  },
                  children: flow.nodes.map((n) => ({ id: n.id, width: 220, height: 100 })),
                  edges: flow.edges.map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
                }),
              )
              .then((graph) => {
                if (layoutVersion.current !== revision || store.getSnapshot().document !== snapshot)
                  return;
                mutateFlow(store, flow.id, (f) => {
                  for (const child of graph.children ?? []) {
                    const node = f.nodes.find((n) => n.id === child.id);
                    if (node) node.position = { x: child.x ?? 0, y: child.y ?? 0 };
                  }
                });
                setTemporary(new Map());
                setFitRevision((previous) => previous + 1);
              })
              .catch(() => {
                store.execute(() => {
                  throw new Error('VERBIS_LAYOUT');
                });
              })
              .finally(() => {
                setLayingOut(false);
              });
          }}
        >
          {t('designer.flow.layout')}
        </Button>
        <Button
          disabled={readOnly}
          onClick={() => {
            store.execute(() => {
              mutateFlow(store, flow.id, (f) => {
                f.designer ??= { groups: [], notes: [] };
                f.designer.notes.push({
                  id: `note-${crypto.randomUUID()}`,
                  text: t('designer.flow.newNote'),
                  position: { x: 50, y: 50 },
                });
              });
            });
          }}
        >
          {t('designer.flow.note')}
        </Button>
        <Button
          disabled={readOnly || selection.length < 2}
          onClick={() => {
            store.execute(() => {
              mutateFlow(store, flow.id, (f) => {
                f.designer ??= { groups: [], notes: [] };
                for (const g of f.designer.groups)
                  g.nodes = g.nodes.filter((id) => !selection.includes(id));
                f.designer.groups.push({
                  id: `group-${crypto.randomUUID()}`,
                  label: t('designer.flow.group'),
                  nodes: [...selection].filter((id) => f.nodes.some((n) => n.id === id)),
                });
              });
            });
          }}
        >
          {t('designer.flow.group')}
        </Button>
        <Button
          disabled={readOnly || (!selection.length && !selectedEdge)}
          variant="ghost"
          onClick={remove}
        >
          {t('designer.editor.delete')}
        </Button>
      </div>
      <div className="fd-body">
        <ReactFlow
          nodes={canvasNodes}
          edges={flow.edges.map((e) => ({
            id: e.id,
            source: e.from,
            target: e.to,
            sourceHandle:
              e.port ??
              (flow.nodes.find((n) => n.id === e.from)?.type === 'decision'
                ? e.default
                  ? 'else'
                  : 'condition'
                : null),
            label: e.default
              ? t('designer.flow.else')
              : e.port
                ? t(`designer.flow.${e.port}`)
                : e.when && '$expr' in e.when
                  ? e.when.$expr
                  : e.when && '$rule' in e.when
                    ? conditionSummary(
                        state.document.rules.find(
                          (r) => r.id === (e.when && '$rule' in e.when ? e.when.$rule : ''),
                        )?.when ?? { $expr: 'true' },
                      )
                    : '',
            selected: e.id === selectedEdge,
            className: trace?.edges.has(e.id) ? 'fd-visited-edge' : '',
            style: trace?.edges.has(e.id)
              ? { strokeWidth: 3, stroke: 'var(--vb-color-primary)' }
              : {},
          }))}
          nodeTypes={nodeTypes}
          onInit={(instance) => {
            canvas.current = instance;
          }}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          edgesReconnectable={false}
          deleteKeyCode={null}
          onKeyDownCapture={(event) => {
            const delta = {
              ArrowLeft: [-5, 0],
              ArrowRight: [5, 0],
              ArrowUp: [0, -5],
              ArrowDown: [0, 5],
            }[event.key];
            if (
              readOnly ||
              !delta ||
              !(event.target instanceof HTMLElement) ||
              !event.target.classList.contains('react-flow__node')
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            store.execute(() => {
              mutateFlow(store, flow.id, (f) => {
                const memberIds = new Set(selection);
                for (const group of f.designer?.groups ?? [])
                  if (selection.includes(group.id)) for (const id of group.nodes) memberIds.add(id);
                for (const node of f.nodes)
                  if (memberIds.has(node.id))
                    node.position = {
                      x: (node.position?.x ?? 0) + (delta[0] ?? 0),
                      y: (node.position?.y ?? 0) + (delta[1] ?? 0),
                    };
                for (const note of f.designer?.notes ?? [])
                  if (selection.includes(note.id))
                    note.position = {
                      x: note.position.x + (delta[0] ?? 0),
                      y: note.position.y + (delta[1] ?? 0),
                    };
              });
            });
          }}
          onNodesChange={dragChanges}
          onNodeClick={() => {
            setEdge(null);
          }}
          onEdgeClick={(_, edge) => {
            setEdge(edge.id);
            setSelection([]);
          }}
          onNodeDoubleClick={(_, node) => {
            const flowNode = flow.nodes.find((n) => n.id === node.id);
            if (flowNode?.type === 'page') openPage(flowNode.page);
          }}
          onNodeDragStop={(_, node, dragged) => {
            if (readOnly) return;
            store.execute(() => {
              mutateFlow(store, flow.id, (f) => {
                for (const changed of dragged.length ? dragged : [node]) {
                  const actual = f.nodes.find((n) => n.id === changed.id),
                    note = f.designer?.notes.find((n) => n.id === changed.id);
                  const group = f.designer?.groups.find((g) => g.id === changed.id);
                  if (group) {
                    const members = f.nodes.filter((n) => group.nodes.includes(n.id));
                    const before = members.length
                      ? {
                          x: Math.min(...members.map((n) => n.position?.x ?? 0)) - 24,
                          y: Math.min(...members.map((n) => n.position?.y ?? 0)) - 40,
                        }
                      : undefined;
                    if (before)
                      for (const member of f.nodes.filter((n) => group.nodes.includes(n.id))) {
                        const previous = member.position ?? { x: 0, y: 0 };
                        member.position = {
                          x: previous.x + changed.position.x - before.x,
                          y: previous.y + changed.position.y - before.y,
                        };
                      }
                  }
                  if (actual) actual.position = changed.position;
                  if (note) note.position = changed.position;
                }
              });
            });
            setTemporary(new Map());
          }}
          onConnect={(connection) => {
            if (!readOnly && connection.source && connection.target)
              store.execute(() => {
                connectFlow(
                  store,
                  flow.id,
                  connection.source,
                  connection.target,
                  connection.sourceHandle,
                  `edge-${crypto.randomUUID()}`,
                );
              });
          }}
          ariaLabelConfig={{
            'node.a11yDescription.default': t('designer.flow.a11yNode'),
            'node.a11yDescription.keyboardDisabled': t('designer.flow.a11yNode'),
            'node.a11yDescription.ariaLiveMessage': ({ x, y }) =>
              t('designer.flow.moved', { x, y }),
            'edge.a11yDescription.default': t('designer.flow.a11yEdge'),
            'controls.ariaLabel': t('designer.flow.controls'),
            'controls.zoomIn.ariaLabel': t('designer.flow.zoomIn'),
            'controls.zoomOut.ariaLabel': t('designer.flow.zoomOut'),
            'controls.fitView.ariaLabel': t('designer.flow.fit'),
            'controls.interactive.ariaLabel': t('designer.flow.interactive'),
            'minimap.ariaLabel': t('designer.flow.minimap'),
            'handle.ariaLabel': t('designer.flow.handle'),
          }}
          fitView
          aria-label={t('designer.flow.canvas')}
        >
          <Background color="var(--vb-color-border)" />
          {flow.nodes.length > 1 && (
            <MiniMap nodeColor="var(--vb-color-primary)" maskColor="var(--vb-color-bg)" />
          )}
          <Controls />
        </ReactFlow>
        <aside className="fd-properties">
          <fieldset disabled={readOnly}>
            {selected && (
              <>
                <h3>{t(`designer.flow.types.${selected.type}`)}</h3>
                <code>{selected.id}</code>
                {(['x', 'y'] as const).map((axis) => (
                  <Input
                    key={axis}
                    type="number"
                    label={axis.toUpperCase()}
                    value={selected.position?.[axis] ?? 0}
                    onChange={(event) => {
                      const number = Number(event.target.value);
                      if (Number.isFinite(number))
                        update({
                          ...selected,
                          position: {
                            x: selected.position?.x ?? 0,
                            y: selected.position?.y ?? 0,
                            [axis]: number,
                          },
                        });
                    }}
                  />
                ))}
                <Button
                  variant="ghost"
                  onClick={() => {
                    store.execute(() => {
                      mutateFlow(store, flow.id, (f) => {
                        f.start = selected.id;
                      });
                    });
                  }}
                >
                  {t('designer.flow.makeStart')}
                </Button>
                {selected.type !== 'end' && (
                  <>
                    <Select
                      label={t('designer.flow.connectTarget')}
                      value={connectTarget}
                      options={flow.nodes
                        .filter((n) => n.type !== 'start')
                        .map((n) => ({ value: n.id, label: n.id }))}
                      onValueChange={setConnectTarget}
                    />
                    {(selected.type === 'decision' || selected.type === 'dataSource') && (
                      <Select
                        label={t('designer.flow.condition')}
                        value={connectPort}
                        options={(selected.type === 'decision'
                          ? ['condition', 'else']
                          : ['success', 'error']
                        ).map((value) => ({ value, label: t(`designer.flow.${value}`) }))}
                        onValueChange={setConnectPort}
                      />
                    )}
                    <Button
                      disabled={!connectTarget}
                      onClick={() => {
                        if (readOnly) return;
                        store.execute(() => {
                          connectFlow(
                            store,
                            flow.id,
                            selected.id,
                            connectTarget,
                            selected.type === 'dataSource'
                              ? connectPort === 'error'
                                ? 'error'
                                : 'success'
                              : connectPort,
                            `edge-${crypto.randomUUID()}`,
                          );
                        });
                      }}
                    >
                      {t('designer.flow.connect')}
                    </Button>
                  </>
                )}
                {selected.type === 'page' && (
                  <Select
                    label={t('designer.editor.pages')}
                    value={selected.page}
                    options={state.document.pages.map((p) => ({ value: p.id, label: p.name }))}
                    onValueChange={(page) => {
                      update({ ...selected, page });
                    }}
                  />
                )}
                {selected.type === 'dataSource' && (
                  <Select
                    label={t('designer.flow.types.dataSource')}
                    value={selected.dataSource}
                    options={state.document.dataSources.map((d) => ({ value: d.id, label: d.id }))}
                    onValueChange={(dataSource) => {
                      update({ ...selected, dataSource });
                    }}
                  />
                )}
                {selected.type === 'subflow' && (
                  <Select
                    label={t('designer.flow.types.subflow')}
                    value={selected.flow}
                    options={state.document.subflows
                      .filter((f) => f.id !== flow.id)
                      .map((f) => ({ value: f.id, label: f.name ?? f.id }))}
                    onValueChange={(flow) => {
                      update({ ...selected, flow });
                    }}
                  />
                )}
                {selected.type === 'setVariable' && (
                  <>
                    <Select
                      label={t('designer.variables.name')}
                      value={selected.variable}
                      options={state.document.variables
                        .filter((v) => v.scope !== 'global')
                        .map((v) => ({ value: v.key, label: v.key }))}
                      onValueChange={(variable) => {
                        update({ ...selected, variable });
                      }}
                    />
                    <Textarea
                      label={t('designer.rules.value')}
                      defaultValue={JSON.stringify(selected.value)}
                      onBlur={(event) => {
                        store.execute(() => {
                          update({
                            ...selected,
                            value: JSON.parse(event.target.value) as JsonValue,
                          });
                        });
                      }}
                    />
                    <ExpressionEditor
                      value={
                        typeof selected.value === 'object' &&
                        selected.value !== null &&
                        '$expr' in selected.value
                          ? typeof selected.value.$expr === 'string'
                            ? selected.value.$expr
                            : ''
                          : ''
                      }
                      label={t('designer.editor.invalidExpression')}
                      variables={state.document.variables.map((v) => v.key)}
                      onChange={(value) => {
                        if (value) update({ ...selected, value: { $expr: value } });
                      }}
                    />
                  </>
                )}
                {selected.type === 'transfer' && (
                  <Input
                    label={t('designer.flow.target')}
                    value={selected.target}
                    onChange={(e) => {
                      update({ ...selected, target: e.target.value });
                    }}
                  />
                )}
                {selected.type === 'end' &&
                  (['outcome', 'disposition'] as const).map((key) => (
                    <Input
                      key={key}
                      label={t(`designer.flow.${key}`)}
                      value={selected[key] ?? ''}
                      onChange={(e) => {
                        const next = { ...selected };
                        if (e.target.value) next[key] = e.target.value;
                        else if (key === 'outcome') delete next.outcome;
                        else delete next.disposition;
                        update(next);
                      }}
                    />
                  ))}
              </>
            )}
            {edge && (
              <>
                <h3>{t('designer.flow.condition')}</h3>
                {!edge.default && (
                  <RuleBuilder
                    key={edge.id}
                    value={condition}
                    fields={fields}
                    onChange={(value) => {
                      if (readOnly) return;
                      store.execute(() => {
                        store.edit((doc) => {
                          const target = (
                            doc.flow.id === flow.id
                              ? doc.flow
                              : doc.subflows.find((f) => f.id === flow.id)
                          )?.edges.find((e) => e.id === edge.id);
                          if (!target) return;
                          const ruleId = `rule-${edge.id}`;
                          const found = doc.rules.find((r) => r.id === ruleId);
                          if (found) found.when = value;
                          else doc.rules.push({ id: ruleId, when: value, then: [] });
                          target.when = { $rule: ruleId };
                          target.default = false;
                        });
                      });
                    }}
                  />
                )}
                <Input
                  label={t('designer.flow.iterations')}
                  type="number"
                  min={1}
                  max={1000}
                  value={edge.maxIterations ?? ''}
                  onChange={(e) => {
                    store.execute(() => {
                      mutateFlow(store, flow.id, (f) => {
                        const target = f.edges.find((v) => v.id === edge.id);
                        if (target) {
                          if (e.target.value) target.maxIterations = Number(e.target.value);
                          else delete target.maxIterations;
                        }
                      });
                    });
                  }}
                />
              </>
            )}
            {selectedGroup && (
              <Input
                label={t('designer.flow.group')}
                value={selectedGroup.label}
                onChange={(e) => {
                  if (readOnly) return;
                  store.execute(() => {
                    mutateFlow(store, flow.id, (f) => {
                      const group = f.designer?.groups.find((g) => g.id === selectedGroup.id);
                      if (group) group.label = e.target.value;
                    });
                  });
                }}
              />
            )}
            {note && (
              <Textarea
                label={t('designer.flow.note')}
                value={note.text}
                onChange={(e) => {
                  store.execute(() => {
                    mutateFlow(store, flow.id, (f) => {
                      const target = f.designer?.notes.find((n) => n.id === note.id);
                      if (target) target.text = e.target.value;
                    });
                  });
                }}
              />
            )}
            {!selected && !edge && !note && <p>{t('designer.editor.selectHint')}</p>}
            {flow.designer?.groups.map((group) => (
              <div key={group.id}>
                <Badge>{group.label}</Badge>
                <p>{group.nodes.join(', ')}</p>
                <Button
                  variant="ghost"
                  onClick={() => {
                    store.execute(() => {
                      mutateFlow(store, flow.id, (f) => {
                        if (f.designer)
                          f.designer.groups = f.designer.groups.filter((g) => g.id !== group.id);
                      });
                    });
                  }}
                >
                  {t('designer.editor.ungroup')}
                </Button>
              </div>
            ))}
          </fieldset>
          {state.message && <Alert title={t(state.message)} tone="danger" />}
        </aside>
      </div>
    </section>
  );
}
