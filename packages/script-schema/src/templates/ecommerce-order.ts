import type { ScriptDocumentInput } from '../schema/document.js';

/**
 * Order support: recording notice and order number → identity check → order status and the
 * customer's request → where is my parcel, a return with its mandatory terms, or a damaged or
 * missing item → summary. Each request branch requires only its own fields.
 */
export const ecommerceOrderScript: ScriptDocumentInput = {
  schemaVersion: '1.1.0',
  id: '01928f3a-0000-7000-8000-000000000006',
  meta: { name: 'E-ticaret sipariş desteği', tags: ['ecommerce'], channels: ['voice', 'chat'] },
  variables: [
    {
      key: 'orderNumber',
      description: 'sipariş numarası',
      type: 'string',
      scope: 'session',
      source: 'interaction.attributes.orderNumber',
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
      key: 'identityConfirmed',
      description: 'Kimlik doğrulandı',
      type: 'boolean',
      scope: 'session',
      default: false,
    },
    {
      key: 'orderStatus',
      description: 'Sipariş durumu',
      type: 'string',
      scope: 'session',
      default: '',
      persist: true,
    },
    // The order system's own wording in the customer's language ("kargoda", "shipped").
    {
      key: 'orderStatusText',
      description: 'sipariş durumu',
      type: 'string',
      scope: 'session',
      default: '',
    },
    { key: 'carrier', description: 'kargo firması', type: 'string', scope: 'session', default: '' },
    {
      key: 'trackingNumber',
      description: 'takip numarası',
      type: 'string',
      scope: 'session',
      default: '',
    },
    { key: 'deliveryDate', description: 'teslim tarihi', type: 'date', scope: 'session' },
    {
      key: 'delayDays',
      description: 'gecikme günü',
      type: 'number',
      scope: 'session',
      default: 0,
      persist: true,
    },
    {
      key: 'requestType',
      description: 'Talep türü',
      type: 'enum',
      scope: 'session',
      enumValues: ['where', 'return', 'damaged'],
      default: 'where',
      persist: true,
    },
    {
      key: 'returnReason',
      description: 'İade nedeni',
      type: 'enum',
      scope: 'session',
      enumValues: ['size', 'defect', 'changedMind', 'other'],
      persist: true,
    },
    {
      key: 'refundMethod',
      description: 'İade yöntemi',
      type: 'enum',
      scope: 'session',
      enumValues: ['original', 'storeCredit'],
      default: 'original',
      persist: true,
    },
    {
      key: 'damageDetails',
      description: 'Hasar ayrıntıları',
      type: 'string',
      scope: 'session',
      default: '',
    },
    {
      key: 'resolution',
      description: 'Çözüm',
      type: 'enum',
      scope: 'session',
      enumValues: ['replacement', 'refund'],
      default: 'replacement',
      persist: true,
    },
    {
      key: 'caseReference',
      description: 'talep numarası',
      type: 'string',
      scope: 'session',
      classification: 'internal',
    },
  ],
  dataSources: [
    {
      id: 'orderLookup',
      ref: 'tenant-datasource:order-summary',
      version: 1,
      inputs: { orderNumber: { $expr: 'vars.orderNumber' } },
      outputs: {
        buyer: { path: '$.buyer.name', variable: 'customerName' },
        status: { path: '$.status', variable: 'orderStatus' },
        statusText: { path: '$.statusText', variable: 'orderStatusText' },
        carrier: { path: '$.shipment.carrier', variable: 'carrier' },
        tracking: { path: '$.shipment.trackingNumber', variable: 'trackingNumber' },
        eta: { path: '$.shipment.estimatedDelivery', variable: 'deliveryDate' },
        delay: { path: '$.shipment.delayDays', variable: 'delayDays' },
        items: { path: '$.items' },
      },
    },
    {
      id: 'createReturn',
      ref: 'tenant-datasource:create-return',
      version: 1,
      inputs: {
        orderNumber: { $expr: 'vars.orderNumber' },
        reason: { $expr: 'vars.returnReason' },
        refund: { $expr: 'vars.refundMethod' },
      },
      outputs: { reference: { path: '$.reference', variable: 'caseReference' } },
    },
    {
      id: 'createClaim',
      ref: 'tenant-datasource:create-claim',
      version: 1,
      inputs: {
        orderNumber: { $expr: 'vars.orderNumber' },
        details: { $expr: 'vars.damageDetails' },
        resolution: { $expr: 'vars.resolution' },
      },
      outputs: { reference: { path: '$.reference', variable: 'caseReference' } },
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
            id: 'in-order-number',
            type: 'textInput',
            props: { labelKey: 'greeting.orderNumber', required: true },
            bindings: [{ variable: 'orderNumber' }],
          },
          {
            id: 'btn-greeting-next',
            type: 'button',
            props: { variant: 'primary', labelKey: 'greeting.find' },
            events: {
              onPress: [
                {
                  type: 'validatePage',
                  onInvalid: [
                    { type: 'showToast', messageKey: 'greeting.invalid', tone: 'warning' },
                  ],
                },
                { type: 'next' },
              ],
            },
          },
        ],
      },
    },
    {
      id: 'verify',
      name: 'Kimlik doğrulama',
      titleKey: 'verify.title',
      mandatory: true,
      layout: {
        id: 'verify-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'lg' } },
        children: [
          {
            id: 'verify-text',
            type: 'scriptText',
            props: { textKey: 'verify.text' },
            bindings: [{ prop: 'params', expression: '{ name: vars.customerName }' }],
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
            props: { variant: 'primary', labelKey: 'common.next' },
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
      id: 'order',
      name: 'Sipariş durumu',
      titleKey: 'order.title',
      layout: {
        id: 'order-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'lg' } },
        children: [
          {
            id: 'order-text',
            type: 'scriptText',
            props: { textKey: 'order.text' },
            bindings: [
              {
                prop: 'params',
                expression: '{ order: vars.orderNumber, status: vars.orderStatusText }',
              },
            ],
          },
          {
            id: 'order-delay',
            type: 'alert',
            props: { textKey: 'order.delay', tone: 'warning' },
            bindings: [{ prop: 'params', expression: '{ days: vars.delayDays }' }],
            visibleWhen: { $rule: 'r-delayed' },
          },
          {
            id: 'order-items',
            type: 'table',
            props: {
              labelKey: 'order.items',
              columns: [
                { field: 'name', labelKey: 'order.item' },
                { field: 'quantity', labelKey: 'order.quantity' },
              ],
            },
            bindings: [{ prop: 'rows', expression: 'ds.orderLookup.items' }],
          },
          {
            id: 'in-request-type',
            type: 'radioGroup',
            props: {
              labelKey: 'order.request',
              options: [
                { value: 'where', labelKey: 'request.where' },
                { value: 'return', labelKey: 'request.return' },
                { value: 'damaged', labelKey: 'request.damaged' },
              ],
            },
            bindings: [{ variable: 'requestType' }],
          },
          {
            id: 'btn-order-next',
            type: 'button',
            props: { variant: 'primary', labelKey: 'common.next' },
            events: { onPress: [{ type: 'next' }] },
          },
        ],
      },
    },
    {
      id: 'delivery',
      name: 'Kargo bilgisi',
      titleKey: 'delivery.title',
      layout: {
        id: 'delivery-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'lg' } },
        children: [
          {
            id: 'delivery-text',
            type: 'scriptText',
            props: { textKey: 'delivery.text' },
            bindings: [
              {
                prop: 'params',
                expression:
                  "{ carrier: vars.carrier, tracking: vars.trackingNumber, date: if(exists(vars.deliveryDate), formatDate(vars.deliveryDate, 'dd.MM.yyyy'), '—') }",
              },
            ],
          },
          {
            id: 'delivery-apology',
            type: 'alert',
            props: { textKey: 'delivery.apology', tone: 'info' },
            visibleWhen: { $rule: 'r-delayed' },
          },
          {
            id: 'delivery-delivered',
            type: 'alert',
            props: { textKey: 'delivery.delivered', tone: 'warning' },
            visibleWhen: { $expr: "vars.orderStatus == 'delivered'" },
          },
          {
            id: 'btn-delivery-done',
            type: 'button',
            props: { variant: 'primary', labelKey: 'delivery.done' },
            events: {
              onPress: [{ type: 'setDisposition', code: 'INFORMED' }, { type: 'next' }],
            },
          },
        ],
      },
    },
    {
      id: 'return',
      name: 'İade talebi',
      titleKey: 'return.title',
      layout: {
        id: 'return-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'lg' } },
        children: [
          {
            id: 'return-terms',
            type: 'scriptText',
            props: { textKey: 'return.terms', titleKey: 'return.termsTitle', mustRead: true },
            // Read only to customers who ask for a return, so other requests can complete.
            visibleWhen: { $rule: 'r-return' },
          },
          {
            id: 'in-return-reason',
            type: 'select',
            props: {
              labelKey: 'return.reason',
              options: [
                { value: 'size', labelKey: 'reason.size' },
                { value: 'defect', labelKey: 'reason.defect' },
                { value: 'changedMind', labelKey: 'reason.changedMind' },
                { value: 'other', labelKey: 'reason.other' },
              ],
            },
            bindings: [{ variable: 'returnReason' }],
            requiredWhen: { $rule: 'r-return' },
          },
          {
            id: 'in-refund-method',
            type: 'radioGroup',
            props: {
              labelKey: 'return.refund',
              options: [
                { value: 'original', labelKey: 'refund.original' },
                { value: 'storeCredit', labelKey: 'refund.storeCredit' },
              ],
            },
            bindings: [{ variable: 'refundMethod' }],
          },
          {
            id: 'btn-return-create',
            type: 'button',
            props: { variant: 'primary', labelKey: 'return.create' },
            events: {
              onPress: [
                {
                  type: 'validatePage',
                  onInvalid: [{ type: 'showToast', messageKey: 'return.invalid', tone: 'warning' }],
                },
                {
                  type: 'callDataSource',
                  dataSource: 'createReturn',
                  onSuccess: [{ type: 'setDisposition', code: 'RETURN_CREATED' }, { type: 'next' }],
                  onError: [{ type: 'showToast', messageKey: 'common.failed', tone: 'danger' }],
                },
              ],
            },
          },
        ],
      },
    },
    {
      id: 'damage',
      name: 'Hasarlı / eksik ürün',
      titleKey: 'damage.title',
      layout: {
        id: 'damage-root',
        type: 'box',
        style: { base: { direction: 'column', gap: 'md', padding: 'lg' } },
        children: [
          { id: 'damage-text', type: 'scriptText', props: { textKey: 'damage.text' } },
          {
            id: 'in-damage-details',
            type: 'textArea',
            props: { labelKey: 'damage.details' },
            bindings: [{ variable: 'damageDetails' }],
            requiredWhen: { $rule: 'r-damaged' },
          },
          {
            id: 'in-resolution',
            type: 'radioGroup',
            props: {
              labelKey: 'damage.resolution',
              options: [
                { value: 'replacement', labelKey: 'resolution.replacement' },
                { value: 'refund', labelKey: 'resolution.refund' },
              ],
            },
            bindings: [{ variable: 'resolution' }],
          },
          {
            id: 'btn-damage-create',
            type: 'button',
            props: { variant: 'primary', labelKey: 'damage.create' },
            events: {
              onPress: [
                {
                  type: 'validatePage',
                  onInvalid: [{ type: 'showToast', messageKey: 'damage.invalid', tone: 'warning' }],
                },
                {
                  type: 'callDataSource',
                  dataSource: 'createClaim',
                  onSuccess: [{ type: 'setDisposition', code: 'CLAIM_CREATED' }, { type: 'next' }],
                  onError: [{ type: 'showToast', messageKey: 'common.failed', tone: 'danger' }],
                },
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
            id: 'summary-informed',
            type: 'scriptText',
            props: { textKey: 'summary.informed' },
            visibleWhen: { $expr: "vars.requestType == 'where'" },
          },
          {
            id: 'summary-case',
            type: 'scriptText',
            props: { textKey: 'summary.case' },
            bindings: [{ prop: 'params', expression: '{ reference: vars.caseReference }' }],
            visibleWhen: { $expr: "vars.requestType != 'where'" },
          },
          {
            id: 'summary-closing',
            type: 'scriptText',
            props: { textKey: 'summary.closing' },
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
                  attributes: { caseReference: { $expr: 'vars.caseReference' } },
                },
                { type: 'submitOutcome', outcome: 'RESOLVED' },
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
        id: 'n-lookup',
        labelKey: 'flow.lookup',
        type: 'dataSource',
        dataSource: 'orderLookup',
        position: { x: 0, y: 140 },
      },
      { id: 'n-verify', type: 'page', page: 'verify', position: { x: 0, y: 280 } },
      { id: 'n-order', type: 'page', page: 'order', position: { x: 0, y: 420 } },
      { id: 'n-request', labelKey: 'flow.request', type: 'decision', position: { x: 0, y: 560 } },
      { id: 'n-delivery', type: 'page', page: 'delivery', position: { x: -320, y: 700 } },
      { id: 'n-return', type: 'page', page: 'return', position: { x: 0, y: 700 } },
      { id: 'n-damage', type: 'page', page: 'damage', position: { x: 320, y: 700 } },
      { id: 'n-summary', type: 'page', page: 'summary', position: { x: 0, y: 840 } },
      { id: 'n-end', type: 'end', position: { x: 0, y: 980 } },
      // An unknown order number never reaches identity checks: an author-declared early exit.
      {
        id: 'n-end-not-found',
        labelKey: 'flow.notFound',
        type: 'end',
        outcome: 'ORDER_NOT_FOUND',
        completion: 'early',
        position: { x: 320, y: 140 },
      },
    ],
    edges: [
      { id: 'e1', from: 'n-greeting', to: 'n-lookup' },
      { id: 'e2', from: 'n-lookup', to: 'n-verify', port: 'success' },
      { id: 'e3', from: 'n-lookup', to: 'n-end-not-found', port: 'error' },
      { id: 'e4', from: 'n-verify', to: 'n-order' },
      { id: 'e5', from: 'n-order', to: 'n-request' },
      { id: 'e6', from: 'n-request', to: 'n-return', when: { $rule: 'r-return' } },
      { id: 'e7', from: 'n-request', to: 'n-damage', when: { $rule: 'r-damaged' } },
      { id: 'e8', from: 'n-request', to: 'n-delivery', default: true },
      { id: 'e9', from: 'n-delivery', to: 'n-summary' },
      { id: 'e10', from: 'n-return', to: 'n-summary' },
      { id: 'e11', from: 'n-damage', to: 'n-summary' },
      { id: 'e12', from: 'n-summary', to: 'n-end' },
    ],
  },
  rules: [
    { id: 'r-return', when: { fact: 'vars.requestType', op: 'eq', value: 'return' } },
    { id: 'r-damaged', when: { fact: 'vars.requestType', op: 'eq', value: 'damaged' } },
    { id: 'r-delayed', when: { fact: 'vars.delayDays', op: 'gt', value: 0 } },
  ],
  i18n: {
    defaultLocale: 'tr',
    messages: {
      tr: {
        'flow.lookup': 'Sipariş sorgulama',
        'flow.request': 'Talep türü',
        'flow.notFound': 'Sipariş bulunamadı',
        'common.next': 'İleri',
        'common.finish': 'Görüşmeyi bitir',
        'common.failed': 'Talep oluşturulamadı. Tekrar deneyin veya teknik ekibe aktarın.',
        'greeting.title': 'Karşılama',
        'greeting.text':
          'Merhaba, ben {agent}. Siparişinizle ilgili size yardımcı olacağım. Sipariş numaranızı alabilir miyim?',
        'greeting.noticeTitle': 'Kayıt ve kişisel veri bilgilendirmesi',
        'greeting.notice':
          'Bu görüşme hizmet kalitesi için kaydedilmektedir. Kişisel verileriniz 6698 sayılı KVKK kapsamında yalnızca siparişinizle ilgili işlemler için işlenir.',
        'greeting.orderNumber': 'Sipariş numarası',
        'greeting.find': 'Siparişi bul',
        'greeting.invalid': 'Sipariş numarası gerekli.',
        'verify.title': 'Kimlik doğrulama',
        'verify.text':
          '{name} adına kayıtlı siparişi görüyorum. Güvenliğiniz için teslimat adresinizin ilçesini ve e-posta adresinizin ilk harfini teyit edebilir misiniz?',
        'verify.identity': 'Müşteri teslimat ilçesini ve e-posta adresini doğru söyledi',
        'verify.invalid': 'Kimlik teyidi gerekli.',
        'order.title': 'Sipariş durumu',
        'order.text': '{order} numaralı siparişiniz şu anda {status}.',
        'order.delay': 'Teslimat planlanandan {days} gün gecikmeli.',
        'order.items': 'Sipariş içeriği',
        'order.item': 'Ürün',
        'order.quantity': 'Adet',
        'order.request': 'Müşterinin talebi',
        'request.where': 'Kargom nerede?',
        'request.return': 'İade etmek istiyor',
        'request.damaged': 'Ürün hasarlı veya eksik geldi',
        'delivery.title': 'Kargo bilgisi',
        'delivery.text':
          'Siparişiniz {carrier} ile {tracking} takip numarasıyla gönderildi; tahmini teslim tarihi {date}.',
        'delivery.apology':
          'Gecikme için özür dileyin; kargo firmasıyla iletişime geçildiğini belirtin.',
        'delivery.delivered':
          'Sistemde teslim edildi görünüyor. Komşu, site görevlisi ve kargo şubesini kontrol etmesini önerin; bulunamazsa hasarlı/eksik ürün talebi açın.',
        'delivery.done': 'Müşteri bilgilendirildi',
        'return.title': 'İade talebi',
        'return.termsTitle': 'İade koşulları',
        'return.terms':
          'Ürünü teslim aldığınız tarihten itibaren 14 gün içinde, kullanılmamış ve orijinal ambalajında iade edebilirsiniz. Ücret iadesi ürün depomuza ulaştıktan sonra 3 iş günü içinde yapılır.',
        'return.reason': 'İade nedeni',
        'return.refund': 'Ücret iadesi',
        'return.create': 'İade kaydı oluştur',
        'return.invalid': 'İade nedeni gerekli.',
        'reason.size': 'Beden / ölçü uymadı',
        'reason.defect': 'Ürün kusurlu',
        'reason.changedMind': 'Vazgeçti',
        'reason.other': 'Diğer',
        'refund.original': 'Ödeme yapılan karta',
        'refund.storeCredit': 'Mağaza kredisi olarak',
        'damage.title': 'Hasarlı / eksik ürün',
        'damage.text':
          'Yaşadığınız sorun için özür dilerim. Ürünün durumunu veya eksik parçayı kısaca anlatır mısınız?',
        'damage.details': 'Hasar veya eksik açıklaması',
        'damage.resolution': 'Müşterinin tercihi',
        'damage.create': 'Talep oluştur',
        'damage.invalid': 'Hasar açıklaması gerekli.',
        'resolution.replacement': 'Yenisiyle değişim',
        'resolution.refund': 'Ücret iadesi',
        'summary.title': 'Özet',
        'summary.invalid':
          'Görüşmeyi bitirmeden önce eksik alanları ve zorunlu bilgilendirmeleri tamamlayın.',
        'summary.informed': 'Siparişinizin durumu ve teslim tarihi hakkında bilgi verdim.',
        'summary.case': 'Talebiniz {reference} referans numarasıyla oluşturuldu.',
        'summary.closing': 'Başka yardımcı olabileceğim bir konu var mı? İyi günler dilerim.',
      },
      en: {
        'flow.lookup': 'Order lookup',
        'flow.request': 'Request type',
        'flow.notFound': 'Order not found',
        'common.next': 'Next',
        'common.finish': 'End call',
        'common.failed': 'The request could not be created. Try again or hand over to support.',
        'greeting.title': 'Greeting',
        'greeting.text':
          'Hello, this is {agent}. I will help you with your order. May I have your order number?',
        'greeting.noticeTitle': 'Recording and personal data notice',
        'greeting.notice':
          'This call is recorded for service quality. Your personal data is processed only for your order under applicable data protection law.',
        'greeting.orderNumber': 'Order number',
        'greeting.find': 'Find order',
        'greeting.invalid': 'An order number is required.',
        'verify.title': 'Identity check',
        'verify.text':
          'I can see an order for {name}. For your security, could you confirm the delivery district and the first letter of your email address?',
        'verify.identity': 'Customer confirmed the delivery district and email address',
        'verify.invalid': 'Identity confirmation is required.',
        'order.title': 'Order status',
        'order.text': 'Your order {order} is currently {status}.',
        'order.delay': 'Delivery is {days} days late.',
        'order.items': 'Order contents',
        'order.item': 'Item',
        'order.quantity': 'Quantity',
        'order.request': 'Customer request',
        'request.where': 'Where is my parcel?',
        'request.return': 'Wants to return it',
        'request.damaged': 'Item arrived damaged or incomplete',
        'delivery.title': 'Delivery',
        'delivery.text':
          'Your order was shipped with {carrier}, tracking number {tracking}; estimated delivery {date}.',
        'delivery.apology': 'Apologise for the delay and say the carrier has been contacted.',
        'delivery.delivered':
          'The system shows it as delivered. Suggest checking with neighbours, the building and the carrier branch; if it is not found, open a missing item request.',
        'delivery.done': 'Customer informed',
        'return.title': 'Return request',
        'return.termsTitle': 'Return terms',
        'return.terms':
          'You can return unused items in their original packaging within 14 days of delivery. The refund is made within 3 working days after the item reaches our warehouse.',
        'return.reason': 'Return reason',
        'return.refund': 'Refund to',
        'return.create': 'Create return',
        'return.invalid': 'A return reason is required.',
        'reason.size': 'Size did not fit',
        'reason.defect': 'Item is faulty',
        'reason.changedMind': 'Changed their mind',
        'reason.other': 'Other',
        'refund.original': 'The card used to pay',
        'refund.storeCredit': 'Store credit',
        'damage.title': 'Damaged or missing item',
        'damage.text':
          'I am sorry about this. Could you briefly describe the damage or the missing part?',
        'damage.details': 'Damage or missing item description',
        'damage.resolution': 'Customer preference',
        'damage.create': 'Create request',
        'damage.invalid': 'A description is required.',
        'resolution.replacement': 'Replacement',
        'resolution.refund': 'Refund',
        'summary.title': 'Summary',
        'summary.invalid':
          'Complete the missing fields and required notices before ending the call.',
        'summary.informed': 'I have told you the status and expected delivery date of your order.',
        'summary.case': 'Your request was created with reference {reference}.',
        'summary.closing': 'Is there anything else I can help you with? Have a nice day.',
      },
    },
  },
};
