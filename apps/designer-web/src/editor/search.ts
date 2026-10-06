import { walkNodes, type ScriptDocument } from '@verbis/script-schema';

/** Human text search is case/diacritic insensitive, including dotted/dotless Turkish i. */
export function searchText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replaceAll('ı', 'i').trim();
}

export function findComponents(
  document: ScriptDocument,
  value: string,
  locale: string,
  label: (type: string) => string,
): { id: string; type: string; pageId: string; pageName: string }[] {
  const query = searchText(value);
  if (!query) return [];
  const language = locale.split('-')[0] ?? locale;
  const translate = (key: string) =>
    document.i18n.messages[language]?.[key] ??
    document.i18n.messages[document.i18n.defaultLocale]?.[key] ??
    key;
  const matches: { id: string; type: string; pageId: string; pageName: string }[] = [];
  walkNodes(document, ({ node, pageId, pageIndex }) => {
    const type = label(node.type);
    const content = Object.entries(node.props).flatMap(([prop, value]) =>
      typeof value === 'string' ? [value, ...(prop.endsWith('Key') ? [translate(value)] : [])] : [],
    );
    if (node.a11y?.labelKey) content.push(translate(node.a11y.labelKey));
    if (searchText([node.id, node.type, type, ...content].join(' ')).includes(query))
      matches.push({
        id: node.id,
        type,
        pageId,
        pageName: document.pages[pageIndex]?.name ?? pageId,
      });
    return true;
  });
  return matches;
}
