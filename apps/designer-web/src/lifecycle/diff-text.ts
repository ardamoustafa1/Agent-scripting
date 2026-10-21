import {
  fromPointer,
  walkNodes,
  type FlowEdge,
  type FlowNode,
  type ScriptDocument,
} from '@verbis/script-schema';

import { flowNodeLabel } from '../flow/model.js';

/**
 * Version differences as words: "Initial value: “Ada” → “Grace”", "Page “Welcome” › Button
 * “btn-submit” › Label". Reviewers read what changed without JSON or pointer paths.
 */
/** `i18next`'s `t`; options are always passed so the strict TFunction type is assignable. */
export type Translate = (key: string, options: Record<string, unknown>) => string;
/** What a compared item is; decides how its fields and enum values read. */
export type DiffKind = 'variable' | 'dataSource' | 'flowNode' | 'edge' | 'component' | 'generic';
export interface FieldChange {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return value === undefined ? 'null' : JSON.stringify(value);
};
/** `defaultValue` → "Default value": a readable fallback for fields without a translation. */
function humanize(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function fieldLabel(field: string, kind: DiffKind, t: Translate): string {
  const key = kind === 'edge' && field === 'default' ? 'fallback' : field;
  return t(`designer.lifecycle.diffText.fields.${key}`, { defaultValue: humanize(field) });
}

const ENUMS: Partial<Record<DiffKind, Record<string, string>>> = {
  variable: {
    type: 'designer.variables.types',
    scope: 'designer.variables.scopes',
    classification: 'designer.variables.classifications',
  },
  flowNode: { type: 'designer.flow.types' },
  component: { type: 'designer.editor.componentNames' },
};
const MAX_TEXT = 60;

export function displayValue(value: unknown, t: Translate, kind: DiffKind = 'generic', field = '') {
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`designer.lifecycle.diffText.${key}`, options ?? {});
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return t(value ? 'designer.value.yes' : 'designer.value.no', {});
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    const catalog = ENUMS[kind]?.[field];
    if (catalog) return t(`${catalog}.${value}`, { defaultValue: value });
    if (field === 'ref') return value.replace(/^tenant-datasource:/, '');
    const text = value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT - 1)}…` : value;
    return `“${text}”`;
  }
  if (Array.isArray(value)) return value.length === 0 ? '—' : k('items', { count: value.length });
  if (isRecord(value)) {
    if ('$expr' in value) return k('expression');
    if (typeof value['$rule'] === 'string') return k('rule', { name: value['$rule'] });
    if (field === 'position') return k('moved');
    const count = Object.keys(value).length;
    return count === 0 ? '—' : k('settings', { count });
  }
  return '—';
}

/** Top-level fields that differ between two versions of one item. */
export function fieldChanges(
  before: unknown,
  after: unknown,
  t: Translate,
  kind: DiffKind = 'generic',
): FieldChange[] {
  const a = isRecord(before) ? before : {},
    b = isRecord(after) ? after : {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((field) => field !== 'id' && field !== 'children')
    .filter((field) => canonical(a[field]) !== canonical(b[field]))
    .map((field) => ({
      field: fieldLabel(field, kind, t),
      before: displayValue(a[field], t, kind, field),
      after: displayValue(b[field], t, kind, field),
    }));
}

/** A flow step's author-facing name. */
export function stepName(document: ScriptDocument, node: FlowNode, t: Translate): string {
  const flow =
    [document.flow, ...document.subflows].find((f) => f.nodes.includes(node)) ?? document.flow;
  return flowNodeLabel(document, node, {
    flow,
    typeName: (type) => t(`designer.flow.types.${type}`, {}),
  });
}
/** "Welcome → Address check". */
export function edgeName(document: ScriptDocument, edge: FlowEdge, t: Translate): string {
  const name = (id: string) => {
    const node = [document.flow, ...document.subflows]
      .flatMap((flow) => flow.nodes)
      .find((n) => n.id === id);
    return node ? stepName(document, node, t) : id;
  };
  return `${name(edge.from)} → ${name(edge.to)}`;
}
export function componentName(type: string, id: string, t: Translate): string {
  return `${t(`designer.editor.componentNames.${type}`, { defaultValue: humanize(type) })} “${id}”`;
}

const isIndex = (segment: string) => /^\d+$/.test(segment);
/** An item by array index (JSON Patch, lint) or by its stable id (merge conflicts). */
function pick<T>(
  items: readonly T[] | undefined,
  segment: string,
  key: (item: T) => string,
): T | undefined {
  if (!items) return undefined;
  return isIndex(segment) ? items[Number(segment)] : items.find((item) => key(item) === segment);
}
const fallbackName = (segment: string) =>
  isIndex(segment) ? `#${String(Number(segment) + 1)}` : segment;

/**
 * A document path as a breadcrumb of names. Accepts JSON Pointers with array indices (patches,
 * lint issues) and the id-keyed paths of merge conflicts (`/pages/home/layout/children/btn-next`).
 * Without a document, stable ids stand in for names.
 */
export function describePath(
  path: string,
  document: ScriptDocument | undefined,
  t: Translate,
): string {
  let segments: string[];
  try {
    segments = fromPointer(path);
  } catch {
    return path;
  }
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`designer.lifecycle.diffText.${key}`, options ?? {});
  const crumbs: string[] = [];
  const rest = (from: number, kind: DiffKind) => {
    for (const segment of segments.slice(from))
      crumbs.push(isIndex(segment) ? fallbackName(segment) : fieldLabel(segment, kind, t));
  };
  const [root = '', index = ''] = segments;
  switch (root) {
    case 'pages': {
      const page = pick(document?.pages, index, (p) => p.id);
      crumbs.push(k('page', { name: page?.name ?? fallbackName(index) }));
      if (segments[2] !== 'layout') {
        rest(2, 'generic');
        break;
      }
      if (document && page && isIndex(index)) {
        let found: { type: string; id: string; length: number } | undefined;
        walkNodes(document, ({ node, pointer, pageId }) => {
          if (pageId === page.id && (path === pointer || path.startsWith(`${pointer}/`)))
            found = { type: node.type, id: node.id, length: fromPointer(pointer).length };
          return true;
        });
        if (found) {
          crumbs.push(componentName(found.type, found.id, t));
          rest(found.length, 'component');
          break;
        }
      }
      let at = 3,
        nodeId = page?.layout.id;
      while (segments[at] === 'children' && segments[at + 1] !== undefined) {
        nodeId = segments[at + 1];
        at += 2;
      }
      let type: string | undefined;
      if (document && nodeId)
        walkNodes(document, ({ node }) => {
          if (node.id === nodeId) type = node.type;
          return type === undefined;
        });
      crumbs.push(
        type && nodeId
          ? componentName(type, nodeId, t)
          : nodeId
            ? k('component', { name: nodeId })
            : k('layout'),
      );
      rest(at, 'component');
      break;
    }
    case 'variables': {
      const variable = pick(document?.variables, index, (v) => v.key);
      crumbs.push(k('variable', { name: variable?.key ?? fallbackName(index) }));
      rest(2, 'variable');
      break;
    }
    case 'dataSources': {
      const source = pick(document?.dataSources, index, (d) => d.id);
      crumbs.push(k('dataSource', { name: source?.id ?? fallbackName(index) }));
      rest(2, 'dataSource');
      break;
    }
    case 'rules': {
      const rule = pick(document?.rules, index, (r) => r.id);
      const described = rule?.description?.trim();
      crumbs.push(
        k('ruleItem', {
          name:
            described !== undefined && described !== ''
              ? described
              : (rule?.id ?? fallbackName(index)),
        }),
      );
      rest(2, 'generic');
      break;
    }
    case 'flow':
    case 'subflows': {
      const flow = root === 'flow' ? document?.flow : pick(document?.subflows, index, (f) => f.id);
      const offset = root === 'flow' ? 1 : 2;
      crumbs.push(
        root === 'flow' ? k('mainFlow') : k('subflow', { name: flow?.name ?? fallbackName(index) }),
      );
      const collection = segments[offset],
        item = segments[offset + 1] ?? '';
      const node = collection === 'nodes' ? pick(flow?.nodes, item, (n) => n.id) : undefined;
      const edge = collection === 'edges' ? pick(flow?.edges, item, (e) => e.id) : undefined;
      if (document && node) {
        crumbs.push(stepName(document, node, t));
        rest(offset + 2, 'flowNode');
      } else if (document && edge) {
        crumbs.push(edgeName(document, edge, t));
        rest(offset + 2, 'edge');
      } else if (collection === 'nodes' || collection === 'edges') {
        crumbs.push(
          k(collection === 'nodes' ? 'step' : 'connection', { name: fallbackName(item) }),
        );
        rest(offset + 2, collection === 'nodes' ? 'flowNode' : 'edge');
      } else rest(offset, 'generic');
      break;
    }
    case 'i18n': {
      const locale = segments[2];
      crumbs.push(
        segments[1] === 'messages' && locale
          ? k('texts', { locale: t(`common.locale.${locale}`, { defaultValue: locale }) })
          : fieldLabel('i18n', 'generic', t),
      );
      break;
    }
    default:
      rest(0, 'generic');
  }
  return crumbs.join(' › ');
}

/** A value excerpt (JSON text, possibly cut at a length limit) in words. */
export function excerptValue(text: string | null, t: Translate, field = ''): string {
  if (text === null) return t('designer.lifecycle.diffText.absent', {});
  try {
    return displayValue(JSON.parse(text) as unknown, t, 'generic', field);
  } catch {
    return t('designer.lifecycle.diffText.longValue', {});
  }
}

/** A component (or page root) by id, as authors know it. */
export function nodeTitle(document: ScriptDocument | undefined, nodeId: string, t: Translate) {
  let label: string | undefined;
  if (document)
    walkNodes(document, ({ node, pageId }) => {
      if (node.id !== nodeId) return true;
      const page = document.pages.find((p) => p.id === pageId);
      label =
        page?.layout.id === nodeId
          ? t('designer.lifecycle.diffText.page', { name: page.name })
          : componentName(node.type, node.id, t);
      return false;
    });
  return label ?? t('designer.lifecycle.diffText.component', { name: nodeId });
}
