import * as Y from 'yjs';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const key = (value: Json): string | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? typeof value['id'] === 'string'
      ? value['id']
      : typeof value['key'] === 'string'
        ? value['key']
        : undefined
    : undefined;
function encode(value: Json): unknown {
  if (value && typeof value === 'object') {
    const wrapper = new Y.Map<unknown>();
    if (Array.isArray(value)) {
      if (value.every((v) => key(v) !== undefined)) {
        wrapper.set('kind', 'keyed');
        const items = new Y.Map<unknown>(),
          order = new Y.Array<string>();
        wrapper.set('items', items);
        wrapper.set('order', order);
        for (const item of value) {
          const id = key(item);
          if (id !== undefined) items.set(id, encode(item));
        }
        order.insert(
          0,
          value.map((v) => key(v) ?? ''),
        );
      } else {
        wrapper.set('kind', 'list');
        const list = new Y.Array<unknown>();
        wrapper.set('list', list);
        list.insert(0, value.map(encode));
      }
    } else {
      wrapper.set('kind', 'object');
      const fields = new Y.Map<unknown>();
      wrapper.set('fields', fields);
      for (const [k, v] of Object.entries(value)) fields.set(k, encode(v));
    }
    return wrapper;
  }
  return value;
}
function decode(value: unknown): Json {
  if (value instanceof Y.Map) {
    const kind: unknown = value.get('kind');
    if (kind === 'object') {
      const fields: unknown = value.get('fields');
      return fields instanceof Y.Map
        ? Object.fromEntries([...fields.entries()].map(([k, v]) => [k, decode(v)]))
        : {};
    }
    if (kind === 'keyed') {
      const order: unknown = value.get('order'),
        items: unknown = value.get('items');
      return order instanceof Y.Array && items instanceof Y.Map
        ? [...new Set(order.toArray() as string[])]
            .filter((id) => items.has(id))
            .map((id) => decode(items.get(id)))
        : [];
    }
    const list: unknown = value.get('list');
    return list instanceof Y.Array ? list.toArray().map(decode) : [];
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return value;
  return null;
}
/** Only locally changed fields are applied; untouched fields preserve concurrent remote edits. */
function reconcile(target: Y.Map<unknown>, before: Json, after: Json): void {
  if (
    target.get('kind') === 'object' &&
    after &&
    typeof after === 'object' &&
    !Array.isArray(after)
  ) {
    const fields = target.get('fields');
    if (!(fields instanceof Y.Map)) return;
    const old = before && typeof before === 'object' && !Array.isArray(before) ? before : {};
    for (const k of Object.keys(old)) if (!(k in after)) fields.delete(k);
    for (const [k, v] of Object.entries(after)) {
      if (same(old[k], v)) continue;
      const current: unknown = fields.get(k);
      if (current instanceof Y.Map && compatible(current, v)) reconcile(current, old[k] ?? null, v);
      else fields.set(k, encode(v));
    }
    return;
  }
  if (!Array.isArray(after)) return;
  const old = Array.isArray(before) ? before : [];
  if (target.get('kind') === 'keyed') {
    const items = target.get('items'),
      order = target.get('order');
    if (!(items instanceof Y.Map) || !(order instanceof Y.Array)) return;
    const newIds = after.map((v) => key(v) ?? ''),
      oldIds = old.map((v) => key(v) ?? ''),
      newKeys = new Set(newIds),
      previous = new Map(old.map((v) => [key(v), v]));
    for (const id of oldIds)
      if (!newKeys.has(id)) {
        items.delete(id);
        for (let i = order.length - 1; i >= 0; i--) if (order.get(i) === id) order.delete(i, 1);
      }
    for (const item of after) {
      const id = key(item);
      if (!id) continue;
      const prior = previous.get(id),
        current: unknown = items.get(id);
      if (prior && current instanceof Y.Map && !same(prior, item)) reconcile(current, prior, item);
      else if (!prior && !items.has(id)) items.set(id, encode(item));
    }
    // Order entries are references: reordering never clones or replaces a node's shared map.
    if (!same(oldIds, newIds))
      for (let i = 0; i < newIds.length; i++) {
        const id = newIds[i];
        if (!id || !items.has(id)) continue;
        const existing = order.toArray().indexOf(id);
        if (existing === i) continue;
        if (existing >= 0) order.delete(existing, 1);
        order.insert(Math.min(i, order.length), [id]);
      }
  } else {
    const list = target.get('list');
    if (list instanceof Y.Array && !same(old, after)) {
      list.delete(0, list.length);
      list.insert(0, after.map(encode));
    }
  }
}
function compatible(target: Y.Map<unknown>, value: Json): boolean {
  const kind = target.get('kind');
  return kind === 'object'
    ? !!value && typeof value === 'object' && !Array.isArray(value)
    : Array.isArray(value) && (kind !== 'keyed' || value.every((v) => key(v) !== undefined));
}
export const LOCAL_EDIT = Symbol('verbis-local-edit');
export function initializeDocument(doc: Y.Doc, document: unknown): void {
  const root = doc.getMap<unknown>('script');
  if (root.has('document')) return;
  doc.transact(
    () => root.set('document', encode(JSON.parse(JSON.stringify(document)) as Json)),
    'initialize',
  );
}
export function readDocument(doc: Y.Doc): unknown {
  return decode(doc.getMap('script').get('document'));
}
export function applyDocumentChange(doc: Y.Doc, before: unknown, after: unknown): void {
  doc.transact(() => {
    const root = doc.getMap('script'),
      target = root.get('document');
    if (target instanceof Y.Map)
      reconcile(
        target,
        JSON.parse(JSON.stringify(before)) as Json,
        JSON.parse(JSON.stringify(after)) as Json,
      );
  }, LOCAL_EDIT);
}
export { Y };
export * from './limits.js';
