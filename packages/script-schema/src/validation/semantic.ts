import { BUILTIN_COMPONENT_TYPES, LITERAL_TEXT_PROPS } from '../components.js';
import { utf8ByteLength } from '../json.js';
import { toPointer, type PathSegment } from '../pointer.js';

import { collect, type LocatedReference, type RefContext } from './collect.js';
import { cycles, reachable } from './graph.js';
import { createIssue, type Severity, type ValidationCode, type ValidationIssue } from './issues.js';

import type { ScriptDocument } from '../schema/document.js';
import type { Flow } from '../schema/flow.js';
import type { JsonValue } from '../schema/primitives.js';
import type { Variable } from '../schema/variable.js';

export interface DocumentLimits {
  readonly maxBytes: number;
  readonly maxNodeDepth: number;
  readonly maxNodes: number;
}

/** Document limits (SCRIPT_MODEL §1). */
export const DOCUMENT_LIMITS: DocumentLimits = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxNodeDepth: 32,
  maxNodes: 5_000,
});

/** Fields every data source exposes in addition to its mapped outputs. */
export const DATASOURCE_BUILTIN_FIELDS: readonly string[] = ['status', 'error', 'loading'];

export interface SemanticOptions {
  /** Known component types; defaults to the built-in set. Registry entries are always added. */
  readonly componentTypes?: Iterable<string>;
  readonly literalTextProps?: readonly string[];
  readonly limits?: Partial<DocumentLimits>;
}

type Report = (
  severity: Severity,
  code: ValidationCode,
  path: string,
  params?: Record<string, string | number>,
) => void;

function checkDuplicates(
  report: Report,
  kind: string,
  entries: readonly { id: string; path: readonly PathSegment[] | string }[],
): void {
  const seen = new Set<string>();
  for (const { id, path } of entries) {
    if (seen.has(id))
      report('error', 'DUPLICATE_ID', typeof path === 'string' ? path : toPointer(path), {
        kind,
        id,
      });
    seen.add(id);
  }
}

/** Whether a literal fits the declared variable type. `null` clears any variable. */
export function literalMatchesType(variable: Variable, literal: JsonValue): boolean {
  if (literal === null) return true;
  switch (variable.type) {
    case 'string':
      return typeof literal === 'string';
    case 'number':
      return typeof literal === 'number';
    case 'boolean':
      return typeof literal === 'boolean';
    case 'date':
      return (
        typeof literal === 'string' &&
        !Number.isNaN(Date.parse(literal)) &&
        /^\d{4}-\d{2}-\d{2}/.test(literal)
      );
    case 'enum':
      return typeof literal === 'string' && (variable.enumValues ?? []).includes(literal);
    case 'array':
      return Array.isArray(literal);
    case 'object':
      return typeof literal === 'object' && !Array.isArray(literal);
  }
}

const FLOW_NODE_PATH = /^\/(?:flow|subflows\/(\d+))\/nodes\/(\d+)(?:\/|$)/;

interface FlowAnalysis {
  readonly reachableNodes: ReadonlySet<string>;
}

function analyzeFlow(report: Report, flow: Flow, base: readonly PathSegment[]): FlowAnalysis {
  const ids = new Set(flow.nodes.map((node) => node.id));
  checkDuplicates(
    report,
    'flowNode',
    flow.nodes.map((node, i) => ({ id: node.id, path: [...base, 'nodes', i, 'id'] })),
  );
  checkDuplicates(
    report,
    'flowEdge',
    flow.edges.map((edge, i) => ({ id: edge.id, path: [...base, 'edges', i, 'id'] })),
  );

  if (!ids.has(flow.start))
    report('error', 'FLOW_START_MISSING', toPointer([...base, 'start']), { id: flow.start });

  const outgoing = new Map<string, string[]>();
  const validEdges = flow.edges.filter((edge, i) => {
    for (const end of ['from', 'to'] as const) {
      if (!ids.has(edge[end])) {
        report('error', 'FLOW_EDGE_BROKEN', toPointer([...base, 'edges', i, end]), {
          id: edge[end],
        });
        return false;
      }
    }
    return true;
  });
  for (const edge of validEdges)
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  const successors = (id: string): readonly string[] => outgoing.get(id) ?? [];

  const reachableNodes = ids.has(flow.start)
    ? reachable([flow.start], successors)
    : new Set<string>();

  flow.nodes.forEach((node, i) => {
    const at = toPointer([...base, 'nodes', i]);
    if (ids.has(flow.start) && !reachableNodes.has(node.id))
      report('warning', 'FLOW_NODE_UNREACHABLE', at, { id: node.id });
    if (node.type !== 'end' && successors(node.id).length === 0)
      report('warning', 'FLOW_DEAD_END', at, { id: node.id });
    if (
      node.type === 'dataSource' &&
      !validEdges.some((edge) => edge.from === node.id && edge.port === 'error')
    ) {
      report('warning', 'FLOW_DATASOURCE_NO_ERROR_EDGE', at, { id: node.id });
    }
  });

  for (const component of cycles(
    flow.nodes.map((node) => node.id),
    successors,
  )) {
    const members = new Set(component);
    const inside = flow.edges
      .map((edge, i) => ({ edge, i }))
      .filter(({ edge }) => members.has(edge.from) && members.has(edge.to));
    if (inside.some(({ edge }) => edge.maxIterations !== undefined)) continue;
    const first = inside[0];
    report(
      'error',
      'FLOW_CYCLE',
      toPointer(first === undefined ? base : [...base, 'edges', first.i]),
      {
        flow: flow.id,
        nodes: [...component, component[0] ?? ''].join(' → '),
      },
    );
  }

  return { reachableNodes };
}

/**
 * Checks beyond the zod schema: identity, references, flow graph, reachability, data
 * classification and i18n. Input must already be a parsed `ScriptDocument`.
 */
export function validateSemantics(
  doc: ScriptDocument,
  options: SemanticOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const report: Report = (severity, code, path, params) => {
    issues.push(createIssue(severity, code, path, params));
  };
  const limits = { ...DOCUMENT_LIMITS, ...options.limits };
  const collected = collect(doc, options.literalTextProps ?? LITERAL_TEXT_PROPS);

  // ── Size limits ────────────────────────────────────────────────────────────
  const bytes = utf8ByteLength(JSON.stringify(doc));
  if (bytes > limits.maxBytes)
    report('error', 'DOCUMENT_TOO_LARGE', '', { bytes, max: limits.maxBytes });
  if (collected.nodes.length > limits.maxNodes) {
    report('error', 'NODE_COUNT_EXCEEDED', '/pages', {
      count: collected.nodes.length,
      max: limits.maxNodes,
    });
  }
  for (const visit of collected.nodes) {
    if (visit.depth > limits.maxNodeDepth) {
      report('error', 'NODE_DEPTH_EXCEEDED', visit.path, {
        depth: visit.depth,
        max: limits.maxNodeDepth,
      });
    }
  }

  // ── Identity ───────────────────────────────────────────────────────────────
  checkDuplicates(
    report,
    'page',
    doc.pages.map((page, i) => ({ id: page.id, path: ['pages', i, 'id'] })),
  );
  checkDuplicates(
    report,
    'node',
    collected.nodes.map((visit) => ({ id: visit.node.id, path: `${visit.path}/id` })),
  );
  checkDuplicates(
    report,
    'variable',
    doc.variables.map((variable, i) => ({ id: variable.key, path: ['variables', i, 'key'] })),
  );
  checkDuplicates(
    report,
    'dataSource',
    doc.dataSources.map((ds, i) => ({ id: ds.id, path: ['dataSources', i, 'id'] })),
  );
  checkDuplicates(
    report,
    'rule',
    doc.rules.map((rule, i) => ({ id: rule.id, path: ['rules', i, 'id'] })),
  );
  checkDuplicates(report, 'flow', [
    { id: doc.flow.id, path: ['flow', 'id'] },
    ...doc.subflows.map((sub, i) => ({ id: sub.id, path: ['subflows', i, 'id'] })),
  ]);
  checkDuplicates(
    report,
    'timer',
    doc.pages.flatMap((page, p) =>
      page.timers.map((timer, t) => ({ id: timer.id, path: ['pages', p, 'timers', t, 'id'] })),
    ),
  );

  // ── Indexes ────────────────────────────────────────────────────────────────
  const variables = new Map(doc.variables.map((variable) => [variable.key, variable]));
  const dataSources = new Map(doc.dataSources.map((ds) => [ds.id, ds]));
  const pages = new Set(doc.pages.map((page) => page.id));
  const rules = new Set(doc.rules.map((rule) => rule.id));
  const subflows = new Set(doc.subflows.map((sub) => sub.id));
  const timers = new Set(doc.pages.flatMap((page) => page.timers.map((timer) => timer.id)));
  const nodeIds = new Set(collected.nodes.map((visit) => visit.node.id));
  const componentTypes = new Set([
    ...(options.componentTypes ?? BUILTIN_COMPONENT_TYPES),
    ...doc.componentRegistry.map((entry) => entry.type),
  ]);
  const defaultMessages = doc.i18n.messages[doc.i18n.defaultLocale];

  // ── Variables ──────────────────────────────────────────────────────────────
  doc.variables.forEach((variable, i) => {
    const at = (field: string): string => toPointer(['variables', i, field]);
    if (variable.type === 'enum' && variable.enumValues === undefined) {
      report('error', 'VARIABLE_ENUM_VALUES_MISSING', at('enumValues'), { variable: variable.key });
    }
    if (variable.default !== undefined && !literalMatchesType(variable, variable.default)) {
      report('error', 'VARIABLE_TYPE_MISMATCH', at('default'), {
        variable: variable.key,
        type: variable.type,
      });
    }
    if (variable.classification === 'pci' && variable.persist) {
      report('error', 'VARIABLE_PCI_PERSISTED', at('persist'), { variable: variable.key });
    }
    const sensitive = variable.classification === 'pii' || variable.classification === 'pci';
    if (sensitive !== variable.pii) {
      report('warning', 'VARIABLE_CLASSIFICATION_MISMATCH', at('pii'), {
        variable: variable.key,
        classification: variable.classification,
      });
    }
  });

  // ── Components, bindings, literal text ────────────────────────────────────
  for (const visit of collected.nodes) {
    if (!componentTypes.has(visit.node.type)) {
      report('error', 'COMPONENT_TYPE_UNKNOWN', `${visit.path}/type`, {
        id: visit.node.id,
        type: visit.node.type,
      });
    }
    if (visit.node.type === 'explicitConsent') {
      const binding = visit.node.bindings.find((entry) => entry.prop === 'value');
      const preselected =
        visit.node.props['value'] === true ||
        visit.node.props['checked'] === true ||
        (binding && ('expression' in binding || variables.get(binding.variable)?.default === true));
      if (preselected)
        report('error', 'CONSENT_PRESELECTED', `${visit.path}/bindings`, { id: visit.node.id });
    }
    const props = new Set<string>();
    visit.node.bindings.forEach((binding, i) => {
      if (props.has(binding.prop)) {
        report('error', 'BINDING_DUPLICATE_PROP', `${visit.path}/bindings/${i}/prop`, {
          id: visit.node.id,
          prop: binding.prop,
        });
      }
      props.add(binding.prop);
    });
  }
  for (const { path, prop } of collected.literalText)
    report('error', 'I18N_LITERAL_TEXT', path, { prop });

  // ── Flows ──────────────────────────────────────────────────────────────────
  const flowAnalyses = [
    analyzeFlow(report, doc.flow, ['flow']),
    ...doc.subflows.map((sub, i) => analyzeFlow(report, sub, ['subflows', i])),
  ];
  const flowsInOrder = [doc.flow, ...doc.subflows];

  /** Flow-node references only count for reachability when the flow node itself is reachable. */
  const isLive = (ref: LocatedReference): boolean => {
    const match = FLOW_NODE_PATH.exec(ref.path);
    if (match === null) return true;
    const flowIndex = match[1] === undefined ? 0 : Number(match[1]) + 1;
    const flow = flowsInOrder[flowIndex];
    const node = flow?.nodes[Number(match[2])];
    return node !== undefined && (flowAnalyses[flowIndex]?.reachableNodes.has(node.id) ?? false);
  };

  // ── References ─────────────────────────────────────────────────────────────
  const contextEdges = new Map<RefContext, Set<RefContext>>();
  const link = (from: RefContext, to: RefContext): void => {
    const set = contextEdges.get(from) ?? new Set<RefContext>();
    set.add(to);
    contextEdges.set(from, set);
  };
  const subflowCalls = new Map<string, Set<string>>();

  for (const ref of collected.refs) {
    switch (ref.kind) {
      case 'variableRead':
      case 'variableWrite': {
        const variable = variables.get(ref.id);
        if (variable === undefined) {
          report('error', 'VARIABLE_UNDEFINED', ref.path, { variable: ref.id });
          break;
        }
        if (ref.kind === 'variableWrite') {
          if (variable.scope === 'global')
            report('error', 'VARIABLE_READONLY', ref.path, { variable: ref.id });
          if (ref.literal !== undefined && !literalMatchesType(variable, ref.literal)) {
            report('error', 'VARIABLE_TYPE_MISMATCH', ref.path, {
              variable: ref.id,
              type: variable.type,
            });
          }
        } else if (ref.sink !== undefined) {
          if (variable.classification === 'pci') {
            report('error', 'SENSITIVE_DATA_EXPOSED', ref.path, {
              variable: ref.id,
              sink: ref.sink,
              classification: 'pci',
            });
          } else if (
            variable.classification === 'pii' &&
            (ref.sink === 'log' || ref.sink === 'analytics')
          ) {
            report('warning', 'SENSITIVE_DATA_EXPOSED', ref.path, {
              variable: ref.id,
              sink: ref.sink,
              classification: 'pii',
            });
          }
        }
        break;
      }
      case 'page':
        if (!pages.has(ref.id)) report('error', 'PAGE_REF_BROKEN', ref.path, { page: ref.id });
        else if (isLive(ref)) link(ref.context, `page:${ref.id}`);
        break;
      case 'dataSource': {
        const ds = dataSources.get(ref.id);
        if (ds === undefined)
          report('error', 'DATASOURCE_REF_BROKEN', ref.path, { dataSource: ref.id });
        else if (
          ref.field !== undefined &&
          !(ref.field in ds.outputs) &&
          !DATASOURCE_BUILTIN_FIELDS.includes(ref.field)
        ) {
          report('error', 'DATASOURCE_FIELD_UNKNOWN', ref.path, {
            dataSource: ref.id,
            field: ref.field,
          });
        }
        break;
      }
      case 'rule':
        if (!rules.has(ref.id)) report('error', 'RULE_REF_BROKEN', ref.path, { rule: ref.id });
        break;
      case 'subflow':
        if (!subflows.has(ref.id)) {
          report('error', 'SUBFLOW_REF_BROKEN', ref.path, { flow: ref.id });
          break;
        }
        if (isLive(ref)) link(ref.context, `flow:${ref.id}`);
        if (ref.context.startsWith('flow:')) {
          const caller = ref.context.slice('flow:'.length);
          subflowCalls.set(caller, (subflowCalls.get(caller) ?? new Set()).add(ref.id));
        }
        break;
      case 'timer':
        if (!timers.has(ref.id)) report('error', 'TIMER_REF_BROKEN', ref.path, { timer: ref.id });
        break;
      case 'node':
        if (!nodeIds.has(ref.id)) report('error', 'NODE_REF_BROKEN', ref.path, { node: ref.id });
        break;
      case 'i18n':
        if (defaultMessages !== undefined && !(ref.id in defaultMessages)) {
          report('error', 'I18N_KEY_MISSING', ref.path, {
            key: ref.id,
            locale: doc.i18n.defaultLocale,
          });
        }
        break;
    }
  }

  // ── Subflow recursion ──────────────────────────────────────────────────────
  for (const component of cycles(
    doc.subflows.map((sub) => sub.id),
    (id) => [...(subflowCalls.get(id) ?? [])],
  )) {
    const index = doc.subflows.findIndex((sub) => sub.id === component[0]);
    report('error', 'SUBFLOW_CYCLE', toPointer(['subflows', index]), {
      flows: [...component, component[0] ?? ''].join(' → '),
    });
  }

  // ── Page reachability ──────────────────────────────────────────────────────
  const reached = reachable<RefContext>(
    [`flow:${doc.flow.id}`, 'rules'],
    (context) => contextEdges.get(context) ?? [],
  );
  doc.pages.forEach((page, i) => {
    if (!reached.has(`page:${page.id}`))
      report('warning', 'PAGE_UNREACHABLE', toPointer(['pages', i]), { page: page.id });
  });

  // ── i18n completeness ──────────────────────────────────────────────────────
  if (defaultMessages === undefined) {
    report('error', 'I18N_DEFAULT_LOCALE_MISSING', '/i18n/defaultLocale', {
      locale: doc.i18n.defaultLocale,
    });
  } else {
    for (const [locale, messages] of Object.entries(doc.i18n.messages)) {
      if (locale === doc.i18n.defaultLocale) continue;
      const missing = Object.keys(defaultMessages).filter((key) => !(key in messages));
      if (missing.length > 0) {
        report('warning', 'I18N_TRANSLATION_MISSING', toPointer(['i18n', 'messages', locale]), {
          locale,
          count: missing.length,
          keys: missing.slice(0, 10).join(', '),
        });
      }
    }
  }

  const scenarioIds = new Set<string>();
  for (const [index, scenario] of (doc.testScenarios ?? []).entries()) {
    const path = `/testScenarios/${index}`;
    if (scenarioIds.has(scenario.id)) report('error', 'SCENARIO_INVALID', path);
    scenarioIds.add(scenario.id);
    const keys = [
      ...Object.keys(scenario.context.variables),
      ...Object.keys(scenario.expected.variables),
      ...scenario.steps.flatMap((step) => (step.type === 'variable' ? [step.variable] : [])),
    ];
    for (const key of keys) {
      const variable = doc.variables.find((v) => v.key === key);
      if (!variable) report('error', 'SCENARIO_INVALID', path);
      else if (variable.pii || ['pii', 'pci'].includes(variable.classification))
        report('error', 'SCENARIO_SENSITIVE', path);
    }
    const scan = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (
        'type' in value &&
        value.type === 'setVariable' &&
        'variable' in value &&
        typeof value.variable === 'string'
      ) {
        const variable = doc.variables.find((v) => v.key === value.variable);
        if (!variable) report('error', 'SCENARIO_INVALID', path);
        else if (variable.pii || ['pii', 'pci'].includes(variable.classification))
          report('error', 'SCENARIO_SENSITIVE', path);
      }
      for (const child of Object.values(value)) scan(child);
    };
    scan(scenario.steps);
    if (scenario.expected.page && !doc.pages.some((page) => page.id === scenario.expected.page))
      report('error', 'SCENARIO_INVALID', path);
    if (
      Object.keys(scenario.dataSources).some(
        (id) => !doc.dataSources.some((source) => source.id === id),
      )
    )
      report('error', 'SCENARIO_INVALID', path);
    if (
      scenario.steps.some(
        (step) =>
          (step.type === 'read' || step.type === 'event') &&
          !collected.nodes.some((entry) => entry.node.id === step.node),
      )
    )
      report('error', 'SCENARIO_INVALID', path);
  }
  return issues;
}
