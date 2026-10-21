import type { ScriptDocumentInput } from '../schema/document.js';

/**
 * Motor/home policy renewal: recording notice → policy check → current cover → changes →
 * renewal quote with its mandatory terms → acceptance and payment, a callback, or no renewal.
 * Branch fields are required only on the branch that shows them, so every path can complete.
 */
export const insuranceRenewalScript: ScriptDocumentInput = {
  schemaVersion: '1.1.0',
  id: '01928f3a-0000-7000-8000-000000000005',
  meta: { name: 'Sigorta poliçesi yenileme', tags: ['insurance'], channels: ['voice'] },
  variables: [
    {
      key: 'policyNumber',
      description: 'Poliçe no',
      type: 'string',
      scope: 'session',
      source: 'interaction.attributes.policyNumber',
      default: '',
      classification: 'internal',
    },
    {
      key: 'customerName',
      description: 'müşteri adı',
      type: 'string',
      scope: 'session',
      classification: 'pii',
      pii: true,
    },
    {
      key: 'customerAvailable',
      description: 'Müşteri müsait',
      type: 'boolean',
      scope: 'session',
      default: true,
    },
    {
      key: 'identityConfirmed',
      description: 'Kimlik doğrulandı',
      type: 'boolean',
      scope: 'session',
      default: false,
    },
    {
      key: 'productName',
      description: 'poliçe ürünü',
      type: 'string',
      scope: 'session',
      default: '',
    },
    {
      key: 'currentPremium',
      description: 'mevcut prim',
      type: 'number',
      scope: 'session',
      default: 0,
      persist: true,
    },
    {
      key: 'policyEnd',
      description: 'bitiş tarihi',
      type: 'date',
      scope: 'session',
      persist: true,
    },
    {
      key: 'claimCount',
      description: 'hasar sayısı',
      type: 'number',
      scope: 'session',
      default: 0,
    },
    {
      key: 'renewalChoice',
      description: 'Yenileme tercihi',
      type: 'enum',
      scope: 'session',
      enumValues: ['same', 'upgrade', 'downgrade'],
      default: 'same',
      persist: true,
    },
    {
      key: 'addRoadside',
      description: 'Yol yardımı eklensin',
      type: 'boolean',
      scope: 'session',
      default: false,
      persist: true,
    },
    {
      key: 'changeReason',
      description: 'Değişiklik nedeni',
      type: 'string',
      scope: 'session',
      default: '',
    },
    {
      key: 'newPremium',
      description: 'yeni prim',
      type: 'number',
      scope: 'session',
      default: 0,
      persist: true,
    },
    {
      key: 'quoteId',
      description: 'Teklif no',
      type: 'string',
      scope: 'session',
      classification: 'internal',
    },
    {
      key: 'decision',
      description: 'Müşteri kararı',
      type: 'enum',
      scope: 'session',
      enumValues: ['pending', 'accept', 'think', 'decline'],
      default: 'pending',
      persist: true,
    },
    {
      key: 'paymentMethod',
      description: 'Ödeme yöntemi',
      type: 'enum',
      scope: 'session',
      enumValues: ['cardOnFile', 'bankTransfer', 'installments'],
      persist: true,
    },
    {
      key: 'consentGiven',
      description: 'Onay verildi',
      type: 'boolean',
      scope: 'session',
      default: false,
      persist: true,
    },
    {
      key: 'callbackDate',
      description: 'Geri arama tarihi',
      type: 'date',
      scope: 'session',
      persist: true,
    },
    {
      key: 'declineReason',
      description: 'Yenilememe nedeni',
      type: 'enum',
      scope: 'session',
      enumValues: ['price', 'competitor', 'noLongerNeeded', 'other'],
      persist: true,
    },
    {
      key: 'renewalReference',
      description: 'yenileme numarası',
      type: 'string',
      scope: 'session',
      classification: 'internal',
    },
  ],
  dataSources: [
    {
      id: 'policyLookup',
      ref: 'tenant-datasource:policy-summary',
      version: 1,
      inputs: { policyNumber: { $expr: 'vars.policyNumber' } },
      outputs: {
        holderName: { path: '$.holder.name', variable: 'customerName' },
        product: { path: '$.product.name', variable: 'productName' },
        premium: { path: '$.premium.annual', variable: 'currentPremium' },
        endDate: { path: '$.period.end', variable: 'policyEnd' },
        claims: { path: '$.claims.lastYear', variable: 'claimCount' },
        coverages: { path: '$.coverages' },
      },
    },
    {
      id: 'renewalQuote',
      ref: 'tenant-datasource:renewal-quote',
      version: 1,
      inputs: {
        policyNumber: { $expr: 'vars.policyNumber' },
        choice: { $expr: 'vars.renewalChoice' },
        roadside: { $expr: 'vars.addRoadside' },
      },
      outputs: {
        premium: { path: '$.premium.annual', variable: 'newPremium' },
        quote: { path: '$.id', variable: 'quoteId' },
      },
    },
    {
      id: 'renewPolicy',
      ref: 'tenant-datasource:renew-policy',
      version: 1,
      inputs: {
        quoteId: { $expr: 'vars.quoteId' },
        paymentMethod: { $expr: 'vars.paymentMethod' },
      },
      outputs: { reference: { path: '$.reference', variable: 'renewalReference' } },
    },
  ],
  pages: [
    {
      id: 'greeting',
      name: 'Karşılama',
      titleKey: 'greeting.title',
      layout: {
        id: 'greeting-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'lg' } },
        children: [
          {
            id: 'greeting-text',
            type: 'scriptText',
            props: { textKey: 'greeting.text' },
            bindings: [{ prop: 'params', expression: '{ agent: agent.firstName }' }],
          },
          {
            id: 'greeting-notice',
            type: 'scriptText',
            props: { textKey: 'greeting.notice', titleKey: 'greeting.noticeTitle', mustRead: true },
          },
          {
            id: 'greeting-actions',
            type: 'box',
            style: { base: { direction: 'row', gap: 'sm', justify: 'end' } },
            children: [
              {
                id: 'btn-greeting-unavailable',
                type: 'button',
                props: { labelKey: 'greeting.unavailable' },
                events: {
                  onPress: [
                    { type: 'setVariable', variable: 'customerAvailable', value: false },
                    { type: 'setDisposition', code: 'NOT_AVAILABLE' },
                    { type: 'next' },
                  ],
                },
              },
              {
                id: 'btn-greeting-next',
                type: 'button',
                props: { variant: 'primary', labelKey: 'common.next' },
                events: { onPress: [{ type: 'next' }] },
              },
            ],
          },
        ],
      },
    },
    {
      id: 'verify',
      name: 'Poliçe doğrulama',
      titleKey: 'verify.title',
      mandatory: true,
      layout: {
        id: 'verify-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'lg' } },
        children: [
          { id: 'verify-text', type: 'scriptText', props: { textKey: 'verify.text' } },
          {
            id: 'in-policy-number',
            type: 'textInput',
            props: { labelKey: 'verify.policyNumber', required: true },
            bindings: [{ variable: 'policyNumber' }],
          },
          {
            id: 'in-identity',
            type: 'checkbox',
            props: { labelKey: 'verify.identity', required: true },
            bindings: [{ prop: 'checked', variable: 'identityConfirmed' }],
          },
          {
            id: 'btn-verify-next',
            type: 'button',
            props: { variant: 'primary', labelKey: 'verify.submit' },
            events: {
              onPress: [
                {
                  type: 'validatePage',
                  onInvalid: [{ type: 'showToast', messageKey: 'verify.invalid', tone: 'warning' }],
                },
                { type: 'next' },
              ],
            },
          },
        ],
      },
    },
    {
      id: 'coverage',
      name: 'Mevcut teminatlar',
      titleKey: 'coverage.title',
      layout: {
        id: 'coverage-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'lg' } },
        children: [
          {
            id: 'coverage-text',
            type: 'scriptText',
            props: { textKey: 'coverage.text' },
            bindings: [
              {
                prop: 'params',
                expression:
                  "{ name: vars.customerName, product: vars.productName, premium: formatCurrency(vars.currentPremium), end: if(exists(vars.policyEnd), formatDate(vars.policyEnd, 'dd.MM.yyyy'), '—') }",
              },
            ],
          },
          {
            id: 'coverage-claims',
            type: 'alert',
            props: { textKey: 'coverage.claims', tone: 'warning' },
            bindings: [{ prop: 'params', expression: '{ count: vars.claimCount }' }],
            visibleWhen: { $rule: 'r-has-claims' },
          },
          {
            id: 'coverage-table',
            type: 'table',
            props: {
              labelKey: 'coverage.table',
              columns: [
                { field: 'name', labelKey: 'coverage.name' },
                { field: 'limit', labelKey: 'coverage.limit' },
              ],
            },
            bindings: [{ prop: 'rows', expression: 'ds.policyLookup.coverages' }],
          },
          {
            id: 'btn-coverage-next',
            type: 'button',
            props: { variant: 'primary', labelKey: 'common.next' },
            events: { onPress: [{ type: 'next' }] },
          },
        ],
      },
    },
    {
      id: 'needs',
      name: 'İhtiyaç değişiklikleri',
      titleKey: 'needs.title',
      layout: {
        id: 'needs-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'lg' } },
        children: [
          { id: 'needs-question', type: 'scriptText', props: { textKey: 'needs.question' } },
          {
            id: 'in-renewal-choice',
            type: 'radioGroup',
            props: {
              labelKey: 'needs.choice',
              options: [
                { value: 'same', labelKey: 'choice.same' },
                { value: 'upgrade', labelKey: 'choice.upgrade' },
                { value: 'downgrade', labelKey: 'choice.downgrade' },
              ],
            },
            bindings: [{ variable: 'renewalChoice' }],
          },
          {
            id: 'in-roadside',
            type: 'checkbox',
            props: { labelKey: 'needs.roadside' },
            bindings: [{ prop: 'checked', variable: 'addRoadside' }],
          },
          {
            id: 'in-change-reason',
            type: 'textArea',
            props: { labelKey: 'needs.reason' },
            bindings: [{ variable: 'changeReason' }],
            visibleWhen: { $expr: "vars.renewalChoice == 'downgrade'" },
          },
          {
            id: 'btn-needs-next',
            type: 'button',
            props: { variant: 'primary', labelKey: 'needs.quote' },
            events: { onPress: [{ type: 'next' }] },
          },
        ],
      },
    },
    {
      id: 'quote',
      name: 'Yenileme teklifi',
      titleKey: 'quote.title',
      layout: {
        id: 'quote-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'lg' } },
        children: [
          {
            id: 'quote-text',
            type: 'scriptText',
            props: { textKey: 'quote.text' },
            bindings: [
              {
                prop: 'params',
                expression:
                  '{ premium: formatCurrency(vars.newPremium), previous: formatCurrency(vars.currentPremium) }',
              },
            ],
          },
          {
            id: 'quote-increase',
            type: 'alert',
            props: { textKey: 'quote.increase', tone: 'info' },
            visibleWhen: { $rule: 'r-premium-up' },
          },
          {
            id: 'quote-terms',
            type: 'scriptText',
            props: { textKey: 'quote.terms', titleKey: 'quote.termsTitle', mustRead: true },
          },
          {
            id: 'quote-actions',
            type: 'box',
            style: { base: { direction: 'row', gap: 'sm', justify: 'end', wrap: true } },
            children: [
              {
                id: 'btn-quote-decline',
                type: 'button',
                props: { labelKey: 'quote.decline' },
                events: {
                  onPress: [
                    { type: 'setVariable', variable: 'decision', value: 'decline' },
                    { type: 'next' },
                  ],
                },
              },
              {
                id: 'btn-quote-think',
                type: 'button',
                props: { labelKey: 'quote.think' },
                events: {
                  onPress: [
                    { type: 'setVariable', variable: 'decision', value: 'think' },
                    { type: 'next' },
                  ],
                },
              },
              {
                id: 'btn-quote-accept',
                type: 'button',
                props: { variant: 'primary', labelKey: 'quote.accept' },
                events: {
                  onPress: [
                    { type: 'setVariable', variable: 'decision', value: 'accept' },
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
      id: 'confirm',
      name: 'Onay ve ödeme',
      titleKey: 'confirm.title',
      layout: {
        id: 'confirm-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'lg' } },
        children: [
          {
            id: 'in-payment',
            type: 'select',
            props: {
              labelKey: 'confirm.payment',
              options: [
                { value: 'cardOnFile', labelKey: 'payment.cardOnFile' },
                { value: 'bankTransfer', labelKey: 'payment.bankTransfer' },
                { value: 'installments', labelKey: 'payment.installments' },
              ],
            },
            bindings: [{ variable: 'paymentMethod' }],
            requiredWhen: { $rule: 'r-accepted' },
          },
          {
            id: 'in-consent',
            type: 'checkbox',
            props: { labelKey: 'confirm.consent' },
            bindings: [{ prop: 'checked', variable: 'consentGiven' }],
            requiredWhen: { $rule: 'r-accepted' },
          },
          {
            id: 'btn-confirm',
            type: 'button',
            props: { variant: 'primary', labelKey: 'confirm.submit' },
            events: {
              onPress: [
                {
                  type: 'validatePage',
                  onInvalid: [
                    { type: 'showToast', messageKey: 'confirm.invalid', tone: 'warning' },
                  ],
                },
                {
                  type: 'callDataSource',
                  dataSource: 'renewPolicy',
                  onSuccess: [{ type: 'setDisposition', code: 'RENEWED' }, { type: 'next' }],
                  onError: [{ type: 'showToast', messageKey: 'confirm.failed', tone: 'danger' }],
                },
              ],
            },
          },
        ],
      },
    },
    {
      id: 'callback',
      name: 'Geri arama',
      titleKey: 'callback.title',
      layout: {
        id: 'callback-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'lg' } },
        children: [
          { id: 'callback-text', type: 'scriptText', props: { textKey: 'callback.text' } },
          {
            id: 'in-callback-date',
            type: 'datePicker',
            props: { labelKey: 'callback.date' },
            bindings: [{ variable: 'callbackDate' }],
            requiredWhen: { $rule: 'r-callback' },
          },
          {
            id: 'btn-callback',
            type: 'button',
            props: { variant: 'primary', labelKey: 'callback.submit' },
            events: {
              onPress: [
                {
                  type: 'validatePage',
                  onInvalid: [
                    { type: 'showToast', messageKey: 'callback.invalid', tone: 'warning' },
                  ],
                },
                { type: 'setDisposition', code: 'CALLBACK' },
                { type: 'submitOutcome', outcome: 'CALLBACK' },
                { type: 'next' },
              ],
            },
          },
        ],
      },
    },
    {
      id: 'decline',
      name: 'Yenileme yok',
      titleKey: 'decline.title',
      layout: {
        id: 'decline-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'lg' } },
        children: [
          {
            id: 'in-decline-reason',
            type: 'radioGroup',
            props: {
              labelKey: 'decline.reason',
              options: [
                { value: 'price', labelKey: 'reason.price' },
                { value: 'competitor', labelKey: 'reason.competitor' },
                { value: 'noLongerNeeded', labelKey: 'reason.noLongerNeeded' },
                { value: 'other', labelKey: 'reason.other' },
              ],
            },
            bindings: [{ variable: 'declineReason' }],
            requiredWhen: { $rule: 'r-declined' },
          },
          {
            id: 'decline-retention',
            type: 'alert',
            props: { textKey: 'decline.retention', tone: 'info' },
            visibleWhen: { $expr: "vars.declineReason == 'price'" },
          },
          {
            id: 'btn-decline',
            type: 'button',
            props: { variant: 'primary', labelKey: 'common.finish' },
            events: {
              onPress: [
                {
                  type: 'validatePage',
                  onInvalid: [
                    { type: 'showToast', messageKey: 'decline.invalid', tone: 'warning' },
                  ],
                },
                { type: 'setDisposition', code: 'NOT_RENEWED' },
                { type: 'submitOutcome', outcome: 'NOT_RENEWED' },
                { type: 'next' },
              ],
            },
          },
        ],
      },
    },
    {
      id: 'summary',
      name: 'Özet',
      titleKey: 'summary.title',
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
                expression:
                  '{ product: vars.productName, premium: formatCurrency(vars.newPremium), reference: vars.renewalReference }',
              },
            ],
          },
          {
            id: 'btn-summary-finish',
            type: 'button',
            props: { variant: 'primary', labelKey: 'common.finish' },
            events: {
              onPress: [
                // Required notices and fields are checked before the outcome is recorded.
                {
                  type: 'validatePage',
                  onInvalid: [
                    { type: 'showToast', messageKey: 'summary.invalid', tone: 'warning' },
                  ],
                },
                {
                  type: 'writeBackToPlatform',
                  attributes: { renewalReference: { $expr: 'vars.renewalReference' } },
                },
                { type: 'submitOutcome', outcome: 'RENEWED' },
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
    start: 'n-greeting',
    nodes: [
      { id: 'n-greeting', type: 'page', page: 'greeting', position: { x: 0, y: 0 } },
      {
        id: 'n-available',
        labelKey: 'flow.available',
        type: 'decision',
        position: { x: 0, y: 140 },
      },
      { id: 'n-verify', type: 'page', page: 'verify', position: { x: 0, y: 280 } },
      {
        id: 'n-lookup',
        labelKey: 'flow.lookup',
        type: 'dataSource',
        dataSource: 'policyLookup',
        position: { x: 0, y: 420 },
      },
      { id: 'n-coverage', type: 'page', page: 'coverage', position: { x: 0, y: 560 } },
      { id: 'n-needs', type: 'page', page: 'needs', position: { x: 0, y: 700 } },
      {
        id: 'n-quote-call',
        labelKey: 'flow.quote',
        type: 'dataSource',
        dataSource: 'renewalQuote',
        position: { x: 0, y: 840 },
      },
      { id: 'n-quote', type: 'page', page: 'quote', position: { x: 0, y: 980 } },
      {
        id: 'n-decision',
        labelKey: 'flow.decision',
        type: 'decision',
        position: { x: 0, y: 1120 },
      },
      { id: 'n-confirm', type: 'page', page: 'confirm', position: { x: -320, y: 1260 } },
      { id: 'n-summary', type: 'page', page: 'summary', position: { x: -320, y: 1400 } },
      { id: 'n-callback', type: 'page', page: 'callback', position: { x: 0, y: 1260 } },
      { id: 'n-decline', type: 'page', page: 'decline', position: { x: 320, y: 1260 } },
      { id: 'n-end', type: 'end', position: { x: 0, y: 1540 } },
      // A customer who cannot talk now never hears the terms: an author-declared early exit.
      {
        id: 'n-end-unavailable',
        labelKey: 'flow.unavailable',
        type: 'end',
        outcome: 'NOT_AVAILABLE',
        completion: 'early',
        position: { x: 320, y: 140 },
      },
      {
        id: 'n-end-tech',
        labelKey: 'flow.techError',
        type: 'end',
        outcome: 'TECH_ERROR',
        completion: 'early',
        position: { x: 320, y: 420 },
      },
    ],
    edges: [
      { id: 'e1', from: 'n-greeting', to: 'n-available' },
      {
        id: 'e2',
        from: 'n-available',
        to: 'n-end-unavailable',
        when: { $rule: 'r-unavailable' },
      },
      { id: 'e3', from: 'n-available', to: 'n-verify', default: true },
      { id: 'e4', from: 'n-verify', to: 'n-lookup' },
      { id: 'e5', from: 'n-lookup', to: 'n-coverage', port: 'success' },
      { id: 'e6', from: 'n-lookup', to: 'n-end-tech', port: 'error' },
      { id: 'e7', from: 'n-coverage', to: 'n-needs' },
      { id: 'e8', from: 'n-needs', to: 'n-quote-call' },
      { id: 'e9', from: 'n-quote-call', to: 'n-quote', port: 'success' },
      { id: 'e10', from: 'n-quote-call', to: 'n-end-tech', port: 'error' },
      { id: 'e11', from: 'n-quote', to: 'n-decision' },
      { id: 'e12', from: 'n-decision', to: 'n-confirm', when: { $rule: 'r-accepted' } },
      { id: 'e13', from: 'n-decision', to: 'n-callback', when: { $rule: 'r-callback' } },
      { id: 'e14', from: 'n-decision', to: 'n-decline', default: true },
      { id: 'e15', from: 'n-confirm', to: 'n-summary' },
      { id: 'e16', from: 'n-summary', to: 'n-end' },
      { id: 'e17', from: 'n-callback', to: 'n-end' },
      { id: 'e18', from: 'n-decline', to: 'n-end' },
    ],
  },
  rules: [
    { id: 'r-unavailable', when: { fact: 'vars.customerAvailable', op: 'eq', value: false } },
    { id: 'r-accepted', when: { fact: 'vars.decision', op: 'eq', value: 'accept' } },
    { id: 'r-callback', when: { fact: 'vars.decision', op: 'eq', value: 'think' } },
    { id: 'r-declined', when: { fact: 'vars.decision', op: 'eq', value: 'decline' } },
    { id: 'r-has-claims', when: { fact: 'vars.claimCount', op: 'gt', value: 0 } },
    { id: 'r-premium-up', when: { $expr: 'vars.newPremium > vars.currentPremium' } },
  ],
  i18n: {
    defaultLocale: 'tr',
    messages: {
      tr: {
        'flow.available': 'Müsaitlik kontrolü',
        'flow.lookup': 'Poliçe sorgulama',
        'flow.quote': 'Yenileme teklifi',
        'flow.decision': 'Müşteri kararı',
        'flow.unavailable': 'Müşteri müsait değil',
        'flow.techError': 'Teknik hata',
        'common.next': 'İleri',
        'common.finish': 'Görüşmeyi bitir',
        'greeting.title': 'Karşılama',
        'greeting.text':
          'İyi günler, ben {agent}. Poliçenizin yenileme dönemi yaklaştığı için arıyorum; birkaç dakikanızı alabilir miyim?',
        'greeting.noticeTitle': 'Kayıt ve kişisel veri bilgilendirmesi',
        'greeting.notice':
          'Bu görüşme hizmet kalitesi ve yasal yükümlülükler nedeniyle kaydedilmektedir. Kişisel verileriniz 6698 sayılı KVKK kapsamında yalnızca poliçe işlemleriniz için işlenir.',
        'greeting.unavailable': 'Müşteri şu an müsait değil',
        'verify.title': 'Poliçe doğrulama',
        'verify.text':
          'Poliçe numaranızı alabilir miyim? Ardından sistemdeki doğum tarihini müşteriye sorarak teyit edin.',
        'verify.policyNumber': 'Poliçe numarası',
        'verify.identity': 'Müşteri doğum tarihini doğru söyledi',
        'verify.submit': 'Poliçeyi getir',
        'verify.invalid': 'Poliçe numarası ve kimlik teyidi gerekli.',
        'coverage.title': 'Mevcut teminatlar',
        'coverage.text':
          '{name}, {product} poliçenizin yıllık primi {premium}; poliçeniz {end} tarihinde sona eriyor.',
        'coverage.claims': 'Son bir yılda {count} hasar kaydı var; yenileme primi etkilenebilir.',
        'coverage.table': 'Teminatlar',
        'coverage.name': 'Teminat',
        'coverage.limit': 'Limit',
        'needs.title': 'İhtiyaç değişiklikleri',
        'needs.question':
          'Geçen yıldan bu yana aracınızda, adresinizde veya kullanımınızda bir değişiklik oldu mu?',
        'needs.choice': 'Yenilemede teminat tercihi',
        'needs.roadside': '7/24 yol yardımı eklensin',
        'needs.reason': 'Daha düşük teminat isteme nedeni',
        'needs.quote': 'Teklif hesapla',
        'choice.same': 'Aynı teminatlarla yenile',
        'choice.upgrade': 'Teminatları artır',
        'choice.downgrade': 'Teminatları azalt',
        'quote.title': 'Yenileme teklifi',
        'quote.text': 'Yeni dönem için yıllık priminiz {premium} olacak (geçen yıl {previous}).',
        'quote.increase':
          'Prim geçen yıla göre arttı. Hasarsızlık indirimi ve taksit seçeneklerini hatırlatın.',
        'quote.termsTitle': 'Teklif koşulları ve istisnalar',
        'quote.terms':
          'Teklif 15 gün geçerlidir. Muafiyet tutarları, istisnalar ve ödeme koşulları poliçe belgesinde yer alır; müşteri isterse belge e-posta ile gönderilir.',
        'quote.accept': 'Müşteri kabul etti',
        'quote.think': 'Düşünmek istiyor',
        'quote.decline': 'Yenilemek istemiyor',
        'confirm.title': 'Onay ve ödeme',
        'confirm.payment': 'Ödeme yöntemi',
        'confirm.consent': 'Müşteri yenileme ve ödeme koşullarına sözlü onay verdi',
        'confirm.submit': 'Yenilemeyi tamamla',
        'confirm.invalid': 'Ödeme yöntemi ve müşteri onayı gerekli.',
        'confirm.failed': 'Yenileme kaydedilemedi. Tekrar deneyin veya teknik ekibe aktarın.',
        'payment.cardOnFile': 'Kayıtlı kart',
        'payment.bankTransfer': 'Havale / EFT',
        'payment.installments': 'Taksitli ödeme',
        'callback.title': 'Geri arama',
        'callback.text': 'Size hangi gün tekrar ulaşmamızı istersiniz?',
        'callback.date': 'Geri arama tarihi',
        'callback.submit': 'Geri aramayı planla',
        'callback.invalid': 'Geri arama tarihi gerekli.',
        'decline.title': 'Yenileme yok',
        'decline.reason': 'Yenilememe nedeni',
        'decline.retention':
          'Fiyat nedeniyle ayrılan müşteriye taksitli ödeme veya teminat azaltımı önerebilirsiniz.',
        'decline.invalid': 'Yenilememe nedeni gerekli.',
        'reason.price': 'Fiyat',
        'reason.competitor': 'Başka sigortacıya geçiyor',
        'reason.noLongerNeeded': 'Artık ihtiyacı yok',
        'reason.other': 'Diğer',
        'summary.title': 'Özet',
        'summary.invalid':
          'Görüşmeyi bitirmeden önce eksik alanları ve zorunlu bilgilendirmeleri tamamlayın.',
        'summary.text':
          '{product} poliçeniz {premium} yıllık primle yenilendi. Yenileme referansınız: {reference}.',
      },
      en: {
        'flow.available': 'Availability check',
        'flow.lookup': 'Policy lookup',
        'flow.quote': 'Renewal quote',
        'flow.decision': 'Customer decision',
        'flow.unavailable': 'Customer not available',
        'flow.techError': 'Technical error',
        'common.next': 'Next',
        'common.finish': 'End call',
        'greeting.title': 'Greeting',
        'greeting.text':
          'Good day, this is {agent}. I am calling because your policy is due for renewal; do you have a few minutes?',
        'greeting.noticeTitle': 'Recording and personal data notice',
        'greeting.notice':
          'This call is recorded for service quality and legal obligations. Your personal data is processed only for your policy under applicable data protection law.',
        'greeting.unavailable': 'Customer cannot talk now',
        'verify.title': 'Policy check',
        'verify.text':
          'May I have your policy number? Then confirm the date of birth on file by asking the customer.',
        'verify.policyNumber': 'Policy number',
        'verify.identity': 'Customer gave the correct date of birth',
        'verify.submit': 'Load policy',
        'verify.invalid': 'Policy number and identity confirmation are required.',
        'coverage.title': 'Current cover',
        'coverage.text':
          '{name}, your {product} policy has an annual premium of {premium} and ends on {end}.',
        'coverage.claims': '{count} claims in the last year; the renewal premium may change.',
        'coverage.table': 'Cover',
        'coverage.name': 'Cover',
        'coverage.limit': 'Limit',
        'needs.title': 'Changes in needs',
        'needs.question': 'Has anything changed in your vehicle, address or usage since last year?',
        'needs.choice': 'Cover at renewal',
        'needs.roadside': 'Add 24/7 roadside assistance',
        'needs.reason': 'Reason for lower cover',
        'needs.quote': 'Calculate quote',
        'choice.same': 'Renew with the same cover',
        'choice.upgrade': 'Increase cover',
        'choice.downgrade': 'Reduce cover',
        'quote.title': 'Renewal quote',
        'quote.text': 'Your annual premium for the new term is {premium} (last year {previous}).',
        'quote.increase':
          'The premium went up. Mention the no-claims discount and instalment options.',
        'quote.termsTitle': 'Quote terms and exclusions',
        'quote.terms':
          'The quote is valid for 15 days. Excesses, exclusions and payment terms are in the policy document; it can be emailed on request.',
        'quote.accept': 'Customer accepts',
        'quote.think': 'Wants to think about it',
        'quote.decline': 'Does not want to renew',
        'confirm.title': 'Confirmation and payment',
        'confirm.payment': 'Payment method',
        'confirm.consent': 'Customer verbally agreed to the renewal and payment terms',
        'confirm.submit': 'Complete renewal',
        'confirm.invalid': 'Payment method and customer consent are required.',
        'confirm.failed': 'The renewal could not be saved. Try again or hand over to support.',
        'payment.cardOnFile': 'Card on file',
        'payment.bankTransfer': 'Bank transfer',
        'payment.installments': 'Instalments',
        'callback.title': 'Callback',
        'callback.text': 'Which day would suit you for us to call back?',
        'callback.date': 'Callback date',
        'callback.submit': 'Schedule callback',
        'callback.invalid': 'A callback date is required.',
        'decline.title': 'Not renewing',
        'decline.reason': 'Reason for not renewing',
        'decline.retention': 'For a price objection you can offer instalments or reduced cover.',
        'decline.invalid': 'A reason is required.',
        'reason.price': 'Price',
        'reason.competitor': 'Moving to another insurer',
        'reason.noLongerNeeded': 'No longer needed',
        'reason.other': 'Other',
        'summary.title': 'Summary',
        'summary.invalid':
          'Complete the missing fields and required notices before ending the call.',
        'summary.text':
          'Your {product} policy is renewed at an annual premium of {premium}. Your renewal reference is {reference}.',
      },
    },
  },
};
