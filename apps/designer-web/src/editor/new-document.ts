import { ScriptDocumentSchema, SCRIPT_SCHEMA_VERSION } from '@verbis/script-schema';

/** An empty authoring draft with a usable page → end flow; labels come from i18n. */
export function newDocument(input: {
  id: string;
  name: string;
  pageName: string;
  next: { tr: string; en: string };
}) {
  return ScriptDocumentSchema.parse({
    schemaVersion: SCRIPT_SCHEMA_VERSION,
    id: input.id,
    meta: { name: input.name },
    pages: [
      {
        id: 'home',
        name: input.pageName,
        layout: {
          id: 'home-root',
          type: 'box',
          children: [
            {
              id: 'btn-next',
              type: 'button',
              props: { labelKey: 'common.next' },
              events: { onPress: [{ type: 'next' }] },
            },
          ],
        },
      },
    ],
    flow: {
      id: 'main',
      start: 'n-home',
      nodes: [
        { id: 'n-home', type: 'page', page: 'home' },
        { id: 'n-end', type: 'end' },
      ],
      edges: [{ id: 'e1', from: 'n-home', to: 'n-end' }],
    },
    i18n: {
      defaultLocale: 'tr',
      messages: { tr: { 'common.next': input.next.tr }, en: { 'common.next': input.next.en } },
    },
  });
}
