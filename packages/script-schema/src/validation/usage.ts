import { LITERAL_TEXT_PROPS } from '../components.js';

import { collect } from './collect.js';

import type { ScriptDocument } from '../schema/document.js';

export interface UnusedVariable {
  readonly key: string;
  /** JSON Pointer of the variable declaration. */
  readonly path: string;
  /** PII/PCI: keeping it is a data-minimisation problem, not just clutter. */
  readonly sensitive: boolean;
}

/**
 * Declared variables that no page, flow, rule or data source reads or writes.
 * Persisted variables (captured for analytics) and read-only `global` constants are
 * excluded, since their use can live outside the document.
 */
export function unusedVariables(doc: ScriptDocument): UnusedVariable[] {
  const used = new Set<string>();
  for (const ref of collect(doc, LITERAL_TEXT_PROPS).refs)
    if (ref.kind === 'variableRead' || ref.kind === 'variableWrite') used.add(ref.id);
  const unused: UnusedVariable[] = [];
  doc.variables.forEach((variable, index) => {
    if (used.has(variable.key) || variable.persist || variable.scope === 'global') return;
    unused.push({
      key: variable.key,
      path: `/variables/${String(index)}`,
      sensitive:
        variable.pii || variable.classification === 'pii' || variable.classification === 'pci',
    });
  });
  return unused;
}
