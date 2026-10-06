import {
  FlowNodeSchema,
  FlowEdgeSchema,
  type FlowNode,
  type Flow,
  type ScriptDocument,
} from '@verbis/script-schema';

import type { EditorStore } from '../editor/store.js';

export function addFlowNode(
  store: EditorStore,
  flowId: string,
  type: FlowNode['type'],
  id: string,
) {
  store.edit((d) => {
    const flow = d.flow.id === flowId ? d.flow : d.subflows.find((f) => f.id === flowId);
    if (!flow) throw new Error('VERBIS_FLOW');
    const common = {
      id,
      type,
      position: { x: 100 + flow.nodes.length * 35, y: 100 + flow.nodes.length * 30 },
    };
    const value =
      type === 'page'
        ? { page: d.pages[0]?.id }
        : type === 'dataSource'
          ? { dataSource: d.dataSources[0]?.id }
          : type === 'setVariable'
            ? { variable: d.variables.find((v) => v.scope !== 'global')?.key, value: null }
            : type === 'subflow'
              ? { flow: d.subflows.find((f) => f.id !== flowId)?.id }
              : type === 'transfer'
                ? { target: 'queue' }
                : {};
    const node = FlowNodeSchema.parse({ ...common, ...value });
    flow.nodes.push(node);
    if (type === 'start') {
      const previous = flow.start;
      flow.start = id;
      flow.edges.push({ id: `edge-${id}`, from: id, to: previous });
    }
  });
}
export function connectFlow(
  store: EditorStore,
  flowId: string,
  from: string,
  to: string,
  port: string | null | undefined,
  id: string,
) {
  store.edit((d) => {
    const flow = d.flow.id === flowId ? d.flow : d.subflows.find((f) => f.id === flowId);
    if (!flow) throw new Error('VERBIS_FLOW');
    const source = flow.nodes.find((n) => n.id === from),
      target = flow.nodes.find((n) => n.id === to);
    if (!source || !target || source.type === 'end' || target.type === 'start')
      throw new Error('VERBIS_FLOW_CONNECTION');
    const edge = FlowEdgeSchema.parse({
      id,
      from,
      to,
      ...(source.type === 'dataSource' ? { port: port ?? 'success' } : {}),
      ...(source.type === 'decision'
        ? { default: port === 'else', ...(port === 'else' ? {} : { when: { $expr: 'true' } }) }
        : {}),
    });
    if (
      source.type === 'decision' &&
      edge.default &&
      flow.edges.some((e) => e.from === from && e.default)
    )
      throw new Error('VERBIS_FLOW_ELSE_DUPLICATE');
    if (
      source.type === 'dataSource' &&
      flow.edges.some((e) => e.from === from && e.port === edge.port)
    )
      throw new Error('VERBIS_FLOW_PORT_DUPLICATE');
    flow.edges.push(edge);
  });
}
export function mutateFlow(store: EditorStore, id: string, work: (flow: Flow) => void) {
  store.edit((d) => {
    const flow = d.flow.id === id ? d.flow : d.subflows.find((f) => f.id === id);
    if (!flow) throw new Error('VERBIS_FLOW');
    work(flow);
  });
}
export function flowProblems(
  document: ScriptDocument,
  flow: Flow,
  issues: ReturnType<EditorStore['issues']>,
) {
  const base =
    flow.id === document.flow.id
      ? '/flow'
      : `/subflows/${document.subflows.findIndex((f) => f.id === flow.id)}`;
  const result = new Map<string, string[]>();
  flow.nodes.forEach((node, index) => {
    const messages = issues
      .filter(
        (i) => i.path === `${base}/nodes/${index}` || i.path.startsWith(`${base}/nodes/${index}/`),
      )
      .map((i) => i.messageKey);
    if (node.type === 'decision' && !flow.edges.some((e) => e.from === node.id && e.default))
      messages.push('designer.flow.missingElse');
    for (const issue of issues) {
      if (issue.code !== 'FLOW_CYCLE' || !issue.path.startsWith(`${base}/edges/`)) continue;
      const edgeIndex = Number(issue.path.slice(`${base}/edges/`.length).split('/')[0]);
      const edge = flow.edges[edgeIndex];
      if (
        (typeof issue.params?.['nodes'] === 'string' &&
          issue.params['nodes'].split(' → ').includes(node.id)) ||
        (edge && (edge.from === node.id || edge.to === node.id))
      )
        messages.push(issue.messageKey);
    }
    if (messages.length) result.set(node.id, [...new Set(messages)]);
  });
  return result;
}

/** Reuse a local screen as a pinned embedded subflow. */
export function createScreenSubflow(store: EditorStore, pageId: string, id: string): void {
  store.edit((doc) => {
    if (!doc.pages.some((page) => page.id === pageId)) throw new Error('VERBIS_FLOW_PAGE');
    doc.subflows.push({
      id,
      name: doc.pages.find((p) => p.id === pageId)?.name ?? pageId,
      start: `${id}-page`,
      nodes: [
        { id: `${id}-page`, type: 'page', page: pageId },
        { id: `${id}-end`, type: 'end' },
      ],
      edges: [{ id: `${id}-edge`, from: `${id}-page`, to: `${id}-end` }],
      limits: { maxSteps: 200 },
    });
  });
}

/** The page title is the recognizable identity of a page node. */
export function flowNodeLabel(document: ScriptDocument, node: FlowNode): string {
  if (node.labelKey) {
    const label = document.i18n.messages[document.i18n.defaultLocale]?.[node.labelKey];
    if (label) return label;
  }
  return node.type === 'page'
    ? (document.pages.find((page) => page.id === node.page)?.name ?? node.id)
    : node.id;
}

/** Delete graph elements and only their unreferenced generated edge rules in one undo step. */
export function removeFlowElements(
  store: EditorStore,
  flowId: string,
  selection: readonly string[],
  edgeId: string | null,
) {
  store.edit((doc) => {
    const flow = doc.flow.id === flowId ? doc.flow : doc.subflows.find((f) => f.id === flowId);
    if (!flow) throw new Error('VERBIS_FLOW');
    if (selection.includes(flow.start)) throw new Error('VERBIS_FLOW_START_IMMUTABLE');
    const removed = flow.edges.filter(
      (edge) => selection.includes(edge.from) || selection.includes(edge.to) || edge.id === edgeId,
    );
    const candidates = new Set(
      removed.flatMap((edge) =>
        edge.when && '$rule' in edge.when && edge.when.$rule === `rule-${edge.id}`
          ? [edge.when.$rule]
          : [],
      ),
    );
    flow.nodes = flow.nodes.filter((node) => !selection.includes(node.id));
    flow.edges = flow.edges.filter((edge) => !removed.includes(edge));
    if (flow.designer) {
      flow.designer.groups = flow.designer.groups.filter((group) => !selection.includes(group.id));
      flow.designer.notes = flow.designer.notes.filter((note) => !selection.includes(note.id));
      for (const group of flow.designer.groups)
        group.nodes = group.nodes.filter((id) => !selection.includes(id));
    }
    const referenced = new Set<string>();
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      const object = value as Record<string, unknown>;
      if (typeof object['$rule'] === 'string') referenced.add(object['$rule']);
      Object.values(object).forEach(visit);
    };
    visit(doc);
    doc.rules = doc.rules.filter((rule) => !candidates.has(rule.id) || referenced.has(rule.id));
  });
}
