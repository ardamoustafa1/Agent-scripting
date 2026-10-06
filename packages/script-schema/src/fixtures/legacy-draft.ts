/**
 * A 0.9.0 document in the SCRIPT_MODEL draft shape (pre-ADR-0010). `loadScriptDocument`
 * migrates it to the current version.
 */
export const legacyDraftScript = {
  schemaVersion: '0.9.0',
  id: '01928f3a-0000-7000-8000-000000000009',
  meta: { name: 'Eski Karşılama', defaultLocale: 'tr', locales: ['tr', 'en'] },
  variables: [{ key: 'note', type: 'string', scope: 'screen' }],
  pages: [
    {
      id: 'welcome',
      name: 'Karşılama',
      onEnter: [{ action: 'notify', messageKey: 'welcome.hello' }],
      timers: [
        {
          id: 'nudge',
          durationMs: 5000,
          onElapsed: [{ action: 'notify', messageKey: 'welcome.hello', tone: 'warning' }],
        },
      ],
      layout: {
        id: 'welcome-root',
        type: 'box',
        children: [
          {
            id: 'in-note',
            type: 'textArea',
            props: { labelKey: 'welcome.note' },
            bindings: [{ variable: 'note' }],
          },
          {
            id: 'btn-help',
            type: 'button',
            props: { labelKey: 'welcome.help' },
            events: {
              onPress: [
                {
                  action: 'conditional',
                  if: { $expr: "vars.note == ''" },
                  then: [{ action: 'openDialog', page: 'help' }],
                  else: [{ action: 'runFlow', flow: 'farewell' }],
                },
              ],
            },
          },
        ],
      },
    },
    {
      id: 'help',
      name: 'Yardım',
      layout: {
        id: 'help-root',
        type: 'box',
        children: [
          {
            id: 'btn-help-close',
            type: 'button',
            props: { labelKey: 'common.close' },
            events: { onPress: [{ action: 'closeDialog' }] },
          },
        ],
      },
    },
  ],
  flow: {
    id: 'main',
    start: 'n-welcome',
    nodes: [
      { id: 'n-welcome', type: 'page', page: 'welcome' },
      { id: 'n-end', type: 'end' },
    ],
    edges: [{ id: 'e1', from: 'n-welcome', to: 'n-end' }],
  },
  subflows: [{ id: 'farewell', start: 'f-end', nodes: [{ id: 'f-end', type: 'end' }] }],
  rules: [
    {
      id: 'r-note',
      when: { fact: 'vars.note', op: 'exists' },
      then: [{ action: 'notify', messageKey: 'welcome.hello' }],
    },
  ],
  i18n: {
    tr: {
      'welcome.hello': 'Merhaba',
      'welcome.note': 'Not',
      'welcome.help': 'Yardım',
      'common.close': 'Kapat',
    },
    en: {
      'welcome.hello': 'Hello',
      'welcome.note': 'Note',
      'welcome.help': 'Help',
      'common.close': 'Close',
    },
  },
} as const;
