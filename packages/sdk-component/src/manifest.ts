import { type CorePrimitiveType, isCorePrimitive } from '@verbis/core-runtime';

/** Manifest a third-party component ships with (docs/SCRIPT_MODEL.md §4.1). */
export interface ComponentManifest {
  readonly type: string;
  readonly version: string;
  readonly builtOn: readonly CorePrimitiveType[];
  /** SRI hash of the bundle, e.g. "sha384-...". */
  readonly integrity: string;
}

/** Third-party component types must be namespaced: "vendor.componentName". */
const NAMESPACED_TYPE = /^[a-z][a-z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/;

export function validateManifest(manifest: ComponentManifest): string[] {
  const problems: string[] = [];
  if (!NAMESPACED_TYPE.test(manifest.type)) problems.push('type must be "vendor.componentName"');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) problems.push('version must be semver');
  if (manifest.builtOn.length === 0 || !manifest.builtOn.every((t) => isCorePrimitive(t))) {
    problems.push('builtOn must list core primitives');
  }
  if (!/^sha(256|384|512)-[A-Za-z0-9+/=]+$/.test(manifest.integrity)) {
    problems.push('integrity must be an SRI hash');
  }
  return problems;
}
