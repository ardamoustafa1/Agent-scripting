import type { ScriptDocumentInput } from '../schema/document.js';

/** Bank outbound credit card sales: lookup → identity check → needs → scoring → offer → consent. */
export const creditCardSalesScript: ScriptDocumentInput = {
  schemaVersion: '1.1.0',
  id: '01928f3a-0000-7000-8000-000000000001',
  meta: {
    name: 'Kredi Kartı Satış',
    description: 'Outbound credit card offer for pre-approved customers.',
    tags: ['banking', 'sales', 'outbound'],
    channels: ['voice'],
    capabilities: ['hold', 'transfer'],
  },
  variables: [
    {
      key: 'customerId',
      type: 'string',
      scope: 'interaction',
      source: 'interaction.attributes.customerId',
    },
    { key: 'customerName', type: 'string', scope: 'session', classification: 'pii', pii: true },
    {
      key: 'cardLast4',
      type: 'string',
      scope: 'page',
      classification: 'pci',
      pii: true,
      persist: false,
    },
    { key: 'identityVerified', type: 'boolean', scope: 'session', default: false, persist: true },
    { key: 'monthlyIncome', type: 'number', scope: 'session', classification: 'pii', pii: true },
    {
      key: 'cardProduct',
      type: 'enum',
      scope: 'session',
      enumValues: ['classic', 'gold', 'platinum'],
      default: 'classic',
      persist: true,
    },
    { key: 'creditLimit', type: 'number', scope: 'session', default: 0, persist: true },
    {
      key: 'maxCreditLimit',
      type: 'number',
      scope: 'global',
      default: 50000,
      classification: 'public',
    },
    { key: 'offerAccepted', type: 'boolean', scope: 'session', default: false, persist: true },
    { key: 'consentGiven', type: 'boolean', scope: 'session', default: false, persist: true },
  ],
  dataSources: [
    {
      id: 'customerLookup',
      ref: 'tenant-datasource:customer-profile',
      version: 2,
      inputs: { customerId: { $expr: 'vars.customerId' } },
      outputs: {
        fullName: { path: '$.data.fullName', variable: 'customerName' },
        segment: { path: '$.data.segment' },
      },
      policy: { trigger: 'manual', timeoutMs: 4000, cacheTtlSec: 60 },
    },
    {
      id: 'creditScore',
      ref: 'tenant-datasource:credit-score',
      version: 1,
      inputs: { customerId: { $expr: 'vars.customerId' }, income: { $expr: 'vars.monthlyIncome' } },
      outputs: {
        score: { path: '$.data.score' },
        approvedLimit: { path: '$.data.approvedLimit', variable: 'creditLimit' },
      },
      policy: { timeoutMs: 8000 },
    },
  ],
  pages: [
    {
      id: 'welcome',
      name: 'Karşılama',
      titleKey: 'welcome.title',
      layout: {
        id: 'welcome-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'lg' }, md: { maxWidth: 'lg' } },
        children: [
          { id: 'welcome-heading', type: 'heading', props: { textKey: 'welcome.title' } },
          {
            id: 'welcome-greeting',
            type: 'scriptText',
            props: { textKey: 'welcome.greeting' },
            bindings: [{ prop: 'params', expression: '{ agent: agent.firstName }' }],
          },
          {
            id: 'btn-welcome-next',
            type: 'button',
            props: { variant: 'primary', labelKey: 'common.next' },
            a11y: { shortcut: 'Alt+N' },
            events: { onPress: [{ type: 'next' }] },
          },
        ],
      },
    },
    {
      id: 'verify-identity',
      name: 'Kimlik Doğrulama',
      titleKey: 'verify.title',
      mandatory: true,
      layout: {
        id: 'verify-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'lg' } },
        children: [
          {
            id: 'verify-intro',
            type: 'scriptText',
            props: { textKey: 'verify.intro' },
            bindings: [{ prop: 'params', expression: '{ name: vars.customerName }' }],
          },
          {
            id: 'in-card-last4',
            type: 'maskedInput',
            props: { labelKey: 'verify.cardLast4', mask: '####' },
            bindings: [{ variable: 'cardLast4' }],
            requiredWhen: { $expr: 'true' },
          },
          {
            id: 'btn-verify',
            type: 'button',
            props: { variant: 'primary', labelKey: 'verify.submit' },
            enabledWhen: { $expr: 'len(vars.cardLast4) == 4' },
            events: {
              onPress: [
                {
                  type: 'validatePage',
                  onInvalid: [{ type: 'showToast', messageKey: 'verify.invalid', tone: 'warning' }],
                },
                {
                  type: 'setVariable',
                  variable: 'identityVerified',
                  value: { $expr: 'len(vars.cardLast4) == 4' },
                },
                { type: 'maskField', node: 'in-card-last4' },
                { type: 'next' },
              ],
            },
          },
        ],
      },
    },
    {
      id: 'needs',
      name: 'İhtiyaç Analizi',
      titleKey: 'needs.title',
      layout: {
        id: 'needs-root',
        type: 'box',
        style: { base: { display: 'grid', columns: 1, gap: 'md' }, lg: { columns: 2 } },
        children: [
          {
            id: 'in-income',
            type: 'numberInput',
            props: { labelKey: 'needs.income', min: 0 },
            bindings: [{ variable: 'monthlyIncome' }],
          },
          {
            id: 'in-product',
            type: 'select',
            props: {
              labelKey: 'needs.product',
              options: [
                { value: 'classic', labelKey: 'product.classic' },
                { value: 'gold', labelKey: 'product.gold' },
                { value: 'platinum', labelKey: 'product.platinum' },
              ],
            },
            bindings: [{ variable: 'cardProduct' }],
          },
          {
            id: 'needs-actions',
            type: 'box',
            style: {
              base: { direction: 'row', justify: 'between', colSpan: 1 },
              lg: { colSpan: 2 },
            },
            children: [
              {
                id: 'btn-needs-back',
                type: 'button',
                props: { labelKey: 'common.back' },
                events: { onPress: [{ type: 'back' }] },
              },
              {
                id: 'btn-needs-next',
                type: 'button',
                props: { variant: 'primary', labelKey: 'common.next' },
                events: { onPress: [{ type: 'validatePage' }, { type: 'next' }] },
              },
            ],
          },
        ],
      },
    },
    {
      id: 'offer',
      name: 'Teklif',
      titleKey: 'offer.title',
      timers: [
        {
          id: 'offer-timer',
          durationMs: 120000,
          autoStart: true,
          onElapsed: [{ type: 'showToast', messageKey: 'offer.timeWarning', tone: 'warning' }],
        },
      ],
      onLeave: [{ type: 'stopTimer', timer: 'offer-timer' }],
      layout: {
        id: 'offer-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'lg' } },
        children: [
          {
            id: 'offer-text',
            type: 'scriptText',
            props: { textKey: 'offer.pitch' },
            bindings: [
              {
                prop: 'params',
                expression:
                  '{ limit: min(vars.creditLimit, vars.maxCreditLimit), product: vars.cardProduct }',
              },
            ],
          },
          {
            id: 'offer-platinum-note',
            type: 'alert',
            props: { textKey: 'offer.platinumNote', tone: 'info' },
            visibleWhen: { $rule: 'r-platinum' },
          },
          {
            id: 'offer-actions',
            type: 'box',
            style: { base: { direction: 'row', gap: 'sm', justify: 'end' } },
            children: [
              {
                id: 'btn-offer-decline',
                type: 'button',
                props: { labelKey: 'offer.decline' },
                events: {
                  onPress: [
                    { type: 'setVariable', variable: 'offerAccepted', value: false },
                    { type: 'next' },
                  ],
                },
              },
              {
                id: 'btn-offer-accept',
                type: 'button',
                props: { variant: 'primary', labelKey: 'offer.accept' },
                events: {
                  onPress: [
                    { type: 'setVariable', variable: 'offerAccepted', value: true },
                    {
                      type: 'emitEvent',
                      name: 'offer.accepted',
                      payload: { product: { $expr: 'vars.cardProduct' } },
                    },
                    { type: 'next' },
                  ],
                },
              },
            ],
          },
        ],
      },
    },
    {
      id: 'consent',
      name: 'Onay',
      titleKey: 'consent.title',
      mandatory: true,
      layout: {
        id: 'consent-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'lg' } },
        children: [
          { id: 'consent-text', type: 'scriptText', props: { textKey: 'consent.legal' } },
          {
            id: 'btn-terms',
            type: 'button',
            props: { variant: 'ghost', labelKey: 'consent.showTerms' },
            events: { onPress: [{ type: 'openModal', page: 'terms' }] },
          },
          {
            id: 'in-consent',
            type: 'checkbox',
            props: { labelKey: 'consent.checkbox' },
            bindings: [{ prop: 'checked', variable: 'consentGiven' }],
            requiredWhen: { $expr: 'true' },
          },
          {
            id: 'btn-consent-next',
            type: 'button',
            props: { variant: 'primary', labelKey: 'common.next' },
            events: {
              onPress: [
                {
                  type: 'validatePage',
                  onInvalid: [
                    { type: 'showToast', messageKey: 'consent.required', tone: 'danger' },
                  ],
                },
                {
                  type: 'conditional',
                  if: { $expr: 'vars.consentGiven == true' },
                  then: [
                    {
                      type: 'logEvent',
                      level: 'info',
                      event: 'consent.recorded',
                      data: { product: { $expr: 'vars.cardProduct' } },
                    },
                    { type: 'next' },
                  ],
                },
              ],
            },
          },
        ],
      },
    },
    {
      id: 'terms',
      name: 'Sözleşme Metni (modal)',
      titleKey: 'terms.title',
      layout: {
        id: 'terms-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', scroll: true } },
        children: [
          { id: 'terms-body', type: 'richContent', props: { textKey: 'terms.body' } },
          {
            id: 'btn-terms-close',
            type: 'button',
            props: { labelKey: 'common.close' },
            events: { onPress: [{ type: 'closeModal' }] },
          },
        ],
      },
    },
    {
      id: 'summary',
      name: 'Özet',
      titleKey: 'summary.title',
      onEnter: [
        {
          type: 'parallel',
          actions: [
            {
              type: 'writeBackToPlatform',
              attributes: { cardProduct: { $expr: 'vars.cardProduct' }, saleResult: 'SALE_OK' },
            },
            { type: 'setDisposition', code: 'SALE_OK', subCode: 'CARD' },
          ],
        },
      ],
      layout: {
        id: 'summary-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'lg' } },
        children: [
          {
            id: 'summary-text',
            type: 'scriptText',
            props: { textKey: 'summary.text' },
            bindings: [
              {
                prop: 'params',
                expression: '{ product: vars.cardProduct, limit: vars.creditLimit }',
              },
            ],
          },
          {
            id: 'btn-finish',
            type: 'button',
            props: { variant: 'primary', labelKey: 'common.finish' },
            events: {
              onPress: [
                { type: 'submitOutcome', outcome: 'SALE_OK' },
                { type: 'emitEvent', name: 'sale.completed' },
                { type: 'next' },
              ],
            },
          },
        ],
      },
    },
    {
      id: 'decline',
      name: 'Satış Yok',
      titleKey: 'decline.title',
      onEnter: [{ type: 'setDisposition', code: 'NO_SALE' }],
      layout: {
        id: 'decline-root',
        type: 'box',
        children: [
          { id: 'decline-text', type: 'scriptText', props: { textKey: 'decline.text' } },
          {
            id: 'btn-decline-finish',
            type: 'button',
            props: { variant: 'primary', labelKey: 'common.finish' },
            events: { onPress: [{ type: 'submitOutcome', outcome: 'NO_SALE' }, { type: 'next' }] },
          },
        ],
      },
    },
  ],
  flow: {
    id: 'main',
    name: 'Ana akış',
    start: 'n-welcome',
    nodes: [
      { id: 'n-welcome', type: 'page', page: 'welcome', position: { x: 0, y: 0 } },
      {
        id: 'n-lookup',
        type: 'dataSource',
        dataSource: 'customerLookup',
        position: { x: 200, y: 0 },
      },
      { id: 'n-verify', type: 'page', page: 'verify-identity', position: { x: 400, y: 0 } },
      { id: 'n-verified', type: 'decision', labelKey: 'flow.verified', position: { x: 600, y: 0 } },
      { id: 'n-needs', type: 'page', page: 'needs', position: { x: 800, y: 0 } },
      { id: 'n-score', type: 'dataSource', dataSource: 'creditScore', position: { x: 1000, y: 0 } },
      {
        id: 'n-eligible',
        type: 'decision',
        labelKey: 'flow.eligible',
        position: { x: 1200, y: 0 },
      },
      { id: 'n-offer', type: 'page', page: 'offer', position: { x: 1400, y: 0 } },
      { id: 'n-accepted', type: 'decision', position: { x: 1600, y: 0 } },
      { id: 'n-consent', type: 'page', page: 'consent', position: { x: 1800, y: 0 } },
      { id: 'n-summary', type: 'page', page: 'summary', position: { x: 2000, y: 0 } },
      { id: 'n-decline', type: 'page', page: 'decline', position: { x: 1400, y: 200 } },
      { id: 'n-end-sale', type: 'end', outcome: 'SALE_OK', position: { x: 2200, y: 0 } },
      {
        id: 'n-end-no-sale',
        type: 'end',
        outcome: 'NO_SALE',
        completion: 'early',
        position: { x: 1600, y: 200 },
      },
      {
        id: 'n-end-unverified',
        type: 'end',
        outcome: 'ID_FAILED',
        completion: 'early',
        position: { x: 600, y: 200 },
      },
      // A failed customer lookup never reaches the mandatory identity and consent pages, so this
      // is an author-declared early exit (ADR-0047): it keeps the technical-error outcome.
      {
        id: 'n-end-tech',
        type: 'end',
        outcome: 'TECH_ERROR',
        completion: 'early',
        position: { x: 200, y: 200 },
      },
    ],
    edges: [
      { id: 'e1', from: 'n-welcome', to: 'n-lookup' },
      { id: 'e2', from: 'n-lookup', to: 'n-verify', port: 'success' },
      { id: 'e3', from: 'n-lookup', to: 'n-end-tech', port: 'error' },
      { id: 'e4', from: 'n-verify', to: 'n-verified' },
      {
        id: 'e5',
        from: 'n-verified',
        to: 'n-needs',
        when: { $expr: 'vars.identityVerified == true' },
      },
      { id: 'e6', from: 'n-verified', to: 'n-end-unverified', default: true },
      { id: 'e7', from: 'n-needs', to: 'n-score' },
      { id: 'e8', from: 'n-score', to: 'n-eligible', port: 'success' },
      { id: 'e9', from: 'n-score', to: 'n-decline', port: 'error' },
      {
        id: 'e10',
        from: 'n-eligible',
        to: 'n-offer',
        when: { $expr: 'ds.creditScore.score >= 650' },
      },
      { id: 'e11', from: 'n-eligible', to: 'n-decline', default: true },
      { id: 'e12', from: 'n-offer', to: 'n-accepted' },
      { id: 'e13', from: 'n-accepted', to: 'n-consent', when: { $rule: 'r-offer-accepted' } },
      { id: 'e14', from: 'n-accepted', to: 'n-decline', default: true },
      { id: 'e15', from: 'n-consent', to: 'n-summary' },
      { id: 'e16', from: 'n-summary', to: 'n-end-sale' },
      { id: 'e17', from: 'n-decline', to: 'n-end-no-sale' },
    ],
  },
  rules: [
    { id: 'r-offer-accepted', when: { fact: 'vars.offerAccepted', op: 'eq', value: true } },
    {
      id: 'r-platinum',
      description: 'High income customers are offered platinum.',
      when: {
        all: [
          { fact: 'vars.monthlyIncome', op: 'gte', value: 30000 },
          { not: { fact: 'vars.cardProduct', op: 'eq', value: 'platinum' } },
        ],
      },
      then: [{ type: 'setVariable', variable: 'cardProduct', value: 'platinum' }],
    },
  ],
  theme: { mode: 'inherit', tokens: { density: 'comfortable', accent: 'primary' } },
  i18n: {
    defaultLocale: 'tr',
    messages: {
      tr: {
        'common.next': 'İleri',
        'common.back': 'Geri',
        'common.close': 'Kapat',
        'common.finish': 'Görüşmeyi Bitir',
        'welcome.title': 'Hoş geldiniz',
        'welcome.greeting':
          'İyi günler, ben {agent}. Size özel kredi kartı teklifimiz için arıyorum.',
        'verify.title': 'Kimlik doğrulama',
        'verify.intro': '{name}, güvenliğiniz için kartınızın son 4 hanesini rica edebilir miyim?',
        'verify.cardLast4': 'Kartın son 4 hanesi',
        'verify.submit': 'Doğrula',
        'verify.invalid': 'Lütfen 4 haneyi eksiksiz girin.',
        'needs.title': 'İhtiyaç analizi',
        'needs.income': 'Aylık net gelir',
        'needs.product': 'Kart tipi',
        'product.classic': 'Classic',
        'product.gold': 'Gold',
        'product.platinum': 'Platinum',
        'offer.title': 'Teklif',
        'offer.pitch': '{product} kartınız için {limit} TL limit tanımlayabiliriz.',
        'offer.platinumNote': 'Müşteri Platinum karta uygundur.',
        'offer.timeWarning': 'Teklif adımında 2 dakikayı geçtiniz.',
        'offer.accept': 'Kabul etti',
        'offer.decline': 'Kabul etmedi',
        'consent.title': 'Onay',
        'consent.legal':
          'Kart başvurunuz için kişisel verilerinizin işlenmesine onay veriyor musunuz?',
        'consent.showTerms': 'Sözleşmeyi göster',
        'consent.checkbox': 'Müşteri sözlü onay verdi',
        'consent.required': 'Devam etmek için müşteri onayı zorunludur.',
        'terms.title': 'Sözleşme',
        'terms.body': 'Kredi kartı üyelik sözleşmesi özeti.',
        'summary.title': 'Özet',
        'summary.text': '{product} kart başvurunuz {limit} TL limitle alınmıştır.',
        'decline.title': 'Satış gerçekleşmedi',
        'decline.text': 'Zaman ayırdığınız için teşekkür ederiz.',
        'flow.verified': 'Kimlik doğrulandı mı?',
        'flow.eligible': 'Skor uygun mu?',
      },
      en: {
        'common.next': 'Next',
        'common.back': 'Back',
        'common.close': 'Close',
        'common.finish': 'Finish call',
        'welcome.title': 'Welcome',
        'welcome.greeting':
          'Good day, this is {agent}. I am calling about a credit card offer for you.',
        'verify.title': 'Identity check',
        'verify.intro':
          '{name}, for your security, could you tell me the last 4 digits of your card?',
        'verify.cardLast4': 'Card last 4 digits',
        'verify.submit': 'Verify',
        'verify.invalid': 'Please enter all 4 digits.',
        'needs.title': 'Needs analysis',
        'needs.income': 'Monthly net income',
        'needs.product': 'Card type',
        'product.classic': 'Classic',
        'product.gold': 'Gold',
        'product.platinum': 'Platinum',
        'offer.title': 'Offer',
        'offer.pitch': 'We can set a limit of {limit} TRY on your {product} card.',
        'offer.platinumNote': 'Customer is eligible for Platinum.',
        'offer.timeWarning': 'You have spent over 2 minutes on the offer.',
        'offer.accept': 'Accepted',
        'offer.decline': 'Declined',
        'consent.title': 'Consent',
        'consent.legal':
          'Do you consent to the processing of your personal data for this application?',
        'consent.showTerms': 'Show terms',
        'consent.checkbox': 'Customer gave verbal consent',
        'consent.required': 'Customer consent is required to continue.',
        'terms.title': 'Terms',
        'terms.body': 'Summary of the credit card membership agreement.',
        'summary.title': 'Summary',
        'summary.text': 'Your {product} card application with a {limit} TRY limit is recorded.',
        'decline.title': 'No sale',
        'decline.text': 'Thank you for your time.',
        'flow.verified': 'Identity verified?',
        'flow.eligible': 'Score eligible?',
      },
    },
  },
};
