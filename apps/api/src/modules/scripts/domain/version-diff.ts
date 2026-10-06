/**
 * Version diff: a full RFC 6902 patch (machine) and a semantic, human-readable summary keyed by
 * stable ids (pages, nodes, variables, data sources, flow nodes/edges, translations).
 */
export interface PatchOp {
  readonly op: 'add' | 'remove' | 'replace';
  readonly path: string;
  readonly value?: unknown;
}

const token = (key: string): string => key.replace(/~/g, '~0').replace(/\//g, '~1');
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Deterministic RFC 6902 patch transforming `from` into `to` (keys sorted; arrays index-wise). */
export function jsonPatch(from: unknown, to: unknown, path = ''): PatchOp[] {
  if (same(from, to)) return [];
  if (isObject(from) && isObject(to)) {
    const ops: PatchOp[] = [];
    for (const key of Object.keys(from).sort()) {
      if (!(key in to)) ops.push({ op: 'remove', path: `${path}/${token(key)}` });
    }
    for (const key of Object.keys(to).sort()) {
      const child = `${path}/${token(key)}`;
      if (!(key in from)) ops.push({ op: 'add', path: child, value: to[key] });
      else ops.push(...jsonPatch(from[key], to[key], child));
    }
    return ops;
  }
  if (Array.isArray(from) && Array.isArray(to)) {
    const ops: PatchOp[] = [];
    const common = Math.min(from.length, to.length);
    for (let i = 0; i < common; i += 1)
      ops.push(...jsonPatch(from[i], to[i], `${path}/${String(i)}`));
    for (let i = common; i < to.length; i += 1)
      ops.push({ op: 'add', path: `${path}/${String(i)}`, value: to[i] });
    // Remove from the end so indexes stay valid when applied in order.
    for (let i = from.length - 1; i >= common; i -= 1)
      ops.push({ op: 'remove', path: `${path}/${String(i)}` });
    return ops;
  }
  return [{ op: 'replace', path, value: to }];
}

/** Applies a patch produced by `jsonPatch` (used to prove round-trips in tests and tooling). */
export function applyPatch(document: unknown, ops: readonly PatchOp[]): unknown {
  let root = structuredClone<unknown>(document);
  for (const op of ops) {
    if (op.path === '') {
      root = op.op === 'remove' ? undefined : structuredClone(op.value);
      continue;
    }
    const parts = op.path
      .slice(1)
      .split('/')
      .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    const last = parts.pop() ?? '';
    let parent: unknown = root;
    for (const part of parts) parent = (parent as Record<string, unknown>)[part];
    if (Array.isArray(parent)) {
      const index = Number(last);
      if (op.op === 'remove') parent.splice(index, 1);
      else if (op.op === 'add') parent.splice(index, 0, structuredClone(op.value));
      else parent[index] = structuredClone(op.value);
    } else if (isObject(parent)) {
      if (op.op === 'remove') Reflect.deleteProperty(parent, last);
      else parent[last] = structuredClone(op.value);
    } else {
      throw new Error(`invalid patch path ${op.path}`);
    }
  }
  return root;
}

export interface ChangeSet {
  readonly added: string[];
  readonly removed: string[];
  readonly changed: string[];
}

export interface DiffSummary {
  readonly pages: ChangeSet;
  readonly nodes: ChangeSet;
  readonly variables: ChangeSet;
  readonly dataSources: ChangeSet;
  readonly flowNodes: ChangeSet;
  readonly flowEdges: ChangeSet;
  readonly translations: ChangeSet;
  readonly metadataChanged: string[];
  /** One line per change, stable order (English; UI localizes from the structured fields). */
  readonly lines: string[];
  readonly totalChanges: number;
}

function byId(list: unknown, idKey = 'id'): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (!Array.isArray(list)) return map;
  for (const item of list)
    if (isObject(item) && typeof item[idKey] === 'string') map.set(item[idKey], item);
  return map;
}

function compare(a: Map<string, unknown>, b: Map<string, unknown>): ChangeSet {
  const added = [...b.keys()].filter((k) => !a.has(k)).sort();
  const removed = [...a.keys()].filter((k) => !b.has(k)).sort();
  const changed = [...b.keys()].filter((k) => a.has(k) && !same(a.get(k), b.get(k))).sort();
  return { added, removed, changed };
}

/** All layout nodes by id across pages (node trees nest via `children`). */
function nodesOf(document: Record<string, unknown>): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const visit = (node: unknown): void => {
    if (!isObject(node)) return;
    const { children, ...rest } = node;
    if (typeof node['id'] === 'string') out.set(node['id'], rest);
    if (Array.isArray(children)) children.forEach(visit);
  };
  if (Array.isArray(document['pages']))
    for (const page of document['pages']) if (isObject(page)) visit(page['layout']);
  return out;
}

function translations(document: Record<string, unknown>): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const i18n = document['i18n'];
  if (!isObject(i18n) || !isObject(i18n['messages'])) return out;
  for (const [locale, messages] of Object.entries(i18n['messages'])) {
    if (!isObject(messages)) continue;
    for (const [key, text] of Object.entries(messages)) out.set(`${locale}:${key}`, text);
  }
  return out;
}

function flow(document: Record<string, unknown>, key: 'nodes' | 'edges'): Map<string, unknown> {
  const f = document['flow'];
  if (!isObject(f)) return new Map();
  if (key === 'nodes') {
    // Designer-only positions are not semantic changes.
    const list = Array.isArray(f['nodes'])
      ? f['nodes'].map((n: unknown) =>
          isObject(n) ? Object.fromEntries(Object.entries(n).filter(([k]) => k !== 'position')) : n,
        )
      : [];
    return byId(list);
  }
  return byId(f['edges']);
}

const SECTIONS = [
  'pages',
  'nodes',
  'variables',
  'dataSources',
  'flowNodes',
  'flowEdges',
  'translations',
] as const;
const LABEL: Record<(typeof SECTIONS)[number], string> = {
  pages: 'page',
  nodes: 'component',
  variables: 'variable',
  dataSources: 'data source',
  flowNodes: 'flow node',
  flowEdges: 'flow edge',
  translations: 'translation',
};
const METADATA = ['schemaVersion', 'id', 'meta', 'theme', 'componentRegistry', 'rules', 'subflows'];

export function summarizeDiff(fromDoc: unknown, toDoc: unknown): DiffSummary {
  const a = isObject(fromDoc) ? fromDoc : {};
  const b = isObject(toDoc) ? toDoc : {};
  const pagesA = new Map(
    [...byId(a['pages'])].map(([k, v]) => [k, isObject(v) ? { ...v, layout: undefined } : v]),
  );
  const pagesB = new Map(
    [...byId(b['pages'])].map(([k, v]) => [k, isObject(v) ? { ...v, layout: undefined } : v]),
  );
  const sections = {
    pages: compare(pagesA, pagesB),
    nodes: compare(nodesOf(a), nodesOf(b)),
    variables: compare(byId(a['variables']), byId(b['variables'])),
    dataSources: compare(byId(a['dataSources']), byId(b['dataSources'])),
    flowNodes: compare(flow(a, 'nodes'), flow(b, 'nodes')),
    flowEdges: compare(flow(a, 'edges'), flow(b, 'edges')),
    translations: compare(translations(a), translations(b)),
  };
  const metadataChanged = METADATA.filter((key) => !same(a[key], b[key]));
  const lines: string[] = [];
  for (const section of SECTIONS) {
    const set = sections[section];
    for (const id of set.added) lines.push(`+ ${LABEL[section]} "${id}" added`);
    for (const id of set.removed) lines.push(`- ${LABEL[section]} "${id}" removed`);
    for (const id of set.changed) lines.push(`~ ${LABEL[section]} "${id}" changed`);
  }
  for (const key of metadataChanged) lines.push(`~ ${key} changed`);
  return { ...sections, metadataChanged, lines, totalChanges: lines.length };
}
