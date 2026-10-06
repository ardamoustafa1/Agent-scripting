import { type CorePrimitiveType, isCorePrimitive } from '@verbis/core-runtime';

/** A library component declares which core primitives it is composed of. */
export interface ComponentDefinition {
  readonly type: string;
  readonly builtOn: readonly CorePrimitiveType[];
}

export class ComponentRegistry {
  readonly #definitions = new Map<string, ComponentDefinition>();

  register(definition: ComponentDefinition): void {
    if (isCorePrimitive(definition.type)) {
      throw new Error(`"${definition.type}" is a core primitive and cannot be re-registered`);
    }
    if (definition.builtOn.length === 0) {
      throw new Error(
        `Component "${definition.type}" must be built on at least one core primitive`,
      );
    }
    if (this.#definitions.has(definition.type)) {
      throw new Error(`Component "${definition.type}" is already registered`);
    }
    this.#definitions.set(definition.type, definition);
  }

  get(type: string): ComponentDefinition | undefined {
    return this.#definitions.get(type);
  }

  list(): ComponentDefinition[] {
    return [...this.#definitions.values()];
  }
}
