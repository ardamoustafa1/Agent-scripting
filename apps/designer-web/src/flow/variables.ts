import { extractDependencies, renameVariableExpression } from '@verbis/expr';
import {
  IdentifierSchema,
  ScriptDocumentSchema,
  walkNodes,
  type ScriptDocument,
  type Action,
  type JsonValue,
} from '@verbis/script-schema';

import { editorRegistry } from '../editor/store.js';

export interface VariableUse {
  path: string;
  kind: 'read' | 'write';
}
function programs(
  document: ScriptDocument,
  expression: (source: string, path: string) => string,
  reference: (value: string, path: string, kind: 'read' | 'write') => string,
): void {
  const condition = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    if (typeof object['$expr'] === 'string') object['$expr'] = expression(object['$expr'], path);
    if (typeof object['fact'] === 'string' && object['fact'].startsWith('vars.')) {
      const parts = object['fact'].split('.');
      const key = parts[1];
      if (key) parts[1] = reference(key, path, 'read');
      object['fact'] = parts.join('.');
    }
    for (const [key, child] of Object.entries(object))
      if (key !== '$expr' && key !== 'value') condition(child, `${path}/${key}`);
  };
  const values = (value: unknown, path: string): void => {
    if (value && typeof value === 'object' && '$expr' in value) {
      const object = value as { $expr: string };
      object.$expr = expression(object.$expr, path);
    }
  };
  const actions = (items: Action[], path: string): void => {
    items.forEach((action, i) => {
      const at = `${path}/${i}`;
      if (action.type === 'setVariable')
        action.variable = reference(action.variable, `${at}/variable`, 'write');
      for (const [key, child] of Object.entries(action)) {
        if (key === 'variable') continue;
        if (key === 'if') condition(child, `${at}/${key}`);
        else if (
          ['then', 'else', 'actions', 'onSuccess', 'onError', 'onInvalid'].includes(key) &&
          Array.isArray(child)
        )
          actions(child as Action[], `${at}/${key}`);
        else {
          values(child, `${at}/${key}`);
          if (child && typeof child === 'object' && !Array.isArray(child))
            for (const [key2, value] of Object.entries(child as Record<string, unknown>))
              values(value, `${at}/${key}/${key2}`);
        }
      }
    });
  };
  const flow = (value: ScriptDocument['flow'], path: string) => {
    value.nodes.forEach((n, i) => {
      const at = `${path}/nodes/${i}`;
      if (n.type === 'setVariable') {
        n.variable = reference(n.variable, `${at}/variable`, 'write');
        values(n.value, `${at}/value`);
      }
    });
    value.edges.forEach((e, i) => {
      condition(e.when, `${path}/edges/${i}/when`);
    });
  };
  flow(document.flow, '/flow');
  document.subflows.forEach((f, i) => {
    flow(f, `/subflows/${i}`);
  });
  document.rules.forEach((r, i) => {
    condition(r.when, `/rules/${i}/when`);
    actions(r.then, `/rules/${i}/then`);
    if (r.else) actions(r.else, `/rules/${i}/else`);
  });
  document.testScenarios?.forEach((scenario, index) => {
    const at = `/testScenarios/${index}`;
    scenario.context.variables = Object.fromEntries(
      Object.entries(scenario.context.variables).map(([key, value]) => [
        reference(key, `${at}/context/variables/${key}`, 'write'),
        value,
      ]),
    );
    scenario.expected.variables = Object.fromEntries(
      Object.entries(scenario.expected.variables).map(([key, value]) => [
        reference(key, `${at}/expected/variables/${key}`, 'read'),
        value,
      ]),
    );
    scenario.steps.forEach((step, i) => {
      if (step.type === 'variable')
        step.variable = reference(step.variable, `${at}/steps/${i}/variable`, 'write');
      else if (step.type === 'actions') actions(step.actions, `${at}/steps/${i}/actions`);
    });
  });
  document.dataSources.forEach((ds, i) => {
    for (const [key, output] of Object.entries(ds.outputs))
      if (output.variable)
        output.variable = reference(
          output.variable,
          `/dataSources/${i}/outputs/${key}/variable`,
          'write',
        );
    for (const [key, value] of Object.entries(ds.inputs))
      values(value, `/dataSources/${i}/inputs/${key}`);
  });
  document.pages.forEach((p, i) => {
    actions(p.onEnter, `/pages/${i}/onEnter`);
    actions(p.onLeave, `/pages/${i}/onLeave`);
    p.timers.forEach((timer, j) => {
      actions(timer.onElapsed, `/pages/${i}/timers/${j}`);
    });
  });
  walkNodes(document, ({ node, pointer }) => {
    for (const binding of node.bindings) {
      if ('variable' in binding)
        binding.variable = reference(
          binding.variable,
          `${pointer}/bindings/${binding.prop}`,
          'read',
        );
      else
        binding.expression = expression(binding.expression, `${pointer}/bindings/${binding.prop}`);
    }
    for (const key of ['visibleWhen', 'enabledWhen', 'requiredWhen'] as const)
      condition(node[key], `${pointer}/${key}`);
    for (const [event, list] of Object.entries(node.events))
      actions(list, `${pointer}/events/${event}`);
    for (const property of [
      ...(editorRegistry.get(node.type).designerMeta.properties ?? []),
      ...(node.type === 'repeater' ? [{ key: 'arrayVariable', control: 'variable' }] : []),
    ])
      if (property.control === 'variable') {
        const value = node.props[property.key];
        if (typeof value === 'string')
          node.props[property.key] = reference(value, `${pointer}/props/${property.key}`, 'read');
      }
    for (const [key, value] of Object.entries(node.props))
      condition(value, `${pointer}/props/${key}`);
    return true;
  });
  for (const [locale, catalog] of Object.entries(document.i18n.messages))
    for (const [key, text] of Object.entries(catalog))
      catalog[key] = text.replace(
        /\{\{\s*(?:vars\.)?([A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z_][A-Za-z0-9_]*)*\s*\}\}/g,
        (whole: string, variable: string) => {
          const renamed = reference(variable, `/i18n/messages/${locale}/${key}`, 'read');
          return renamed === variable
            ? whole
            : whole.replace(
                /(\{\{\s*(?:vars\.)?)([A-Za-z_][A-Za-z0-9_]*)/,
                (_, prefix: string) => prefix + renamed,
              );
        },
      );
}
export function variableUses(document: ScriptDocument, key: string): VariableUse[] {
  const uses: VariableUse[] = [];
  const copy = structuredClone(document);
  programs(
    copy,
    (source, path) => {
      if (
        dependencies(source).some(
          (dep) =>
            dep === `vars.${key}` ||
            dep.startsWith(`vars.${key}.`) ||
            dep === 'vars.*' ||
            dep === 'vars',
        )
      )
        uses.push({ path, kind: 'read' });
      return source;
    },
    (value, path, kind) => {
      if (value === key) uses.push({ path, kind });
      return value;
    },
  );
  return uses.filter((v, i) => uses.findIndex((u) => u.path === v.path && u.kind === v.kind) === i);
}
export function renameVariable(document: ScriptDocument, from: string, to: string): ScriptDocument {
  IdentifierSchema.parse(to);
  if (from === to) return document;
  if (
    !document.variables.some((v) => v.key === from) ||
    document.variables.some((v) => v.key === to)
  )
    throw new Error('VERBIS_VARIABLE_RENAME');
  const copy = structuredClone(document);
  programs(
    copy,
    (source) => renameVariableExpression(source, from, to),
    (value) => (value === from ? to : value),
  );
  const variable = copy.variables.find((v) => v.key === from);
  if (variable) variable.key = to;
  return ScriptDocumentSchema.parse(copy);
}
export function jsonDefault(type: string): JsonValue {
  switch (type) {
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    case 'date':
      return '2000-01-01';
    default:
      return '';
  }
}

function dependencies(source: string): readonly string[] {
  try {
    return extractDependencies(source);
  } catch {
    return ['vars.*'];
  }
}
