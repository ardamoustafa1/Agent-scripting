import { walkNodes, type ScriptDocument } from '@verbis/script-schema';

export type Change = 'added' | 'removed' | 'changed' | 'unchanged';
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
      .join(',')}}`;
  return value === undefined ? 'null' : JSON.stringify(value);
};
export function compareItems<T>(
  before: readonly T[],
  after: readonly T[],
  key: (item: T) => string,
) {
  const a = new Map(before.map((v) => [key(v), v])),
    b = new Map(after.map((v) => [key(v), v]));
  return [...new Set([...a.keys(), ...b.keys()])].map(
    (id): { id: string; before: T | undefined; after: T | undefined; change: Change } => ({
      id,
      before: a.get(id),
      after: b.get(id),
      change: !a.has(id)
        ? 'added'
        : !b.has(id)
          ? 'removed'
          : canonical(a.get(id)) !== canonical(b.get(id))
            ? 'changed'
            : 'unchanged',
    }),
  );
}
export function compareNodes(before: ScriptDocument, after: ScriptDocument): Map<string, Change> {
  const collect = (doc: ScriptDocument) => {
    const nodes: { id: string; value: unknown }[] = [];
    walkNodes(doc, ({ node, parent, pageId, index }) => {
      const { children: _, ...props } = node;
      nodes.push({ id: node.id, value: { ...props, parent: parent?.id, pageId, index } });
      return true;
    });
    return nodes;
  };
  return new Map(
    compareItems(collect(before), collect(after), (v) => v.id).map((row) => [row.id, row.change]),
  );
}
