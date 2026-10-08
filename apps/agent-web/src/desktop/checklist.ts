import { walkNodes, type ScriptDocument } from '@verbis/script-schema';

import { pageTitle } from './navigation.js';

/** What the checklist needs from the runtime store. */
export interface ChecklistStore {
  get(path: string): unknown;
  variable(key: string): unknown;
}
export interface ChecklistItem {
  readonly id: string;
  readonly pageId: string;
  /** Customer-facing page title, so the agent knows where the notice is. */
  readonly page: string;
  readonly label: string;
  readonly done: boolean;
}

/**
 * Live compliance checklist (DIFFERENTIATORS D3). It lists every `mustRead` notice of the script
 * in page order and mirrors the SAME state the runtime guard uses (`runtime.read.<id>`, the
 * `acknowledged` prop, or a bound variable), so the panel can never say "done" while the
 * server-side guard still blocks the outcome. It adds no schema and no new state.
 */
export function complianceChecklist(
  document: ScriptDocument,
  store: ChecklistStore,
  message: (key: string) => string,
): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  walkNodes(document, ({ node, pageId }) => {
    if (node.props['mustRead'] !== true) return true;
    const binding = node.bindings.find((b) => b.prop === 'acknowledged' && 'variable' in b),
      key = node.props['titleKey'] ?? node.props['labelKey'];
    items.push({
      id: node.id,
      pageId,
      page: pageTitle(document, pageId, message),
      label: typeof key === 'string' && key !== '' ? message(key) : node.id,
      done:
        store.get(`runtime.read.${node.id}`) === true ||
        node.props['acknowledged'] === true ||
        (binding !== undefined &&
          'variable' in binding &&
          store.variable(binding.variable) === true),
    });
    return true;
  });
  return items;
}

export function pendingCount(items: readonly ChecklistItem[]): number {
  return items.filter((item) => !item.done).length;
}
