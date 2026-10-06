import { z } from 'zod';

/**
 * Shared screens: a reusable fragment (pages plus the variables, data sources and translations
 * they need). A script version uses it
 *  - `linked`: the fragment's pages are owned by the shared screen and re-materialized from the
 *    pinned shared-screen version on every new script version (designer edits are overwritten);
 *  - `detached`: copied once; afterwards the script owns the pages (provenance is kept).
 */
export const ScreenFragmentSchema = z
  .strictObject({
    pages: z.array(z.record(z.string(), z.unknown())).min(1).max(50),
    variables: z.array(z.record(z.string(), z.unknown())).max(500).default([]),
    dataSources: z.array(z.record(z.string(), z.unknown())).max(100).default([]),
    messages: z.record(z.string(), z.record(z.string(), z.string().max(4000))).default({}),
  })
  .meta({ id: 'ScreenFragment' });
export type ScreenFragment = z.output<typeof ScreenFragmentSchema>;

export interface FragmentUse {
  readonly sharedScreenKey: string;
  readonly mode: 'linked' | 'detached';
  readonly fragment: ScreenFragment;
}

export interface CompositionConflict {
  readonly kind: 'page' | 'variable' | 'dataSource' | 'translation';
  readonly id: string;
  readonly sharedScreenKey: string;
}

export interface Composition {
  readonly document: Record<string, unknown>;
  readonly pageIds: ReadonlyMap<string, string[]>;
  readonly conflicts: readonly CompositionConflict[];
}

type Item = Record<string, unknown>;
const idOf = (item: Item): string => (typeof item['id'] === 'string' ? item['id'] : '');
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function mergeById(
  base: Item[],
  incoming: readonly Item[],
  kind: CompositionConflict['kind'],
  key: string,
  conflicts: CompositionConflict[],
): Item[] {
  const out = [...base];
  for (const item of incoming) {
    const index = out.findIndex((x) => idOf(x) === idOf(item));
    if (index === -1) out.push(item);
    else if (!same(out[index], item))
      conflicts.push({ kind, id: idOf(item), sharedScreenKey: key });
  }
  return out;
}

/** Deterministic: fragments are applied in the given order; the input document is not mutated. */
export function composeDocument(
  document: Record<string, unknown>,
  uses: readonly FragmentUse[],
): Composition {
  // Preserve legacy document shape for the schema migrator when there is nothing to compose.
  if (uses.length === 0)
    return { document: structuredClone(document), pageIds: new Map(), conflicts: [] };
  const conflicts: CompositionConflict[] = [];
  const pageIds = new Map<string, string[]>();
  let pages = Array.isArray(document['pages']) ? [...(document['pages'] as Item[])] : [];
  let variables = Array.isArray(document['variables'])
    ? [...(document['variables'] as Item[])]
    : [];
  let dataSources = Array.isArray(document['dataSources'])
    ? [...(document['dataSources'] as Item[])]
    : [];
  const i18n = (document['i18n'] ?? { defaultLocale: 'tr', messages: {} }) as {
    defaultLocale: string;
    messages: Record<string, Record<string, string>>;
  };
  const messages: Record<string, Record<string, string>> = Object.fromEntries(
    Object.entries(i18n.messages).map(([locale, dict]) => [locale, { ...dict }]),
  );
  const claimed = new Map<string, string>();

  for (const use of uses) {
    const ids: string[] = [];
    for (const page of use.fragment.pages) {
      const id = idOf(page);
      ids.push(id);
      const owner = claimed.get(id);
      if (owner !== undefined && owner !== use.sharedScreenKey) {
        conflicts.push({ kind: 'page', id, sharedScreenKey: use.sharedScreenKey });
        continue;
      }
      claimed.set(id, use.sharedScreenKey);
      const index = pages.findIndex((p) => idOf(p) === id);
      if (index === -1) pages = [...pages, page];
      else if (use.mode === 'linked') pages = pages.map((p, i) => (i === index ? page : p));
      // detached + present: the script's own copy wins.
    }
    pageIds.set(use.sharedScreenKey, ids);
    variables = mergeById(
      variables,
      use.fragment.variables,
      'variable',
      use.sharedScreenKey,
      conflicts,
    );
    dataSources = mergeById(
      dataSources,
      use.fragment.dataSources,
      'dataSource',
      use.sharedScreenKey,
      conflicts,
    );
    for (const [locale, dict] of Object.entries(use.fragment.messages)) {
      const target = (messages[locale] ??= {});
      for (const [key, text] of Object.entries(dict)) {
        const existing = target[key];
        if (existing === undefined) target[key] = text;
        else if (existing !== text && use.mode === 'linked') {
          conflicts.push({
            kind: 'translation',
            id: `${locale}:${key}`,
            sharedScreenKey: use.sharedScreenKey,
          });
        }
      }
    }
  }
  return {
    document: { ...document, pages, variables, dataSources, i18n: { ...i18n, messages } },
    pageIds,
    conflicts,
  };
}

/** Extracts a fragment (pages by id + referenced variables/data sources/messages) from a document. */
export function extractFragment(
  document: Record<string, unknown>,
  pageIds: readonly string[],
): ScreenFragment {
  const pages = ((document['pages'] ?? []) as Item[]).filter((p) => pageIds.includes(idOf(p)));
  if (pages.length !== pageIds.length) throw new Error('unknown page id');
  const text = JSON.stringify(pages);
  const used = (id: string): boolean => text.includes(`vars.${id}`) || text.includes(`"${id}"`);
  const variables = ((document['variables'] ?? []) as Item[]).filter((v) => used(idOf(v)));
  const dataSources = ((document['dataSources'] ?? []) as Item[]).filter(
    (d) => text.includes(`ds.${idOf(d)}`) || text.includes(`"${idOf(d)}"`),
  );
  const all =
    (document['i18n'] as { messages?: Record<string, Record<string, string>> } | undefined)
      ?.messages ?? {};
  const messages = Object.fromEntries(
    Object.entries(all).map(([locale, dict]) => [
      locale,
      Object.fromEntries(Object.entries(dict).filter(([key]) => text.includes(`"${key}"`))),
    ]),
  );
  return { pages, variables, dataSources, messages };
}
