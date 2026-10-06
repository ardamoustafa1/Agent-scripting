import {
  ScriptDocumentSchema,
  walkNodes,
  type ScriptDocument,
  type Flow,
  type Action,
} from '@verbis/script-schema';

import type { EditorStore } from '../editor/store.js';
/** Pin a source version into the draft. Conflicting dependencies reject the entire import. */
export function importSubflow(
  store: EditorStore,
  source: ScriptDocument,
  nextId = () => `import-${crypto.randomUUID()}`,
): string {
  const imported = structuredClone(source);
  const ids = new Map<string, string>();
  const add = (id: string) => {
    if (!ids.has(id)) ids.set(id, nextId());
  };
  for (const page of imported.pages) {
    add(page.id);
    for (const timer of page.timers) add(timer.id);
  }
  walkNodes(imported, ({ node }) => {
    add(node.id);
    return true;
  });
  for (const flow of [imported.flow, ...imported.subflows]) {
    add(flow.id);
    flow.nodes.forEach((n) => {
      add(n.id);
    });
    flow.edges.forEach((e) => {
      add(e.id);
    });
    flow.designer?.groups.forEach((g) => {
      add(g.id);
    });
    flow.designer?.notes.forEach((n) => {
      add(n.id);
    });
  }
  imported.rules.forEach((r) => {
    add(r.id);
  });
  const remap = (id: string) => ids.get(id) ?? id;
  const condition = (value: unknown) => {
    if (value && typeof value === 'object' && '$rule' in value && typeof value.$rule === 'string')
      value.$rule = remap(value.$rule);
  };
  const actions = (list: Action[]) => {
    for (const a of list) {
      if ('page' in a && a.page) a.page = remap(a.page);
      if ('flow' in a) a.flow = remap(a.flow);
      if ('timer' in a) a.timer = remap(a.timer);
      if ('node' in a) a.node = remap(a.node);
      if ('if' in a) condition(a.if);
      for (const key of ['then', 'else', 'actions', 'onSuccess', 'onError', 'onInvalid'] as const)
        if (key in a) {
          const nested: unknown = a[key as keyof typeof a];
          if (Array.isArray(nested)) actions(nested as Action[]);
        }
    }
  };
  for (const page of imported.pages) {
    page.id = remap(page.id);
    actions(page.onEnter);
    actions(page.onLeave);
    for (const timer of page.timers) {
      timer.id = remap(timer.id);
      actions(timer.onElapsed);
    }
  }
  walkNodes(imported, ({ node }) => {
    node.id = remap(node.id);
    for (const key of ['page', 'timer']) {
      const value = node.props[key];
      if (typeof value === 'string') node.props[key] = remap(value);
    }
    for (const value of Object.values(node.events)) actions(value);
    condition(node.visibleWhen);
    condition(node.enabledWhen);
    condition(node.requiredWhen);
    return true;
  });
  for (const rule of imported.rules) {
    rule.id = remap(rule.id);
    actions(rule.then);
    if (rule.else) actions(rule.else);
  }
  const flows: Flow[] = [imported.flow, ...imported.subflows];
  for (const flow of flows) {
    flow.id = remap(flow.id);
    flow.start = remap(flow.start);
    for (const node of flow.nodes) {
      node.id = remap(node.id);
      if (node.type === 'page') node.page = remap(node.page);
      if (node.type === 'subflow') node.flow = remap(node.flow);
    }
    for (const edge of flow.edges) {
      edge.id = remap(edge.id);
      edge.from = remap(edge.from);
      edge.to = remap(edge.to);
      condition(edge.when);
    }
    for (const group of flow.designer?.groups ?? []) {
      group.id = remap(group.id);
      group.nodes = group.nodes.map(remap);
    }
    for (const note of flow.designer?.notes ?? []) note.id = remap(note.id);
  }
  store.edit((doc) => {
    for (const variable of imported.variables) {
      const existing = doc.variables.find((v) => v.key === variable.key);
      if (existing && JSON.stringify(existing) !== JSON.stringify(variable))
        throw new Error('VERBIS_IMPORT_CONFLICT');
      if (!existing) doc.variables.push(variable);
    }
    for (const source of imported.dataSources) {
      const existing = doc.dataSources.find((s) => s.id === source.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(source))
        throw new Error('VERBIS_IMPORT_CONFLICT');
      if (!existing) doc.dataSources.push(source);
    }
    for (const [locale, messages] of Object.entries(imported.i18n.messages)) {
      const target = (doc.i18n.messages[locale] ??= {});
      for (const [key, value] of Object.entries(messages)) {
        if (target[key] !== undefined && target[key] !== value)
          throw new Error('VERBIS_IMPORT_CONFLICT');
        target[key] = value;
      }
    }
    for (const plugin of imported.componentRegistry) {
      const existing = doc.componentRegistry.find((p) => p.type === plugin.type);
      if (existing && JSON.stringify(existing) !== JSON.stringify(plugin))
        throw new Error('VERBIS_IMPORT_CONFLICT');
      if (!existing) doc.componentRegistry.push(plugin);
    }
    doc.pages.push(...imported.pages);
    doc.rules.push(...imported.rules);
    doc.subflows.push(...flows);
    ScriptDocumentSchema.parse(doc);
  });
  return imported.flow.id;
}
