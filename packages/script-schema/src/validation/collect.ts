import { toPointer, type PathSegment } from '../pointer.js';

import { scanExpression } from './references.js';

import type { Action } from '../schema/actions.js';
import type { ScriptDocument } from '../schema/document.js';
import type { Flow } from '../schema/flow.js';
import type { Node } from '../schema/node.js';
import type { Condition, JsonValue, Value } from '../schema/primitives.js';
import type { Predicate } from '../schema/rule.js';

/** Where a reference lives, for reachability: a page, a flow, or the global rule set. */
export type RefContext = `page:${string}` | `flow:${string}` | 'rules';

/** A data sink with stricter rules for classified variables. */
export type Sink = 'log' | 'analytics' | 'platform' | 'display';

export type Reference =
  | { kind: 'variableRead'; id: string; sink?: Sink }
  | { kind: 'variableWrite'; id: string; literal?: JsonValue }
  | { kind: 'page'; id: string }
  | { kind: 'dataSource'; id: string; field?: string }
  | { kind: 'rule'; id: string }
  | { kind: 'subflow'; id: string }
  | { kind: 'timer'; id: string }
  | { kind: 'node'; id: string }
  | { kind: 'i18n'; id: string };

export type LocatedReference = Reference & { readonly path: string; readonly context: RefContext };

export interface NodeVisit {
  readonly node: Node;
  readonly path: string;
  readonly depth: number;
  readonly pageId: string;
}

export interface Collected {
  readonly refs: LocatedReference[];
  readonly nodes: NodeVisit[];
  /** Node props holding literal display text: `[path, prop]`. */
  readonly literalText: { path: string; prop: string }[];
}

interface Ctx {
  readonly context: RefContext;
  readonly out: Collected;
  readonly literalTextProps: ReadonlySet<string>;
}

const isExpressionRef = (value: unknown): value is { $expr: string } =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && '$expr' in value;

function add(ctx: Ctx, path: readonly PathSegment[], ref: Reference): void {
  ctx.out.refs.push({ ...ref, path: toPointer(path), context: ctx.context });
}

function expression(ctx: Ctx, source: string, path: readonly PathSegment[], sink?: Sink): void {
  const scanned = scanExpression(source);
  for (const id of scanned.variables) {
    add(
      ctx,
      path,
      sink === undefined ? { kind: 'variableRead', id } : { kind: 'variableRead', id, sink },
    );
  }
  for (const ds of scanned.dataSources) {
    add(
      ctx,
      path,
      ds.field === undefined ? { kind: 'dataSource', id: ds.id } : { kind: 'dataSource', ...ds },
    );
  }
}

function value(
  ctx: Ctx,
  input: Value | undefined,
  path: readonly PathSegment[],
  sink?: Sink,
): void {
  if (isExpressionRef(input)) expression(ctx, input.$expr, [...path, '$expr'], sink);
}

function valueMap(
  ctx: Ctx,
  map: Readonly<Record<string, Value>> | undefined,
  path: readonly PathSegment[],
  sink?: Sink,
): void {
  for (const [key, entry] of Object.entries(map ?? {})) value(ctx, entry, [...path, key], sink);
}

function condition(ctx: Ctx, input: Condition | undefined, path: readonly PathSegment[]): void {
  if (input === undefined) return;
  if ('$rule' in input) add(ctx, [...path, '$rule'], { kind: 'rule', id: input.$rule });
  else expression(ctx, input.$expr, [...path, '$expr']);
}

function predicate(ctx: Ctx, input: Predicate, path: readonly PathSegment[]): void {
  if ('all' in input)
    input.all.forEach((child, i) => {
      predicate(ctx, child, [...path, 'all', i]);
    });
  else if ('any' in input)
    input.any.forEach((child, i) => {
      predicate(ctx, child, [...path, 'any', i]);
    });
  else if ('not' in input) predicate(ctx, input.not, [...path, 'not']);
  else if ('fact' in input) expression(ctx, input.fact, [...path, 'fact']);
  else expression(ctx, input.$expr, [...path, '$expr']);
}

function actions(
  ctx: Ctx,
  list: readonly Action[] | undefined,
  path: readonly PathSegment[],
): void {
  (list ?? []).forEach((item, i) => {
    action(ctx, item, [...path, i]);
  });
}

function action(ctx: Ctx, item: Action, path: readonly PathSegment[]): void {
  switch (item.type) {
    case 'setVariable': {
      const isLiteral = !isExpressionRef(item.value);
      add(
        ctx,
        [...path, 'variable'],
        isLiteral
          ? { kind: 'variableWrite', id: item.variable, literal: item.value }
          : { kind: 'variableWrite', id: item.variable },
      );
      value(ctx, item.value, [...path, 'value']);
      return;
    }
    case 'callDataSource':
      add(ctx, [...path, 'dataSource'], { kind: 'dataSource', id: item.dataSource });
      valueMap(ctx, item.inputs, [...path, 'inputs']);
      actions(ctx, item.onSuccess, [...path, 'onSuccess']);
      actions(ctx, item.onError, [...path, 'onError']);
      return;
    case 'navigate':
    case 'openModal':
      add(ctx, [...path, 'page'], { kind: 'page', id: item.page });
      return;
    case 'validatePage':
      if (item.page !== undefined) add(ctx, [...path, 'page'], { kind: 'page', id: item.page });
      actions(ctx, item.onInvalid, [...path, 'onInvalid']);
      return;
    case 'showToast':
      add(ctx, [...path, 'messageKey'], { kind: 'i18n', id: item.messageKey });
      valueMap(ctx, item.params, [...path, 'params'], 'display');
      return;
    case 'submitOutcome':
      value(ctx, item.notes, [...path, 'notes'], 'platform');
      return;
    case 'writeBackToPlatform':
      valueMap(ctx, item.attributes, [...path, 'attributes'], 'platform');
      return;
    case 'transferHint':
      if (item.reasonKey !== undefined)
        add(ctx, [...path, 'reasonKey'], { kind: 'i18n', id: item.reasonKey });
      return;
    case 'runSubflow':
      add(ctx, [...path, 'flow'], { kind: 'subflow', id: item.flow });
      return;
    case 'conditional':
      condition(ctx, item.if, [...path, 'if']);
      actions(ctx, item.then, [...path, 'then']);
      actions(ctx, item.else, [...path, 'else']);
      return;
    case 'sequence':
    case 'parallel':
      actions(ctx, item.actions, [...path, 'actions']);
      return;
    case 'emitEvent':
      valueMap(ctx, item.payload, [...path, 'payload'], 'analytics');
      return;
    case 'startTimer':
    case 'stopTimer':
      add(ctx, [...path, 'timer'], { kind: 'timer', id: item.timer });
      return;
    case 'maskField':
      add(ctx, [...path, 'node'], { kind: 'node', id: item.node });
      return;
    case 'logEvent':
      valueMap(ctx, item.data, [...path, 'data'], 'log');
      return;
    case 'next':
    case 'back':
    case 'closeModal':
    case 'setDisposition':
      return;
  }
}

function node(
  ctx: Ctx,
  input: Node,
  path: readonly PathSegment[],
  depth: number,
  pageId: string,
): void {
  ctx.out.nodes.push({ node: input, path: toPointer(path), depth, pageId });
  for (const [prop, propValue] of Object.entries(input.props)) {
    if (typeof propValue !== 'string') continue;
    if (prop.endsWith('Key') && !['rowKey', 'itemKey', 'iconKey'].includes(prop))
      add(ctx, [...path, 'props', prop], { kind: 'i18n', id: propValue });
    else if (ctx.literalTextProps.has(prop))
      ctx.out.literalText.push({ path: toPointer([...path, 'props', prop]), prop });
  }
  input.bindings.forEach((binding, i) => {
    if ('expression' in binding)
      expression(ctx, binding.expression, [...path, 'bindings', i, 'expression']);
    else
      add(ctx, [...path, 'bindings', i, 'variable'], {
        kind: 'variableWrite',
        id: binding.variable,
      });
  });
  for (const [event, list] of Object.entries(input.events))
    actions(ctx, list, [...path, 'events', event]);
  condition(ctx, input.visibleWhen, [...path, 'visibleWhen']);
  condition(ctx, input.enabledWhen, [...path, 'enabledWhen']);
  condition(ctx, input.requiredWhen, [...path, 'requiredWhen']);
  if (input.a11y?.labelKey !== undefined)
    add(ctx, [...path, 'a11y', 'labelKey'], { kind: 'i18n', id: input.a11y.labelKey });
  if (input.a11y?.descriptionKey !== undefined) {
    add(ctx, [...path, 'a11y', 'descriptionKey'], { kind: 'i18n', id: input.a11y.descriptionKey });
  }
  input.children?.forEach((child, i) => {
    node(ctx, child, [...path, 'children', i], depth + 1, pageId);
  });
}

function flow(ctx: Ctx, input: Flow, path: readonly PathSegment[]): void {
  input.nodes.forEach((flowNode, i) => {
    const at = [...path, 'nodes', i];
    if (flowNode.labelKey !== undefined)
      add(ctx, [...at, 'labelKey'], { kind: 'i18n', id: flowNode.labelKey });
    switch (flowNode.type) {
      case 'transfer':
        if (flowNode.reasonKey)
          add(ctx, [...at, 'reasonKey'], { kind: 'i18n', id: flowNode.reasonKey });
        break;
      case 'page':
        add(ctx, [...at, 'page'], { kind: 'page', id: flowNode.page });
        break;
      case 'dataSource':
        add(ctx, [...at, 'dataSource'], { kind: 'dataSource', id: flowNode.dataSource });
        break;
      case 'setVariable':
        add(
          ctx,
          [...at, 'variable'],
          isExpressionRef(flowNode.value)
            ? { kind: 'variableWrite', id: flowNode.variable }
            : {
                kind: 'variableWrite',
                id: flowNode.variable,
                literal: flowNode.value,
              },
        );
        value(ctx, flowNode.value, [...at, 'value']);
        break;
      case 'subflow':
        add(ctx, [...at, 'flow'], { kind: 'subflow', id: flowNode.flow });
        break;
      case 'decision':
      case 'end':
        break;
    }
  });
  input.edges.forEach((edge, i) => {
    condition(ctx, edge.when, [...path, 'edges', i, 'when']);
  });
}

/**
 * Walks the whole document once and returns every cross-reference with its JSON Pointer and
 * reachability context. Flow-node references inside a flow are attributed to the flow;
 * semantic checks refine them with in-flow reachability.
 */
export function collect(doc: ScriptDocument, literalTextProps: readonly string[]): Collected {
  const out: Collected = { refs: [], nodes: [], literalText: [] };
  const literal = new Set(literalTextProps);
  const at = (context: RefContext): Ctx => ({ context, out, literalTextProps: literal });

  doc.pages.forEach((page, i) => {
    const ctx = at(`page:${page.id}`);
    const base = ['pages', i];
    if (page.titleKey !== undefined)
      add(ctx, [...base, 'titleKey'], { kind: 'i18n', id: page.titleKey });
    node(ctx, page.layout, [...base, 'layout'], 1, page.id);
    actions(ctx, page.onEnter, [...base, 'onEnter']);
    actions(ctx, page.onLeave, [...base, 'onLeave']);
    page.timers.forEach((timer, t) => {
      actions(ctx, timer.onElapsed, [...base, 'timers', t, 'onElapsed']);
    });
  });

  doc.dataSources.forEach((ds, i) => {
    // Inputs are evaluated wherever the data source is called; attribute them to the rule context
    // (always reachable) so they never affect page reachability.
    const ctx = at('rules');
    valueMap(ctx, ds.inputs, ['dataSources', i, 'inputs']);
    for (const [field, output] of Object.entries(ds.outputs)) {
      if (output.variable !== undefined) {
        add(ctx, ['dataSources', i, 'outputs', field, 'variable'], {
          kind: 'variableWrite',
          id: output.variable,
        });
      }
    }
  });

  flow(at(`flow:${doc.flow.id}`), doc.flow, ['flow']);
  doc.subflows.forEach((sub, i) => {
    flow(at(`flow:${sub.id}`), sub, ['subflows', i]);
  });

  doc.rules.forEach((rule, i) => {
    const ctx = at('rules');
    predicate(ctx, rule.when, ['rules', i, 'when']);
    actions(ctx, rule.then, ['rules', i, 'then']);
    actions(ctx, rule.else, ['rules', i, 'else']);
  });

  return out;
}
