import { ScriptDocumentSchema, type ScriptDocument, type NodeInput } from '@verbis/script-schema';
/** Synthetic data only. Shared by unit tests and the real-browser benchmark. */
export function runtimeFixture(children: NodeInput[] = []): ScriptDocument {
  return ScriptDocumentSchema.parse({
    schemaVersion: '1.1.0',
    id: '01928f3a-0000-7000-8000-0000000000ff',
    meta: { name: 'Runtime fixture' },
    variables: [
      { key: 'name', type: 'string', scope: 'session', default: '', classification: 'public' },
      { key: 'other', type: 'string', scope: 'session', default: '', classification: 'public' },
      { key: 'count', type: 'number', scope: 'session', default: 0, classification: 'public' },
      { key: 'constant', type: 'string', scope: 'global', default: 'fixed' },
    ],
    dataSources: [
      {
        id: 'lookup',
        ref: 'tenant-datasource:lookup',
        version: 1,
        inputs: { name: { $expr: 'vars.name' } },
        outputs: { result: { path: '$.result', variable: 'name' } },
      },
    ],
    pages: [
      { id: 'home', name: 'Home', layout: { id: 'home-root', type: 'box', children } },
      { id: 'second', name: 'Second', layout: { id: 'second-root', type: 'box' } },
    ],
    flow: {
      id: 'main',
      start: 'home-flow',
      nodes: [
        { id: 'home-flow', type: 'page', page: 'home' },
        { id: 'second-flow', type: 'page', page: 'second' },
        { id: 'end-flow', type: 'end' },
      ],
      edges: [
        { id: 'first-edge', from: 'home-flow', to: 'second-flow' },
        { id: 'last-edge', from: 'second-flow', to: 'end-flow' },
      ],
    },
    rules: [
      {
        id: 'has-name',
        when: { $expr: 'vars.name != ""' },
        then: [{ type: 'setVariable', variable: 'count', value: 1 }],
      },
    ],
    i18n: {
      defaultLocale: 'tr',
      messages: {
        tr: {
          'common.run': 'Çalıştır',
          'common.title': 'Onay',
          'common.description': 'İşleme devam edilsin mi?',
          'common.name': 'Ad',
          'common.result': 'Sonuç',
          'common.greeting': 'Merhaba {name}',
          'common.invalid': 'Geçersiz değer',
        },
        en: {
          'common.run': 'Run',
          'common.title': 'Confirm',
          'common.description': 'Continue with this operation?',
          'common.name': 'Name',
          'common.result': 'Result',
          'common.greeting': 'Hello {name}',
          'common.invalid': 'Invalid value',
        },
      },
    },
  });
}
