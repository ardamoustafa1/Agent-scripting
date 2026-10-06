import { z } from 'zod';

import {
  ComponentTypeSchema,
  NodeSchema,
  type JsonValue,
  type Node,
  type ScriptDocument,
} from '@verbis/script-schema';

import { RuntimeProblem } from './problem.js';

import type { Runtime } from './runtime.js';
import type { RuntimeStore } from './store.js';
import type { ComponentType, ReactNode } from 'react';

export interface RendererProps {
  /** Original document node when rendering an instance with a unique DOM identity. */
  sourceNode?: Node;
  node: Node;
  props: Record<string, unknown>;
  runtime: Runtime;
  enabled: boolean;
  required: boolean;
  children?: ReactNode;
  emit: (event: string) => Promise<void>;
  write: (prop: string, value: JsonValue) => void;
}
export interface DesignerProperty {
  key: string;
  labelKey: string;
  control: 'text' | 'number' | 'boolean' | 'select' | 'json' | 'i18nKey' | 'variable' | 'asset';
  options?: readonly string[];
  bindable?: boolean;
  sensitive?: boolean;
}
export interface ComponentDefinition {
  type: string;
  renderer: ComponentType<RendererProps>;
  propsSchema: z.ZodType<Record<string, unknown>>;
  defaults: Record<string, JsonValue>;
  designerMeta: {
    icon: string;
    category: string;
    acceptsChildren: readonly string[] | '*';
    allowedParents: readonly string[] | '*';
    draggable: boolean;
    properties?: readonly DesignerProperty[];
  };
  events: readonly string[];
  bindableProps: readonly string[];
  /** Trusted write-only fields never receive a bound value, especially PCI. */
  secureBindings?: readonly string[];
  ownsChildren?: boolean;
  dependencies?: (node: Node, document: ScriptDocument) => readonly string[];
  validate?: (node: Node, store: RuntimeStore) => readonly { messageKey: string }[];
  /** Trusted host pins; plugin code is supplied by the host, never loaded from script JSON. */
  plugin?: { version: string; integrity: string };
}
export class ComponentRegistry {
  private definitions = new Map<string, ComponentDefinition>();
  register(definition: ComponentDefinition): this {
    ComponentTypeSchema.parse(definition.type);
    if (this.definitions.has(definition.type))
      throw new RuntimeProblem('VERBIS_COMPONENT_DUPLICATE');
    definition.propsSchema.parse(definition.defaults);
    this.definitions.set(definition.type, Object.freeze({ ...definition }));
    return this;
  }
  get(type: string): ComponentDefinition {
    const definition = this.definitions.get(type);
    if (!definition) throw new RuntimeProblem('VERBIS_COMPONENT_UNKNOWN');
    return definition;
  }
  list(): readonly ComponentDefinition[] {
    return [...this.definitions.values()];
  }
  canDrop(parent: string, child: string): boolean {
    const p = this.get(parent).designerMeta,
      c = this.get(child).designerMeta;
    return (
      c.draggable &&
      (p.acceptsChildren === '*' || p.acceptsChildren.includes(child)) &&
      (c.allowedParents === '*' || c.allowedParents.includes(parent))
    );
  }
  validate(document: Pick<ScriptDocument, 'pages' | 'componentRegistry'>): void {
    const walk = (node: Node, path: (string | number)[]) => {
      const definition = this.get(node.type);
      const manifest = document.componentRegistry.find((entry) => entry.type === node.type);
      if (
        definition.plugin &&
        (manifest?.version !== definition.plugin.version ||
          manifest.integrity !== definition.plugin.integrity)
      )
        throw new RuntimeProblem('VERBIS_PLUGIN_PIN_MISMATCH');
      if (manifest && !definition.plugin) throw new RuntimeProblem('VERBIS_PLUGIN_PIN_MISMATCH');
      // Bound required props are validated after evaluation, other defaults immediately.
      const parsedProps = definition.propsSchema.safeParse({
        ...definition.defaults,
        ...node.props,
      });
      if (!parsedProps.success) {
        const bound = new Set(node.bindings.map((binding) => binding.prop));
        // Defer only a missing bound value. Static unknown keys and invalid literals always fail.
        const issues = parsedProps.error.issues.filter(
          (issue) =>
            !(
              issue.code === 'invalid_type' &&
              issue.path.length === 1 &&
              bound.has(String(issue.path[0])) &&
              node.props[String(issue.path[0])] === undefined &&
              definition.defaults[String(issue.path[0])] === undefined
            ),
        );
        if (issues.length)
          throw new z.ZodError(
            issues.map((issue) => ({ ...issue, path: [...path, 'props', ...issue.path] })),
          );
      }
      for (const binding of node.bindings)
        if (!definition.bindableProps.includes(binding.prop))
          throw new RuntimeProblem('VERBIS_BINDING_PROP');
      for (const event of Object.keys(node.events))
        if (!definition.events.includes(event)) throw new RuntimeProblem('VERBIS_COMPONENT_EVENT');
      for (const [index, child] of (node.children ?? []).entries()) {
        if (!this.canDrop(node.type, child.type))
          throw new RuntimeProblem('VERBIS_COMPONENT_CHILD');
        walk(child, [...path, 'children', index]);
      }
    };
    for (const [index, page] of document.pages.entries())
      walk(NodeSchema.parse(page.layout), ['pages', index, 'layout']);
  }
}
