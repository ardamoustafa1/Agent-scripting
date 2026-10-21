import { accessPath, children, parseExpression, type Ast } from '@verbis/expr';
import type { Node, ScriptDocument } from '@verbis/script-schema';

/** Context values agents know by a name of their own ("ajan adı", not `agent.firstName`). */
const KNOWN: Readonly<Record<string, string>> = {
  'agent.firstName': 'components.gaps.agent',
  'agent.displayName': 'components.gaps.agent',
  'agent.name': 'components.gaps.agent',
  'interaction.ani': 'components.gaps.ani',
  'interaction.customerName': 'components.gaps.customer',
  'campaign.name': 'components.gaps.campaign',
};

/** `customerName` → "customer name", `tcKimlikNo` → "tc kimlik no". */
export function humanize(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .trim()
    .toLocaleLowerCase();
}

/** The one context path a parameter's value comes from, if there is exactly one. */
function sourcePath(value: Ast): string | undefined {
  const direct = accessPath(value);
  if (direct !== undefined) return direct;
  const found = new Set<string>();
  const walk = (node: Ast) => {
    const path = accessPath(node);
    if (path?.includes('.')) {
      found.add(path);
      return;
    }
    for (const child of children(node)) walk(child);
  };
  walk(value);
  return found.size === 1 ? [...found][0] : undefined;
}

/**
 * Readable names for a text's parameters, shown when a value is still empty (M-Z6): the
 * variable's display name (its description), a known context field, or the source's own name in
 * words. Read from the node's `params` binding, so `{ name: vars.customerName }` names the gap
 * after the customer name rather than after the placeholder.
 */
export function placeholderNames(
  node: Node,
  document: ScriptDocument,
  translate: (key: string) => string,
): Record<string, string> {
  const binding = node.bindings.find(
    (candidate) => candidate.prop === 'params' && 'expression' in candidate,
  );
  if (!binding || !('expression' in binding)) return {};
  let ast: Ast;
  try {
    ast = parseExpression(binding.expression);
  } catch {
    return {};
  }
  if (ast.kind !== 'object') return {};
  const names: Record<string, string> = {};
  for (const entry of ast.entries) {
    const path = sourcePath(entry.value);
    const known = path === undefined ? undefined : KNOWN[path];
    if (known) {
      names[entry.key] = translate(known);
      continue;
    }
    if (path?.startsWith('vars.')) {
      const key = path.split('.')[1] ?? '';
      const variable = document.variables.find((candidate) => candidate.key === key);
      // A blank display name is no name: fall back to the variable's own name in words.
      const display = variable?.description?.trim() ?? '';
      names[entry.key] = display === '' ? humanize(key) : display;
      continue;
    }
    names[entry.key] = humanize(path?.split('.').at(-1) ?? entry.key);
  }
  return names;
}
