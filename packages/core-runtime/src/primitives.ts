import { NodeIdSchema } from '@verbis/script-schema';

/**
 * The Verbis kernel (docs/SCRIPT_MODEL.md §4.1). Every screen component is a
 * composition of these three primitives.
 */
export const CORE_PRIMITIVES = ['box', 'button', 'webService'] as const;

export type CorePrimitiveType = (typeof CORE_PRIMITIVES)[number];

export function isCorePrimitive(type: string): type is CorePrimitiveType {
  return (CORE_PRIMITIVES as readonly string[]).includes(type);
}

export interface PrimitiveDescriptor {
  readonly type: CorePrimitiveType;
  /** Events the primitive can emit; actions bind to these. */
  readonly events: readonly string[];
  /** Whether the primitive may contain children. */
  readonly container: boolean;
}

export const PRIMITIVE_DESCRIPTORS: Readonly<Record<CorePrimitiveType, PrimitiveDescriptor>> =
  Object.freeze({
    box: { type: 'box', events: [], container: true },
    button: { type: 'button', events: ['onPress'], container: false },
    webService: { type: 'webService', events: ['onSuccess', 'onError'], container: false },
  });

/** Validates a node id using the shared script schema. */
export function isValidNodeId(id: string): boolean {
  return NodeIdSchema.safeParse(id).success;
}
