import { createHash } from 'node:crypto';

import { validateScriptDocument, type ScriptDocument } from '@verbis/script-schema';
import { VALID_FIXTURES } from '@verbis/script-schema/fixtures';
import {
  AnalyticsFactSchema,
  IntegrationDefinitionSchema,
  type AnalyticsFact,
} from '@verbis/shared-types';

export const DEMO_SLUG = 'verbis-demo';
export const DEMO_SEED_VERSION = 2;
export const demoId = (n: number): string =>
  `019c0000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
export const DEMO_TENANT_ID = demoId(1);
export const DEMO_CONNECTOR_ID = demoId(2);
export const DEMO_SHARED_ID = demoId(3);
export const DEMO_SHARED_VERSION_ID = demoId(4);
export const DEMO_ACTOR = 'service:seed-demo';
export const DEMO_USERS = [
  {
    id: demoId(10),
    email: 'yonetici@example.invalid',
    displayName: 'Demo Yönetici',
    roles: ['tenant_admin', 'report_viewer'],
  },
  {
    id: demoId(11),
    email: 'tasarimci@example.invalid',
    displayName: 'Demo Tasarımcı',
    roles: ['script_designer', 'integration_engineer'],
  },
  {
    id: demoId(12),
    email: 'onayci@example.invalid',
    displayName: 'Demo Onaycı',
    roles: ['script_approver', 'campaign_manager'],
  },
  {
    id: demoId(13),
    email: 'agent@example.invalid',
    displayName: 'Demo Agent',
    roles: ['agent'],
    platformId: 'demo-agent-1',
  },
  {
    id: demoId(14),
    email: 'denetci@example.invalid',
    displayName: 'Demo Denetçi',
    roles: ['security_auditor', 'report_viewer'],
  },
] as const;

export function assertDemoTarget(source: Record<string, string | undefined>): string {
  if (!['development', 'test'].includes(source['NODE_ENV'] ?? ''))
    throw new Error('Demo seed requires NODE_ENV=development or test');
  const raw = source['DATABASE_URL'];
  if (!raw) throw new Error('DATABASE_URL is required');
  const url = new URL(raw);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]', 'postgres'].includes(url.hostname)
  )
    throw new Error('Demo seed accepts a local database only');
  if (!['/verbis', '/verbis_dev', '/verbis_demo', '/verbis_test'].includes(url.pathname))
    throw new Error('Demo seed database name is not approved');
  return raw;
}

export const sharedFragment = {
  pages: [
    {
      id: 'demo-intro',
      name: 'Ortak Karşılama',
      titleKey: 'demo.intro.title',
      layout: {
        id: 'demo-intro-root',
        type: 'box',
        children: [
          {
            id: 'demo-intro-heading',
            type: 'heading',
            props: { textKey: 'demo.intro.title', level: 1 },
          },
          {
            id: 'demo-intro-text',
            type: 'scriptText',
            props: { textKey: 'demo.intro.text', mustRead: true },
          },
          {
            id: 'demo-intro-next',
            type: 'button',
            props: { labelKey: 'demo.intro.next' },
            events: { onPress: [{ type: 'next' }] },
          },
        ],
      },
    },
  ],
  variables: [],
  dataSources: [],
  i18n: {
    defaultLocale: 'tr',
    messages: {
      tr: {
        'demo.intro.title': 'Verbis Demo — Ortak Karşılama',
        'demo.intro.text':
          'Bu görüşme yalnız sentetik demo verisi kullanır. Gerçek müşteri veya ödeme bilgisi girmeyin.',
        'demo.intro.next': 'Başlayalım',
        'demo.tariff.plus': 'Demo 40 GB',
        'demo.tariff.unlimited': 'Demo Limitsiz',
      },
      en: {
        'demo.intro.title': 'Verbis Demo — Shared Welcome',
        'demo.intro.text':
          'This interaction uses synthetic demo data only. Do not enter customer or payment details.',
        'demo.intro.next': 'Start',
        'demo.tariff.plus': 'Demo 40 GB',
        'demo.tariff.unlimited': 'Demo Unlimited',
      },
    },
  },
};

export interface DemoCampaign {
  id: string;
  code: string;
  name: string;
  queue: string;
  scriptId: string;
  versionId: string;
  assignmentId: string;
  mappingId: string;
  linkId: string;
  document: ScriptDocument;
}
export function demoCampaigns(): DemoCampaign[] {
  const names = [
    ['creditCardSales', 'DEMO_KART', 'Kredi Kartı Satış'],
    ['telecomTariffChange', 'DEMO_TARIFE', 'Tarife Yükseltme'],
    ['collections', 'DEMO_TAHSILAT', 'Tahsilat'],
    ['survey', 'DEMO_ANKET', 'Memnuniyet Anketi'],
  ] as const;
  return names.map(([fixture, code, name], index) => {
    const input = structuredClone(VALID_FIXTURES[fixture]);
    if (!input) throw new Error('Demo fixture unavailable');
    const scriptId = demoId(100 + index);
    input.id = scriptId;
    input.meta.name = name;
    input.meta.tags = [...(input.meta.tags ?? []), 'demo'];
    const intro = sharedFragment.pages[0];
    if (!intro) throw new Error('Shared demo welcome is missing');
    input.pages.unshift(structuredClone(intro));
    input.flow.nodes.unshift({ id: 'demo-intro-node', type: 'page', page: 'demo-intro' });
    input.flow.edges = [
      { id: 'demo-intro-edge', from: 'demo-intro-node', to: input.flow.start },
      ...(input.flow.edges ?? []),
    ];
    input.flow.start = 'demo-intro-node';
    input.i18n.messages['tr'] = {
      ...input.i18n.messages['tr'],
      ...sharedFragment.i18n.messages.tr,
    };
    input.i18n.messages['en'] = {
      ...input.i18n.messages['en'],
      ...sharedFragment.i18n.messages.en,
    };
    const result = validateScriptDocument(input);
    if (!result.ok)
      throw new Error(
        'Demo document validation failed: ' + result.issues.map((issue) => issue.code).join(','),
      );
    return {
      id: demoId(200 + index),
      code,
      name,
      queue: 'demo-' + fixture.toLowerCase(),
      scriptId,
      versionId: demoId(300 + index),
      assignmentId: demoId(400 + index),
      mappingId: demoId(500 + index),
      linkId: demoId(600 + index),
      document: result.document,
    };
  });
}

/** Mock response covers the checked-in script fixtures; no network or secret is configured. */
export function mockDefinition(key: string) {
  const payload = {
    tariff: { code: 'S20' },
    usage: { dataGb: 12, minutes: 180 },
    contract: { endDate: '2027-10-03' },
    holder: { name: 'Demo Müşteri' },
    balance: { total: 1200, daysPastDue: 15 },
    payments: [],
    orderId: 'DEMO-ORDER',
    id: 'DEMO-SURVEY',
    fullName: 'Demo Müşteri',
    segment: 'gold',
    score: 80,
    approvedLimit: 15000,
    success: true,
    valid: true,
    verified: true,
    reference: 'DEMO-REF',
    totalDebt: 1200,
    amount: 1200,
    history: [],
    tariffs: [],
    offers: [
      { value: 'S40', labelKey: 'demo.tariff.plus' },
      { value: 'UNL', labelKey: 'demo.tariff.unlimited' },
    ],
    eligible: true,
    status: 'accepted',
    saved: true,
  };
  return IntegrationDefinitionSchema.parse({
    baseUrl: 'https://demo-services.example.invalid',
    endpoint: '/' + key,
    method: 'POST',
    auth: { type: 'none' },
    inputSchema: { type: 'object', additionalProperties: true },
    outputSchema: { type: 'object', additionalProperties: true },
    profiles: {
      test: { baseUrl: 'https://demo-services.example.invalid', auth: { type: 'none' } },
    },
    mock: { enabled: true, response: { ...payload, data: payload } },
    mockScenarios: [
      { key: 'success', kind: 'success', response: { ...payload, data: payload } },
      { key: 'empty', kind: 'empty', response: { data: {} } },
      { key: 'failure', kind: 'error', response: { code: 'DEMO_FAILURE' } },
      { key: 'slow', kind: 'delay', delayMs: 1500, response: { data: payload } },
    ],
  });
}

export function demoFacts(
  campaign: DemoCampaign,
  day: string,
  ordinal: number,
): {
  sessionId: string;
  interactionId: string;
  start: Date;
  end: Date;
  completed: boolean;
  facts: AnalyticsFact[];
} {
  const start = new Date(day + 'T09:00:00.000Z');
  start.setUTCDate(start.getUTCDate() - Math.floor(ordinal / 4));
  start.setUTCMinutes((ordinal % 4) * 10);
  const end = new Date(start.getTime() + 180000 + ordinal * 1000);
  const sessionId = demoId(1000 + ordinal);
  const completed = ordinal % 5 !== 0;
  const common = {
    tenantId: DEMO_TENANT_ID,
    sessionId,
    scriptId: campaign.scriptId,
    versionId: campaign.versionId,
    campaignId: campaign.id,
    teamId: null,
    channel: 'voice',
    agent: createHash('sha256').update('synthetic-demo-agent').digest('hex'),
    requiredReadIds: [],
    pageId: null,
    nodeId: null,
    sourceId: null,
    variant: null,
    experimentId: null,
    error: false,
  };
  const facts = [
    AnalyticsFactSchema.parse({
      ...common,
      eventId: demoId(2000 + ordinal * 3),
      sequence: 0,
      at: start.toISOString(),
      type: 'start',
      state: 'active',
      outcome: null,
      durationMs: null,
    }),
    AnalyticsFactSchema.parse({
      ...common,
      eventId: demoId(2001 + ordinal * 3),
      sequence: 1,
      at: new Date(start.getTime() + 15000).toISOString(),
      type: 'page',
      state: 'active',
      pageId: 'demo-intro',
      outcome: null,
      durationMs: 15000,
    }),
    AnalyticsFactSchema.parse({
      ...common,
      eventId: demoId(2002 + ordinal * 3),
      sequence: 2,
      at: end.toISOString(),
      type: 'outcome',
      state: completed ? 'completed' : 'abandoned',
      outcome: completed ? 'demo-success' : 'demo-abandoned',
      durationMs: end.getTime() - start.getTime(),
    }),
  ];
  return { sessionId, interactionId: demoId(3000 + ordinal), start, end, completed, facts };
}

/** Include nested subflow/action outcomes in the campaign wrap-up allowlist. */
export function demoOutcomeCodes(document: ScriptDocument): string[] {
  const codes = new Set(['demo-success', 'demo-abandoned']);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (
      (node['type'] === 'end' || node['type'] === 'submitOutcome') &&
      typeof node['outcome'] === 'string'
    )
      codes.add(node['outcome']);
    if (node['type'] === 'setDisposition' && typeof node['code'] === 'string')
      codes.add(node['code']);
    Object.values(node).forEach(visit);
  };
  visit(document);
  return [...codes].sort();
}

/** Manual grants are limited to the four synthetic campaigns; never use an all-tenant wildcard. */
export function demoRoleScope(role: string): { campaignIds?: string[] } {
  return [
    'script_designer',
    'script_approver',
    'campaign_manager',
    'agent',
    'report_viewer',
  ].includes(role)
    ? { campaignIds: Array.from({ length: 4 }, (_, index) => demoId(200 + index)) }
    : {};
}
