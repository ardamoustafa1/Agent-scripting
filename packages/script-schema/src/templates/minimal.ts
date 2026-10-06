import type { ScriptDocumentInput } from '../schema/document.js';

/** Smallest valid script: one page, one flow `page → end`. Returns a fresh copy each call. */
export function minimalScript(): ScriptDocumentInput {
  return {
    schemaVersion: '1.1.0',
    id: '01928f3a-0000-7000-8000-0000000000ff',
    meta: { name: 'Minimal' },
    pages: [
      {
        id: 'home',
        name: 'Home',
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
      messages: { tr: { 'common.next': 'İleri' }, en: { 'common.next': 'Next' } },
    },
  };
}
