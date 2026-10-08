import type { ScriptDocumentInput } from '../schema/document.js';

/** Debt collection: right-party contact → mandatory disclosure → balance → negotiation → promise to pay. */
export const collectionsScript: ScriptDocumentInput = {
  schemaVersion: '1.1.0',
  id: '01928f3a-0000-7000-8000-000000000003',
  meta: { name: 'Tahsilat', tags: ['collections'], channels: ['voice'], capabilities: ['hold'] },
  variables: [
    {
      key: 'accountId',
      type: 'string',
      scope: 'interaction',
      source: 'interaction.attributes.accountId',
    },
    { key: 'customerName', type: 'string', scope: 'session', classification: 'pii', pii: true },
    { key: 'rightPartyContact', type: 'boolean', scope: 'session', default: false, persist: true },
    { key: 'debtAmount', type: 'number', scope: 'session', default: 0, persist: true },
    { key: 'daysPastDue', type: 'number', scope: 'session', default: 0, persist: true },
    {
      key: 'paymentPlan',
      type: 'enum',
      scope: 'session',
      enumValues: ['full', 'installments', 'none'],
      default: 'none',
      persist: true,
    },
    { key: 'promiseAmount', type: 'number', scope: 'session', persist: true },
    { key: 'promiseDate', type: 'date', scope: 'session', persist: true },
    { key: 'objectionReason', type: 'string', scope: 'session', persist: true },
    { key: 'escalate', type: 'boolean', scope: 'session', default: false },
    { key: 'ptpReference', type: 'string', scope: 'session', classification: 'internal' },
    {
      key: 'minInstallment',
      type: 'number',
      scope: 'global',
      default: 250,
      classification: 'public',
    },
  ],
  dataSources: [
    {
      id: 'debtInfo',
      ref: 'tenant-datasource:debt-summary',
      version: 4,
      inputs: { accountId: { $expr: 'vars.accountId' } },
      outputs: {
        holderName: { path: '$.holder.name', variable: 'customerName' },
        amount: { path: '$.balance.total', variable: 'debtAmount' },
        days: { path: '$.balance.daysPastDue', variable: 'daysPastDue' },
        history: { path: '$.payments' },
      },
      policy: { trigger: 'onEnter', cacheTtlSec: 0 },
    },
    {
      id: 'registerPromise',
      ref: 'tenant-datasource:promise-to-pay',
      version: 1,
      inputs: {
        accountId: { $expr: 'vars.accountId' },
        amount: { $expr: 'vars.promiseAmount' },
        date: { $expr: 'vars.promiseDate' },
      },
      // Mapped into an internal variable so the reference can be written back to the platform:
      // raw data source results count as personal data and may not reach platform sinks.
      outputs: { reference: { path: '$.reference', variable: 'ptpReference' } },
    },
  ],
  pages: [
    {
      id: 'rpc',
      name: 'Doğru Kişi Teyidi',
      titleKey: 'rpc.title',
      layout: {
        id: 'rpc-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'md' } },
        children: [
          {
            id: 'rpc-question',
            type: 'scriptText',
            props: { textKey: 'rpc.question' },
            bindings: [{ prop: 'params', expression: '{ name: vars.customerName }' }],
          },
          {
            id: 'rpc-actions',
            type: 'box',
            style: { base: { direction: 'row', gap: 'sm' } },
            children: [
              {
                id: 'btn-rpc-yes',
                type: 'button',
                props: { variant: 'primary', labelKey: 'rpc.yes' },
                events: {
                  onPress: [
                    { type: 'setVariable', variable: 'rightPartyContact', value: true },
                    { type: 'next' },
                  ],
                },
              },
              {
                id: 'btn-rpc-no',
                type: 'button',
                props: { labelKey: 'rpc.no' },
                events: {
                  onPress: [
                    { type: 'setVariable', variable: 'rightPartyContact', value: false },
                    { type: 'setDisposition', code: 'WRONG_PARTY' },
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
      id: 'disclosure',
      name: 'Yasal Bilgilendirme',
      titleKey: 'disclosure.title',
      mandatory: true,
      layout: {
        id: 'disclosure-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'md' } },
        children: [
          {
            id: 'disclosure-text',
            type: 'scriptText',
            props: { textKey: 'disclosure.text', emphasis: 'strong' },
          },
          {
            id: 'btn-disclosure-next',
            type: 'button',
            props: { variant: 'primary', labelKey: 'disclosure.read' },
            events: { onPress: [{ type: 'next' }] },
          },
        ],
      },
    },
    {
      id: 'balance',
      name: 'Borç Bilgisi',
      titleKey: 'balance.title',
      layout: {
        id: 'balance-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'md' } },
        children: [
          {
            id: 'balance-text',
            type: 'scriptText',
            props: { textKey: 'balance.text' },
            bindings: [
              { prop: 'params', expression: '{ amount: vars.debtAmount, days: vars.daysPastDue }' },
            ],
          },
          {
            id: 'balance-escalation',
            type: 'alert',
            props: { textKey: 'balance.escalation', tone: 'danger' },
            visibleWhen: { $rule: 'r-escalation' },
          },
          {
            id: 'payment-history',
            type: 'table',
            props: {
              labelKey: 'balance.history',
              columns: [
                { field: 'date', labelKey: 'balance.date' },
                { field: 'amount', labelKey: 'balance.amount' },
              ],
            },
            bindings: [{ prop: 'rows', expression: 'ds.debtInfo.history' }],
          },
          {
            id: 'btn-balance-dispute',
            type: 'button',
            props: { variant: 'secondary', labelKey: 'balance.dispute' },
            events: {
              onPress: [
                { type: 'setDisposition', code: 'DISPUTE' },
                { type: 'navigate', page: 'wrap-up' },
              ],
            },
          },
          {
            id: 'btn-balance-next',
            type: 'button',
            props: { variant: 'primary', labelKey: 'common.next' },
            events: { onPress: [{ type: 'next' }] },
          },
        ],
      },
    },
    {
      id: 'negotiate',
      name: 'Müzakere',
      titleKey: 'negotiate.title',
      timers: [
        {
          id: 'hold-timer',
          durationMs: 60000,
          onElapsed: [{ type: 'showToast', messageKey: 'negotiate.holdLong', tone: 'warning' }],
        },
      ],
      layout: {
        id: 'negotiate-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'md' } },
        children: [
          {
            id: 'in-plan',
            type: 'radioGroup',
            props: {
              labelKey: 'negotiate.plan',
              options: [
                { value: 'full', labelKey: 'plan.full' },
                { value: 'installments', labelKey: 'plan.installments' },
                { value: 'none', labelKey: 'plan.none' },
              ],
            },
            bindings: [{ variable: 'paymentPlan' }],
          },
          {
            id: 'in-objection',
            type: 'textArea',
            props: { labelKey: 'negotiate.objection' },
            bindings: [{ variable: 'objectionReason' }],
            visibleWhen: { $expr: "vars.paymentPlan == 'none'" },
          },
          {
            id: 'negotiate-actions',
            type: 'box',
            style: { base: { direction: 'row', gap: 'sm', wrap: true } },
            children: [
              {
                id: 'btn-hold-start',
                type: 'button',
                props: { labelKey: 'negotiate.hold' },
                events: { onPress: [{ type: 'startTimer', timer: 'hold-timer' }] },
              },
              {
                id: 'btn-hold-stop',
                type: 'button',
                props: { labelKey: 'negotiate.resume' },
                events: { onPress: [{ type: 'stopTimer', timer: 'hold-timer' }] },
              },
              {
                id: 'btn-negotiate-next',
                type: 'button',
                props: { variant: 'primary', labelKey: 'common.next' },
                events: {
                  onPress: [
                    {
                      type: 'emitEvent',
                      name: 'collections.planChosen',
                      payload: { plan: { $expr: 'vars.paymentPlan' } },
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
      id: 'promise',
      name: 'Ödeme Sözü',
      titleKey: 'promise.title',
      layout: {
        id: 'promise-root',
        type: 'box',
        style: { base: { display: 'grid', columns: 1, gap: 'md' }, md: { columns: 2 } },
        children: [
          {
            id: 'in-promise-amount',
            type: 'numberInput',
            props: { labelKey: 'promise.amount', min: 0 },
            bindings: [
              { variable: 'promiseAmount' },
              {
                prop: 'min',
                expression: "vars.paymentPlan == 'full' ? vars.debtAmount : vars.minInstallment",
              },
            ],
            // Required only when a plan is agreed: a refusal never visits this page.
            requiredWhen: { $rule: 'r-has-plan' },
          },
          {
            id: 'in-promise-date',
            type: 'datePicker',
            props: { labelKey: 'promise.date' },
            bindings: [{ variable: 'promiseDate' }],
            // Required only when a plan is agreed: a refusal never visits this page.
            requiredWhen: { $rule: 'r-has-plan' },
          },
          {
            id: 'btn-promise-save',
            type: 'button',
            props: { variant: 'primary', labelKey: 'promise.save' },
            events: {
              onPress: [
                {
                  type: 'validatePage',
                  onInvalid: [
                    { type: 'showToast', messageKey: 'promise.invalid', tone: 'warning' },
                  ],
                },
                {
                  type: 'callDataSource',
                  dataSource: 'registerPromise',
                  onSuccess: [
                    { type: 'setDisposition', code: 'PTP', subCode: 'PTP_NEW' },
                    {
                      type: 'writeBackToPlatform',
                      attributes: {
                        ptpReference: { $expr: 'vars.ptpReference' },
                        ptpDate: { $expr: 'vars.promiseDate' },
                      },
                    },
                    { type: 'next' },
                  ],
                  onError: [{ type: 'showToast', messageKey: 'promise.failed', tone: 'danger' }],
                },
              ],
            },
          },
        ],
      },
    },
    {
      id: 'wrap-up',
      name: 'Kapanış',
      titleKey: 'wrapUp.title',
      layout: {
        id: 'wrap-up-root',
        type: 'box',
        children: [
          { id: 'wrap-up-text', type: 'scriptText', props: { textKey: 'wrapUp.text' } },
          {
            id: 'in-disposition',
            type: 'dispositionPicker',
            props: {
              labelKey: 'wrapUp.disposition',
              options: [
                { value: 'PTP', labelKey: 'wrapUp.promise' },
                { value: 'CALLBACK', labelKey: 'wrapUp.callback' },
                { value: 'ESCALATE', labelKey: 'wrapUp.escalate' },
              ],
            },
          },
          {
            id: 'btn-wrap-up',
            type: 'button',
            props: { variant: 'primary', labelKey: 'common.finish' },
            events: {
              onPress: [
                {
                  type: 'conditional',
                  if: { $expr: "vars.paymentPlan == 'none'" },
                  then: [
                    {
                      type: 'submitOutcome',
                      outcome: 'REFUSED',
                      notes: { $expr: 'vars.objectionReason' },
                    },
                  ],
                  else: [{ type: 'submitOutcome', outcome: 'PTP' }],
                },
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
    start: 'n-rpc',
    nodes: [
      { id: 'n-rpc', type: 'page', page: 'rpc' },
      { id: 'n-is-rpc', type: 'decision' },
      { id: 'n-disclosure', type: 'page', page: 'disclosure' },
      { id: 'n-debt', type: 'dataSource', dataSource: 'debtInfo' },
      { id: 'n-balance', type: 'page', page: 'balance' },
      { id: 'n-negotiate', type: 'page', page: 'negotiate' },
      { id: 'n-has-plan', type: 'decision' },
      { id: 'n-promise', type: 'page', page: 'promise' },
      { id: 'n-wrap-up', type: 'page', page: 'wrap-up' },
      { id: 'n-end', type: 'end' },
      // The mandatory disclosure must never be read to a wrong party, so this end is an
      // author-declared early exit (ADR-0047): the outcome is kept without visiting it.
      { id: 'n-end-wrong-party', type: 'end', outcome: 'WRONG_PARTY', completion: 'early' },
    ],
    edges: [
      { id: 'e1', from: 'n-rpc', to: 'n-is-rpc' },
      { id: 'e2', from: 'n-is-rpc', to: 'n-disclosure', when: { $expr: 'vars.rightPartyContact' } },
      { id: 'e3', from: 'n-is-rpc', to: 'n-end-wrong-party', default: true },
      { id: 'e4', from: 'n-disclosure', to: 'n-debt' },
      { id: 'e5', from: 'n-debt', to: 'n-balance', port: 'success' },
      { id: 'e6', from: 'n-debt', to: 'n-wrap-up', port: 'error' },
      { id: 'e7', from: 'n-balance', to: 'n-negotiate' },
      { id: 'e8', from: 'n-negotiate', to: 'n-has-plan' },
      { id: 'e9', from: 'n-has-plan', to: 'n-promise', when: { $rule: 'r-has-plan' } },
      { id: 'e10', from: 'n-has-plan', to: 'n-wrap-up', default: true },
      { id: 'e11', from: 'n-promise', to: 'n-wrap-up' },
      { id: 'e12', from: 'n-wrap-up', to: 'n-end' },
    ],
  },
  rules: [
    {
      id: 'r-has-plan',
      when: { fact: 'vars.paymentPlan', op: 'in', value: ['full', 'installments'] },
    },
    {
      id: 'r-escalation',
      when: {
        any: [
          { fact: 'vars.daysPastDue', op: 'gt', value: 90 },
          {
            all: [
              { fact: 'vars.debtAmount', op: 'between', value: [10000, 1000000] },
              { fact: 'vars.daysPastDue', op: 'gte', value: 60 },
            ],
          },
        ],
      },
      then: [{ type: 'setVariable', variable: 'escalate', value: true }],
      else: [{ type: 'setVariable', variable: 'escalate', value: false }],
    },
  ],
  i18n: {
    defaultLocale: 'tr',
    messages: {
      tr: {
        'common.next': 'İleri',
        'common.finish': 'Bitir',
        'rpc.title': 'Kişi teyidi',
        'rpc.question': '{name} ile mi görüşüyorum?',
        'rpc.yes': 'Evet, kendisi',
        'rpc.no': 'Hayır',
        'disclosure.title': 'Yasal bilgilendirme',
        'disclosure.text':
          'Bu görüşme kayıt altına alınmaktadır ve bir alacak tahsilatı ile ilgilidir.',
        'disclosure.read': 'Bilgilendirme okundu',
        'balance.title': 'Borç bilgisi',
        'balance.text': 'Hesabınızda {days} gündür gecikmiş {amount} TL borç bulunmaktadır.',
        'balance.escalation': 'Yasal takip öncesi son aşama.',
        'balance.history': 'Ödeme geçmişi',
        'balance.date': 'Tarih',
        'balance.amount': 'Tutar',
        'balance.dispute': 'Müşteri borca itiraz ediyor',
        'negotiate.title': 'Ödeme planı',
        'negotiate.plan': 'Müşterinin tercihi',
        'negotiate.objection': 'Ödememe nedeni',
        'negotiate.hold': 'Beklemeye al',
        'negotiate.resume': 'Devam et',
        'negotiate.holdLong': 'Müşteri 1 dakikadır beklemede.',
        'plan.full': 'Tek seferde ödeme',
        'plan.installments': 'Taksitli ödeme',
        'plan.none': 'Ödeme yapmayacak',
        'promise.title': 'Ödeme sözü',
        'promise.amount': 'Söz verilen tutar',
        'promise.date': 'Ödeme tarihi',
        'promise.save': 'Sözü kaydet',
        'promise.invalid': 'Tutar ve tarih zorunludur.',
        'promise.failed': 'Ödeme sözü kaydedilemedi.',
        'wrapUp.title': 'Kapanış',
        'wrapUp.text': 'Görüşmeyi sonlandırmadan önce sonuç kodunu seçin.',
        'wrapUp.promise': 'Ödeme sözü',
        'wrapUp.callback': 'Geri arama',
        'wrapUp.escalate': 'Üst birime aktar',
        'wrapUp.disposition': 'Sonuç kodu',
      },
      en: {
        'common.next': 'Next',
        'common.finish': 'Finish',
        'rpc.title': 'Right party contact',
        'rpc.question': 'Am I speaking with {name}?',
        'rpc.yes': 'Yes, speaking',
        'rpc.no': 'No',
        'disclosure.title': 'Legal disclosure',
        'disclosure.text': 'This call is recorded and concerns the collection of a debt.',
        'disclosure.read': 'Disclosure read',
        'balance.title': 'Balance',
        'balance.text':
          'Your account has an overdue balance of {amount} TRY, {days} days past due.',
        'balance.escalation': 'Final stage before legal action.',
        'balance.history': 'Payment history',
        'balance.date': 'Date',
        'balance.amount': 'Amount',
        'balance.dispute': 'Customer disputes the debt',
        'negotiate.title': 'Payment plan',
        'negotiate.plan': 'Customer preference',
        'negotiate.objection': 'Reason for not paying',
        'negotiate.hold': 'Put on hold',
        'negotiate.resume': 'Resume',
        'negotiate.holdLong': 'Customer has been on hold for 1 minute.',
        'plan.full': 'Pay in full',
        'plan.installments': 'Pay in installments',
        'plan.none': 'Will not pay',
        'promise.title': 'Promise to pay',
        'promise.amount': 'Promised amount',
        'promise.date': 'Payment date',
        'promise.save': 'Save promise',
        'promise.invalid': 'Amount and date are required.',
        'promise.failed': 'Could not save the promise to pay.',
        'wrapUp.title': 'Wrap-up',
        'wrapUp.text': 'Choose a disposition before ending the call.',
        'wrapUp.promise': 'Promise to pay',
        'wrapUp.callback': 'Callback',
        'wrapUp.escalate': 'Escalate',
        'wrapUp.disposition': 'Disposition',
      },
    },
  },
};
