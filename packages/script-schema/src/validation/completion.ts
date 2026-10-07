import type { ScriptDocument } from '../schema/document.js';

/**
 * A completing outcome (ADR-0047) can only succeed after every mandatory page was visited. If a
 * route from the start reaches such an end node without passing a mandatory page, the agent can
 * never record that outcome on that route: the author must either add the page to the route or
 * declare the ending an early exit. Conditions are ignored (every edge counts as possible), so the
 * check is conservative: it can ask for an explicit `early`, it never hides a real bypass.
 */
export function completionBypasses(
  document: ScriptDocument,
): { node: string; pointer: string; page: string }[] {
  const mandatory = new Set(document.pages.filter((p) => p.mandatory).map((p) => p.id));
  if (mandatory.size === 0) return [];
  const found: { node: string; pointer: string; page: string }[] = [];
  const flow = document.flow;
  const targets = flow.nodes.flatMap((node, index) =>
    node.type === 'end' && node.outcome !== undefined && node.completion !== 'early'
      ? [{ id: node.id, pointer: `/flow/nodes/${String(index)}` }]
      : [],
  );
  for (const page of mandatory) {
    const blocked = new Set(
      flow.nodes.flatMap((n) => (n.type === 'page' && n.page === page ? [n.id] : [])),
    );
    if (blocked.size === 0) continue;
    const seen = new Set<string>(),
      queue = blocked.has(flow.start) ? [] : [flow.start];
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (seen.has(id)) continue;
      seen.add(id);
      for (const edge of flow.edges)
        if (edge.from === id && !blocked.has(edge.to) && !seen.has(edge.to)) queue.push(edge.to);
    }
    for (const target of targets)
      if (seen.has(target.id) && !found.some((f) => f.node === target.id && f.page === page))
        found.push({ node: target.id, pointer: target.pointer, page });
  }
  return found;
}
