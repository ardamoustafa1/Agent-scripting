import {
  NodeSchema,
  PageSchema,
  VariableSchema,
  type NodeInput,
  type ScriptDocument,
  type VariableInput,
} from '@verbis/script-schema';

/**
 * Verified building blocks (DIFFERENTIATORS A6): ready pages for recurring conversation steps,
 * with their variables (classified), bilingual script text and flow wiring. Each block validates
 * without errors on insertion; the block catalog is covered by tests.
 */
export const BLOCK_IDS = [
  'privacyConsent',
  'identityCheck',
  'satisfactionSurvey',
  'callback',
] as const;
export type BlockId = (typeof BLOCK_IDS)[number];

interface BlockDefinition {
  variables: VariableInput[];
  /** Page children; `$var:<key>` in a binding is replaced by the variable's final key. */
  children: NodeInput[];
  messages: { tr: Record<string, string>; en: Record<string, string> };
}

const next: NodeInput = {
  id: 'next',
  type: 'nextButton',
  props: { labelKey: 'common.next' },
  events: { onPress: [{ type: 'next' }] },
};

const BLOCKS: Record<BlockId, BlockDefinition> = {
  privacyConsent: {
    variables: [{ key: 'marketingConsent', type: 'boolean', scope: 'session', default: false }],
    children: [
      {
        id: 'notice',
        type: 'privacyNotice',
        props: { textKey: 'blocks.privacy.notice', noticeVersion: '1' },
      },
      {
        id: 'consent',
        type: 'explicitConsent',
        props: {
          labelKey: 'blocks.privacy.consent',
          purposeKey: 'blocks.privacy.purpose',
          value: false,
        },
        bindings: [{ prop: 'value', variable: '$var:marketingConsent' }],
      },
      next,
    ],
    messages: {
      tr: {
        'blocks.privacy.notice':
          'Kişisel verileriniz, talebinizi yanıtlamak amacıyla 6698 sayılı KVKK kapsamında işlenmektedir. Ayrıntılı aydınlatma metnine internet sitemizden ulaşabilirsiniz.',
        'blocks.privacy.consent': 'Kampanya ve fırsatlarla ilgili iletişim almayı kabul ediyorum.',
        'blocks.privacy.purpose': 'Pazarlama iletişimi',
      },
      en: {
        'blocks.privacy.notice':
          'Your personal data is processed to handle your request under applicable data protection law. The full privacy notice is available on our website.',
        'blocks.privacy.consent': 'I agree to receive communication about offers and campaigns.',
        'blocks.privacy.purpose': 'Marketing communication',
      },
    },
  },
  identityCheck: {
    variables: [
      { key: 'customerTckn', type: 'string', scope: 'session', classification: 'pii' },
      { key: 'customerBirthDate', type: 'date', scope: 'session', classification: 'pii' },
      {
        key: 'identityVerified',
        type: 'enum',
        scope: 'session',
        enumValues: ['yes', 'no'],
        classification: 'internal',
      },
    ],
    children: [
      { id: 'guide', type: 'scriptText', props: { textKey: 'blocks.identity.guide' } },
      {
        id: 'tckn',
        type: 'tcknInput',
        props: { labelKey: 'blocks.identity.tckn', required: true },
        bindings: [{ prop: 'value', variable: '$var:customerTckn' }],
      },
      {
        id: 'birth',
        type: 'datePicker',
        props: { labelKey: 'blocks.identity.birthDate', required: true },
        bindings: [{ prop: 'value', variable: '$var:customerBirthDate' }],
      },
      {
        id: 'verified',
        type: 'radioGroup',
        props: {
          labelKey: 'blocks.identity.verified',
          required: true,
          options: [
            { value: 'yes', labelKey: 'blocks.identity.yes' },
            { value: 'no', labelKey: 'blocks.identity.no' },
          ],
        },
        bindings: [{ prop: 'value', variable: '$var:identityVerified' }],
      },
      next,
    ],
    messages: {
      tr: {
        'blocks.identity.guide':
          'Güvenliğiniz için kimliğinizi doğrulamam gerekiyor. T.C. kimlik numaranızı ve doğum tarihinizi alabilir miyim?',
        'blocks.identity.tckn': 'T.C. kimlik numarası',
        'blocks.identity.birthDate': 'Doğum tarihi',
        'blocks.identity.verified': 'Kimlik doğrulandı mı?',
        'blocks.identity.yes': 'Evet',
        'blocks.identity.no': 'Hayır',
      },
      en: {
        'blocks.identity.guide':
          'For your security I need to verify your identity. May I have your national ID number and date of birth?',
        'blocks.identity.tckn': 'National ID number',
        'blocks.identity.birthDate': 'Date of birth',
        'blocks.identity.verified': 'Identity verified?',
        'blocks.identity.yes': 'Yes',
        'blocks.identity.no': 'No',
      },
    },
  },
  satisfactionSurvey: {
    variables: [
      { key: 'csatScore', type: 'number', scope: 'session', default: null },
      { key: 'csatComment', type: 'string', scope: 'session', default: '' },
    ],
    children: [
      { id: 'ask', type: 'scriptText', props: { textKey: 'blocks.survey.ask' } },
      {
        id: 'score',
        type: 'rating',
        props: { labelKey: 'blocks.survey.score', min: 1, max: 5 },
        bindings: [{ prop: 'value', variable: '$var:csatScore' }],
      },
      {
        id: 'comment',
        type: 'textArea',
        props: { labelKey: 'blocks.survey.comment' },
        bindings: [{ prop: 'value', variable: '$var:csatComment' }],
      },
      next,
    ],
    messages: {
      tr: {
        'blocks.survey.ask': 'Bugünkü görüşmemizi 1 ile 5 arasında nasıl puanlarsınız?',
        'blocks.survey.score': 'Memnuniyet puanı',
        'blocks.survey.comment': 'Müşteri yorumu',
      },
      en: {
        'blocks.survey.ask': 'On a scale of 1 to 5, how would you rate today’s conversation?',
        'blocks.survey.score': 'Satisfaction score',
        'blocks.survey.comment': 'Customer comment',
      },
    },
  },
  callback: {
    variables: [
      { key: 'callbackDate', type: 'date', scope: 'session' },
      { key: 'callbackTime', type: 'string', scope: 'session', default: '' },
    ],
    children: [
      { id: 'offer', type: 'scriptText', props: { textKey: 'blocks.callback.offer' } },
      {
        id: 'date',
        type: 'datePicker',
        props: { labelKey: 'blocks.callback.date', required: true },
        bindings: [{ prop: 'value', variable: '$var:callbackDate' }],
      },
      {
        id: 'time',
        type: 'timePicker',
        props: { labelKey: 'blocks.callback.time', required: true },
        bindings: [{ prop: 'value', variable: '$var:callbackTime' }],
      },
      next,
    ],
    messages: {
      tr: {
        'blocks.callback.offer':
          'Sizi uygun olduğunuz bir zamanda geri arayabiliriz. Hangi gün ve saat size uyar?',
        'blocks.callback.date': 'Geri arama tarihi',
        'blocks.callback.time': 'Geri arama saati',
      },
      en: {
        'blocks.callback.offer':
          'We can call you back at a time that suits you. Which day and time work best?',
        'blocks.callback.date': 'Callback date',
        'blocks.callback.time': 'Callback time',
      },
    },
  },
};

function freeKey(doc: ScriptDocument, key: string): string {
  const taken = new Set(doc.variables.map((variable) => variable.key));
  if (!taken.has(key)) return key;
  let index = 2;
  while (taken.has(`${key}${String(index)}`)) index += 1;
  return `${key}${String(index)}`;
}

/**
 * Appends `block` as a new page (mutating a draft inside `EditorStore.edit`) and wires it in front
 * of the flow's end, like adding a page. Variable keys never collide; returns the new page id.
 */
export function insertBlock(
  doc: ScriptDocument,
  block: BlockId,
  pageName: string,
  newId: () => string,
): string {
  const definition = BLOCKS[block];
  const keys = new Map<string, string>();
  for (const input of definition.variables) {
    const key = freeKey(doc, input.key);
    keys.set(input.key, key);
    doc.variables.push(VariableSchema.parse({ ...input, key }));
  }
  const pageId = newId();
  const children = definition.children.map((child) =>
    NodeSchema.parse({
      ...child,
      id: `${pageId}-${child.id}`,
      bindings: (child.bindings ?? []).map((binding) =>
        'variable' in binding && binding.variable.startsWith('$var:')
          ? { ...binding, variable: keys.get(binding.variable.slice(5)) ?? binding.variable }
          : binding,
      ),
    }),
  );
  doc.pages.push(
    PageSchema.parse({
      id: pageId,
      name: pageName,
      layout: { id: newId(), type: 'box', children },
    }),
  );
  for (const locale of ['tr', 'en'] as const) {
    doc.i18n.messages[locale] = { ...definition.messages[locale], ...doc.i18n.messages[locale] };
  }
  const node = { id: `flow-${pageId}`, type: 'page' as const, page: pageId };
  doc.flow.nodes.push(node);
  const endIds = new Set(doc.flow.nodes.filter((n) => n.type === 'end').map((n) => n.id));
  const incoming = doc.flow.edges.find((e) => endIds.has(e.to) && !e.maxIterations);
  if (incoming) {
    doc.flow.edges.push({ id: `edge-${newId()}`, from: node.id, to: incoming.to });
    incoming.to = node.id;
  }
  return pageId;
}
