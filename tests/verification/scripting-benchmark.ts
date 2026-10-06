import {
  findNode,
  ScriptDocumentSchema,
  TestScenarioSchema,
} from '../../packages/script-schema/dist/index.js';

/** Same neutral task for both products; synthetic data and mock-only data sources. */
export const benchmarkDocument = ScriptDocumentSchema.parse({
  schemaVersion: '1.1.0',
  id: '01928f3a-0000-7000-8000-000000000099',
  meta: {
    name: 'Benchmark — Parcel support',
    tags: ['benchmark', 'synthetic'],
    channels: ['voice'],
  },
  variables: [
    {
      key: 'requestType',
      type: 'enum',
      enumValues: ['tracking', 'address', 'escalation'],
      scope: 'session',
      default: 'tracking',
    },
    { key: 'parcelStatus', type: 'string', scope: 'session', default: '', persist: true },
    { key: 'resolution', type: 'string', scope: 'session', default: '', persist: true },
    { key: 'receipt', type: 'string', scope: 'session', default: '', persist: true },
  ],
  dataSources: [
    {
      id: 'lookupParcel',
      ref: 'tenant-datasource:benchmark-lookup',
      version: 1,
      inputs: { parcel: 'SYNTHETIC-001' },
      outputs: { status: { path: '$.status', variable: 'parcelStatus' } },
    },
    {
      id: 'recordResult',
      ref: 'tenant-datasource:benchmark-result',
      version: 1,
      inputs: { status: { $expr: 'vars.parcelStatus' }, resolution: { $expr: 'vars.resolution' } },
      outputs: { receipt: { path: '$.receipt', variable: 'receipt' } },
    },
  ],
  pages: [
    {
      id: 'welcome',
      name: 'Welcome',
      layout: {
        id: 'welcome-root',
        type: 'box',
        children: [
          { id: 'legal-text', type: 'scriptText', props: { textKey: 'legal', mustRead: true } },
          {
            id: 'request',
            type: 'select',
            props: {
              labelKey: 'request',
              options: ['tracking', 'address', 'escalation'].map((value) => ({
                value,
                labelKey: value,
              })),
            },
            bindings: [{ variable: 'requestType' }],
          },
          {
            id: 'welcome-next',
            type: 'button',
            props: { labelKey: 'next' },
            events: {
              onPress: [
                { type: 'validatePage' },
                { type: 'callDataSource', dataSource: 'lookupParcel' },
                { type: 'next' },
              ],
            },
          },
        ],
      },
    },
    ...['tracking', 'address', 'escalation'].map((id) => ({
      id,
      name: id,
      onEnter: [{ type: 'setVariable', variable: 'resolution', value: id }],
      layout: {
        id: `${id}-root`,
        type: 'box',
        children: [
          { id: `${id}-text`, type: 'scriptText', props: { textKey: id } },
          {
            id: `${id}-next`,
            type: 'button',
            props: { labelKey: 'next' },
            events: { onPress: [{ type: 'next' }] },
          },
        ],
      },
    })),
    {
      id: 'summary',
      name: 'Summary',
      layout: {
        id: 'summary-root',
        type: 'box',
        children: [
          { id: 'summary-text', type: 'scriptText', props: { textKey: 'summary' } },
          {
            id: 'finish',
            type: 'button',
            props: { labelKey: 'finish' },
            events: {
              onPress: [
                { type: 'callDataSource', dataSource: 'recordResult' },
                { type: 'submitOutcome', outcome: 'BENCHMARK_DONE' },
                { type: 'next' },
              ],
            },
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
      { id: 'branch', type: 'decision' },
      ...['tracking', 'address', 'escalation', 'summary'].map((page) => ({
        id: `n-${page}`,
        type: 'page',
        page,
      })),
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'start', from: 'n-welcome', to: 'branch' },
      ...['tracking', 'address', 'escalation'].map((id) => ({
        id: `choose-${id}`,
        from: 'branch',
        to: `n-${id}`,
        when: { $expr: `vars.requestType == "${id}"` },
      })),
      ...['tracking', 'address', 'escalation'].map((id) => ({
        id: `done-${id}`,
        from: `n-${id}`,
        to: 'n-summary',
      })),
      { id: 'finish-edge', from: 'n-summary', to: 'end' },
    ],
  },
  i18n: {
    defaultLocale: 'tr',
    messages: {
      tr: {
        legal: 'Bu görüşme kalite amacıyla kaydedilebilir. Okuduğumu onaylıyorum.',
        request: 'Talep türü',
        tracking: 'Kargo takibi',
        address: 'Adres değişikliği',
        escalation: 'Uzman desteği',
        summary: 'Sonuç kaydı',
        next: 'İleri',
        finish: 'Tamamla',
      },
      en: {
        legal: 'This call may be recorded for quality. I confirm I have read this.',
        request: 'Request type',
        tracking: 'Parcel tracking',
        address: 'Address change',
        escalation: 'Specialist support',
        summary: 'Record result',
        next: 'Next',
        finish: 'Finish',
      },
    },
  },
});

export const benchmarkScenarios = ['tracking', 'address', 'escalation'].flatMap((branch) =>
  ['tr', 'en'].map((locale) =>
    TestScenarioSchema.parse({
      id: `${branch}${locale.toUpperCase()}`,
      name: `${branch} / ${locale}`,
      synthetic: true,
      context: { locale },
      dataSources: {
        lookupParcel: { outputs: { status: 'IN_TRANSIT' } },
        recordResult: { outputs: { receipt: 'SYNTHETIC-RECEIPT' } },
      },
      steps: [
        { type: 'variable', variable: 'requestType', value: branch },
        { type: 'read', node: 'legal-text', acknowledged: true },
        { type: 'event', node: 'welcome-next', event: 'onPress' },
        { type: 'event', node: `${branch}-next`, event: 'onPress' },
        { type: 'event', node: 'finish', event: 'onPress' },
      ],
      expected: {
        ended: true,
        outcome: 'BENCHMARK_DONE',
        variables: { parcelStatus: 'IN_TRANSIT', resolution: branch, receipt: 'SYNTHETIC-RECEIPT' },
      },
    }),
  ),
);

export function faultyBenchmark(kind: 'branch' | 'mapping' | 'compliance') {
  const document = structuredClone(benchmarkDocument);
  if (kind === 'branch') {
    const edge = document.flow.edges.find((e) => e.id === 'choose-tracking');
    if (!edge) throw new Error('Benchmark tracking edge missing');
    edge.to = 'n-address';
  }
  if (kind === 'mapping') {
    const output = document.dataSources[0]?.outputs['status'];
    if (!output) throw new Error('Benchmark lookup output missing');
    output.variable = 'receipt';
  }
  if (kind === 'compliance') {
    const legal = findNode(document, 'legal-text');
    if (!legal) throw new Error('Benchmark legal text missing');
    legal.node.props['mustRead'] = false;
  }
  return document;
}
