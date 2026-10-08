import { ScriptDocumentSchema, type ScriptDocument } from './schema/document.js';

/**
 * Three-way structural merge of script documents (DIFFERENTIATORS C3). Documents carry stable ids
 * (CLAUDE.md §5), so the merge works on the TREE, not on text: collections are matched by id/key,
 * objects are merged field by field, and only a field/item that BOTH sides changed differently, or
 * that one side deleted while the other changed, is a conflict. A conflict is resolved
 * provisionally in favour of `ours` and always reported: callers must show it, never hide it.
 * Pure and deterministic. The result is validated against the document schema.
 */
export type ConflictKind = 'both-changed' | 'deleted-vs-changed' | 'duplicate-id';
export type ConflictSide = 'ours' | 'theirs';
export interface MergeConflict {
  /** JSON-pointer-like location, e.g. `/variables/customerName` or `/pages/home/layout/btn-next`. */
  readonly path: string;
  readonly kind: ConflictKind;
  readonly base: unknown;
  readonly ours: unknown;
  readonly theirs: unknown;
  /** Set when the caller chose a side for this conflict (it is then applied, not provisional). */
  readonly resolution?: ConflictSide;
}
export interface MergeResult {
  /** Null only when the merged structure cannot be parsed as a document at all. */
  readonly document: ScriptDocument | null;
  readonly conflicts: readonly MergeConflict[];
  /** Schema issues of the merged document (empty when valid). */
  readonly issues: readonly string[];
}

type Json = unknown;
const canonical = (value: Json): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value as Record<string, Json>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
      .join(',')}}`;
  return value === undefined ? 'undefined' : JSON.stringify(value);
};
const same = (a: Json, b: Json): boolean => canonical(a) === canonical(b);
const isRecord = (v: Json): v is Record<string, Json> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

class Merger {
  readonly conflicts: MergeConflict[] = [];

  constructor(private readonly resolutions: Readonly<Record<string, ConflictSide>> = {}) {}

  /** Records a conflict and returns the side the caller chose for it, if any. */
  conflict(
    path: string,
    kind: ConflictKind,
    base: Json,
    ours: Json,
    theirs: Json,
  ): ConflictSide | undefined {
    const resolution = Object.hasOwn(this.resolutions, path) ? this.resolutions[path] : undefined;
    this.conflicts.push({ path, kind, base, ours, theirs, ...(resolution ? { resolution } : {}) });
    return resolution;
  }

  /** Whole-value merge. `undefined` means "absent". */
  value(path: string, base: Json, ours: Json, theirs: Json): Json {
    if (same(ours, theirs)) return ours;
    if (same(ours, base)) return theirs;
    if (same(theirs, base)) return ours;
    const side = this.conflict(
      path,
      base !== undefined && (ours === undefined || theirs === undefined)
        ? 'deleted-vs-changed'
        : 'both-changed',
      base,
      ours,
      theirs,
    );
    return side === 'theirs' ? theirs : ours;
  }

  /** Field-by-field merge of plain objects; nested objects recurse, everything else is a value. */
  object(path: string, base: Json, ours: Json, theirs: Json, skip: readonly string[] = []): Json {
    if (!isRecord(ours) || !isRecord(theirs) || (base !== undefined && !isRecord(base)))
      return this.value(path, base, ours, theirs);
    const b = isRecord(base) ? base : {},
      out: Record<string, Json> = {};
    const keys = [...new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(b)])];
    for (const key of keys) {
      if (skip.includes(key)) continue;
      const merged =
        isRecord(ours[key]) && isRecord(theirs[key])
          ? this.object(`${path}/${key}`, b[key], ours[key], theirs[key])
          : this.value(`${path}/${key}`, b[key], ours[key], theirs[key]);
      if (merged !== undefined) out[key] = merged;
    }
    return out;
  }

  /**
   * Keyed collection merge. Order: the `ours` order, then items only `theirs` added. `item`
   * merges two surviving versions of the same id (defaults to a field-by-field object merge).
   */
  keyed<T extends Record<string, Json>>(
    path: string,
    base: readonly T[],
    ours: readonly T[],
    theirs: readonly T[],
    keyOf: (item: T) => string,
    item: (path: string, b: T | undefined, o: T, t: T) => T = (p, b, o, t) =>
      this.object(p, b, o, t) as T,
  ): T[] {
    const index = (list: readonly T[]) => new Map(list.map((x) => [keyOf(x), x]));
    const b = index(base),
      o = index(ours),
      t = index(theirs);
    const ids = [...new Set([...ours.map(keyOf), ...theirs.map(keyOf), ...base.map(keyOf)])];
    const out: T[] = [];
    for (const id of ids) {
      const at = `${path}/${id}`,
        bi = b.get(id),
        oi = o.get(id),
        ti = t.get(id);
      if (oi && ti) {
        out.push(
          bi === undefined && !same(oi, ti)
            ? this.conflict(at, 'duplicate-id', undefined, oi, ti) === 'theirs'
              ? ti
              : oi
            : item(at, bi, oi, ti),
        );
      } else {
        const survivor = oi ?? ti;
        if (survivor === undefined) continue;
        if (bi === undefined) out.push(survivor);
        else if (same(survivor, bi))
          continue; // deleted on one side, untouched on the other
        else {
          const side = this.conflict(at, 'deleted-vs-changed', bi, oi, ti);
          // Chosen side wins (a deleted side removes the item); unresolved: keep the side that
          // still has it, provisionally.
          const chosen = side === 'ours' ? oi : side === 'theirs' ? ti : (oi ?? ti);
          if (chosen) out.push(chosen);
        }
      }
    }
    return out;
  }

  /** Layout trees: node fields merge by value, children merge as a keyed collection. */
  node(path: string, base: Json, ours: Json, theirs: Json): Json {
    if (!isRecord(ours) || !isRecord(theirs)) return this.value(path, base, ours, theirs);
    const b = isRecord(base) ? base : undefined;
    const fields = this.object(
      path,
      b ? withoutChildren(b) : undefined,
      withoutChildren(ours),
      withoutChildren(theirs),
    );
    const children = this.keyed(
      `${path}/children`,
      list(b?.['children']),
      list(ours['children']),
      list(theirs['children']),
      (n) => String(n['id']),
      (p, bi, oi, ti) => this.node(p, bi, oi, ti) as Record<string, Json>,
    );
    return children.length > 0 ? { ...(fields as Record<string, Json>), children } : fields;
  }
}
const withoutChildren = (n: Record<string, Json>): Record<string, Json> => {
  const { children: _children, ...rest } = n;
  return rest;
};
const list = (v: Json): Record<string, Json>[] =>
  Array.isArray(v) ? (v as Record<string, Json>[]) : [];

function mergeFlow(m: Merger, path: string, base: Json, ours: Json, theirs: Json): Json {
  if (!isRecord(ours) || !isRecord(theirs)) return m.value(path, base, ours, theirs);
  const b = isRecord(base) ? base : undefined;
  const rest = m.object(path, b, ours, theirs, ['nodes', 'edges']) as Record<string, Json>;
  return {
    ...rest,
    nodes: m.keyed(
      `${path}/nodes`,
      list(b?.['nodes']),
      list(ours['nodes']),
      list(theirs['nodes']),
      (n) => String(n['id']),
    ),
    edges: m.keyed(
      `${path}/edges`,
      list(b?.['edges']),
      list(ours['edges']),
      list(theirs['edges']),
      (e) => String(e['id']),
    ),
  };
}

export function mergeDocuments(
  base: ScriptDocument,
  ours: ScriptDocument,
  theirs: ScriptDocument,
  /** Chosen side per conflict path (as reported by an earlier call); anything else stays provisional. */
  resolutions: Readonly<Record<string, ConflictSide>> = {},
): MergeResult {
  const m = new Merger(resolutions);
  const b = base as unknown as Record<string, Json>,
    o = ours as unknown as Record<string, Json>,
    t = theirs as unknown as Record<string, Json>;
  const merged: Record<string, Json> = {
    schemaVersion: o['schemaVersion'],
    id: o['id'],
    meta: m.object('/meta', b['meta'], o['meta'], t['meta']),
    variables: m.keyed(
      '/variables',
      list(b['variables']),
      list(o['variables']),
      list(t['variables']),
      (v) => String(v['key']),
    ),
    dataSources: m.keyed(
      '/dataSources',
      list(b['dataSources']),
      list(o['dataSources']),
      list(t['dataSources']),
      (d) => String(d['id']),
    ),
    pages: m.keyed(
      '/pages',
      list(b['pages']),
      list(o['pages']),
      list(t['pages']),
      (p) => String(p['id']),
      (path, bp, op, tp) => {
        const fields = m.object(
          path,
          bp && withoutLayout(bp),
          withoutLayout(op),
          withoutLayout(tp),
        ) as Record<string, Json>;
        return {
          ...fields,
          layout: m.node(`${path}/layout`, bp?.['layout'], op['layout'], tp['layout']),
        };
      },
    ),
    flow: mergeFlow(m, '/flow', b['flow'], o['flow'], t['flow']),
    subflows: m.keyed(
      '/subflows',
      list(b['subflows']),
      list(o['subflows']),
      list(t['subflows']),
      (f) => String(f['id']),
      (path, bf, of, tf) => mergeFlow(m, path, bf, of, tf) as Record<string, Json>,
    ),
    rules: m.keyed('/rules', list(b['rules']), list(o['rules']), list(t['rules']), (r) =>
      String(r['id']),
    ),
    i18n: m.object('/i18n', b['i18n'], o['i18n'], t['i18n']),
    componentRegistry: m.keyed(
      '/componentRegistry',
      list(b['componentRegistry']),
      list(o['componentRegistry']),
      list(t['componentRegistry']),
      (c) => String(c['type']),
    ),
  };
  const theme = m.value('/theme', b['theme'], o['theme'], t['theme']);
  if (theme !== undefined) merged['theme'] = theme;
  if (
    o['testScenarios'] !== undefined ||
    t['testScenarios'] !== undefined ||
    b['testScenarios'] !== undefined
  )
    merged['testScenarios'] = m.keyed(
      '/testScenarios',
      list(b['testScenarios']),
      list(o['testScenarios']),
      list(t['testScenarios']),
      (s) => String(s['id']),
    );
  const parsed = ScriptDocumentSchema.safeParse(merged);
  return {
    document: parsed.success ? parsed.data : null,
    conflicts: m.conflicts,
    issues: parsed.success
      ? []
      : parsed.error.issues.map((i) => `${i.path.join('/')}: ${i.message}`),
  };
}
const withoutLayout = (p: Record<string, Json>): Record<string, Json> => {
  const { layout: _layout, ...rest } = p;
  return rest;
};
