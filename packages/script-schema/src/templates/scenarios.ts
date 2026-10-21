import type { TestScenarioInput } from '../schema/preview.js';

/**
 * Regression scenarios shipped with the built-in templates (DIFFERENTIATORS A6), so a script
 * created from a template is tested from its first version and passes the publication gate.
 * All data is synthetic. Every scenario is verified against the real runtime in tests.
 */
const surveyContext = {};
const surveySubmitted = { kind: 'success' as const, outputs: { responseId: 'synthetic-response' } };

export const SURVEY_SCENARIOS: TestScenarioInput[] = [
  {
    id: 'surveyPromoter',
    name: 'Destekçi müşteri anketi tamamlıyor',
    synthetic: true,
    context: surveyContext,
    dataSources: { submitSurvey: surveySubmitted },
    steps: [
      { type: 'event', node: 'btn-intro-start', event: 'onPress' },
      { type: 'variable', variable: 'npsScore', value: 10 },
      { type: 'event', node: 'btn-nps-next', event: 'onPress' },
      { type: 'event', node: 'btn-reasons-high-next', event: 'onPress' },
      { type: 'event', node: 'btn-submit', event: 'onPress' },
      { type: 'event', node: 'btn-thanks', event: 'onPress' },
    ],
    expected: { ended: true, outcome: 'SURVEY_DONE', variables: { npsSegment: 'promoter' } },
  },
  {
    id: 'surveyDetractor',
    name: 'Düşük puan veren müşteri nedenini anlatıyor',
    synthetic: true,
    context: surveyContext,
    dataSources: { submitSurvey: surveySubmitted },
    steps: [
      { type: 'event', node: 'btn-intro-start', event: 'onPress' },
      { type: 'variable', variable: 'npsScore', value: 3 },
      { type: 'event', node: 'btn-nps-next', event: 'onPress' },
      { type: 'event', node: 'btn-reasons-low-next', event: 'onPress' },
      { type: 'event', node: 'btn-submit', event: 'onPress' },
      { type: 'event', node: 'btn-thanks', event: 'onPress' },
    ],
    expected: { ended: true, outcome: 'SURVEY_DONE', variables: { npsSegment: 'detractor' } },
  },
  {
    id: 'surveyPassive',
    name: 'Kararsız müşteri doğrudan yoruma geçiyor',
    synthetic: true,
    context: surveyContext,
    dataSources: { submitSurvey: surveySubmitted },
    steps: [
      { type: 'event', node: 'btn-intro-start', event: 'onPress' },
      { type: 'variable', variable: 'npsScore', value: 7 },
      { type: 'event', node: 'btn-nps-next', event: 'onPress' },
    ],
    expected: { page: 'comment', variables: { npsSegment: 'passive' } },
  },
  {
    id: 'surveySubmitFails',
    name: 'Gönderim başarısız olunca ajan yorum sayfasında kalıyor',
    synthetic: true,
    context: surveyContext,
    dataSources: { submitSurvey: { kind: 'error', outputs: {} } },
    steps: [
      { type: 'event', node: 'btn-intro-start', event: 'onPress' },
      { type: 'variable', variable: 'npsScore', value: 8 },
      { type: 'event', node: 'btn-nps-next', event: 'onPress' },
      { type: 'event', node: 'btn-submit', event: 'onPress' },
    ],
    expected: { page: 'comment', ended: false },
  },
];

const debtFound = {
  kind: 'success' as const,
  outputs: { holderName: 'Synthetic Customer', amount: 1500, days: 30, history: [] },
};
const promiseRegistered = { kind: 'success' as const, outputs: { reference: 'synthetic-ref' } };
const toNegotiation = [
  { type: 'event' as const, node: 'btn-rpc-yes', event: 'onPress' },
  { type: 'event' as const, node: 'btn-disclosure-next', event: 'onPress' },
  { type: 'event' as const, node: 'btn-balance-next', event: 'onPress' },
];

export const COLLECTIONS_SCENARIOS: TestScenarioInput[] = [
  {
    id: 'collectionsPromiseToPay',
    name: 'Doğru kişi taksit planı ve ödeme sözü veriyor',
    synthetic: true,
    context: {},
    dataSources: { debtInfo: debtFound, registerPromise: promiseRegistered },
    steps: [
      ...toNegotiation,
      { type: 'variable', variable: 'paymentPlan', value: 'installments' },
      { type: 'event', node: 'btn-negotiate-next', event: 'onPress' },
      { type: 'variable', variable: 'promiseAmount', value: 500 },
      { type: 'variable', variable: 'promiseDate', value: '2026-11-02' },
      { type: 'event', node: 'btn-promise-save', event: 'onPress' },
      { type: 'event', node: 'btn-wrap-up', event: 'onPress' },
    ],
    expected: { ended: true, outcome: 'PTP', variables: { ptpReference: 'synthetic-ref' } },
  },
  {
    id: 'collectionsRefused',
    name: 'Doğru kişi her planı reddediyor',
    synthetic: true,
    context: {},
    dataSources: { debtInfo: debtFound, registerPromise: promiseRegistered },
    steps: [
      ...toNegotiation,
      { type: 'variable', variable: 'paymentPlan', value: 'none' },
      { type: 'variable', variable: 'objectionReason', value: 'Synthetic objection' },
      { type: 'event', node: 'btn-negotiate-next', event: 'onPress' },
      // The agent picks a disposition in the wrap-up picker.
      { type: 'actions', actions: [{ type: 'setDisposition', code: 'CALLBACK' }] },
      { type: 'event', node: 'btn-wrap-up', event: 'onPress' },
    ],
    expected: { ended: true, outcome: 'REFUSED' },
  },
  {
    id: 'collectionsWrongParty',
    name: 'Yanlış kişiyle görüşme, bilgilendirme yapılmadan sonuçla bitiyor',
    synthetic: true,
    context: {},
    dataSources: { debtInfo: debtFound, registerPromise: promiseRegistered },
    steps: [{ type: 'event', node: 'btn-rpc-no', event: 'onPress' }],
    expected: { ended: true, outcome: 'WRONG_PARTY' },
  },
];

const telecomMocks = {
  sendOtp: { kind: 'success' as const, outputs: {} },
  verifyOtp: { kind: 'success' as const, outputs: { valid: true } },
  subscriberInfo: {
    kind: 'success' as const,
    outputs: { tariff: 'S20', usage: [], contractEnd: '2027-01-01' },
  },
  tariffCatalog: { kind: 'success' as const, outputs: { offers: [] } },
  changeTariff: { kind: 'success' as const, outputs: { orderId: 'synthetic-order' } },
};
const toCatalog = [
  { type: 'event' as const, node: 'btn-identify-next', event: 'onPress' },
  { type: 'variable' as const, variable: 'otpCode', value: '000000' },
  { type: 'event' as const, node: 'btn-otp-verify', event: 'onPress' },
  { type: 'event' as const, node: 'btn-current-next', event: 'onPress' },
  { type: 'variable' as const, variable: 'selectedTariff', value: 'S40' },
  { type: 'event' as const, node: 'btn-catalog-next', event: 'onPress' },
];

export const TELECOM_SCENARIOS: TestScenarioInput[] = [
  {
    id: 'telecomTariffChanged',
    name: 'Doğrulanan abone yeni tarifeyi onaylıyor',
    synthetic: true,
    context: {},
    dataSources: telecomMocks,
    steps: [
      ...toCatalog,
      { type: 'variable', variable: 'tariffChangeConfirmed', value: true },
      { type: 'event', node: 'btn-confirm-next', event: 'onPress' },
      { type: 'event', node: 'btn-done', event: 'onPress' },
    ],
    expected: {
      ended: true,
      outcome: 'TARIFF_CHANGED',
      variables: { currentTariff: 'S20', selectedTariff: 'S40' },
    },
  },
  {
    id: 'telecomWrongOtp',
    name: 'Reddedilen tek kullanımlık kod ajanı doğrulamada tutuyor',
    synthetic: true,
    context: {},
    dataSources: { ...telecomMocks, verifyOtp: { kind: 'error', outputs: {} } },
    steps: [
      { type: 'event', node: 'btn-identify-next', event: 'onPress' },
      { type: 'variable', variable: 'otpCode', value: '999999' },
      { type: 'event', node: 'btn-otp-verify', event: 'onPress' },
    ],
    expected: { page: 'otp', variables: { otpAttempts: 1 } },
  },
  {
    id: 'telecomNotConfirmed',
    name: 'Onay verilmezse ajan tarife listesine dönüyor',
    synthetic: true,
    context: {},
    dataSources: telecomMocks,
    steps: [...toCatalog, { type: 'event', node: 'btn-confirm-next', event: 'onPress' }],
    expected: { page: 'catalog' },
  },
  {
    id: 'telecomChangeFails',
    name: 'Tarife değişikliği başarısız olunca görüşme aktarılıyor',
    synthetic: true,
    context: {},
    dataSources: { ...telecomMocks, changeTariff: { kind: 'error', outputs: {} } },
    steps: [
      ...toCatalog,
      { type: 'variable', variable: 'tariffChangeConfirmed', value: true },
      { type: 'event', node: 'btn-confirm-next', event: 'onPress' },
    ],
    expected: { page: 'transfer' },
  },
];

const cardLookup = {
  kind: 'success' as const,
  outputs: { fullName: 'Synthetic Customer', segment: 'retail' },
};
const cardScore = { kind: 'success' as const, outputs: { score: 700, approvedLimit: 20000 } };

/**
 * Identity verification needs card digits and income (personal data), which document scenarios
 * may never contain, so these stop at verification and the technical-failure path. The whole
 * sale is walked by the component package's template test.
 */
export const CREDIT_CARD_SCENARIOS: TestScenarioInput[] = [
  {
    id: 'cardReachesVerification',
    name: 'Müşteri bulunuyor, ajan kimlik doğrulamaya geçiyor',
    synthetic: true,
    context: {},
    dataSources: { customerLookup: cardLookup, creditScore: cardScore },
    steps: [{ type: 'event', node: 'btn-welcome-next', event: 'onPress' }],
    expected: { page: 'verify-identity' },
  },
  {
    id: 'cardLookupFails',
    name: 'Müşteri sorgusu başarısız olunca görüşme teknik hata sonucuyla bitiyor',
    synthetic: true,
    context: {},
    dataSources: { customerLookup: { kind: 'error', outputs: {} }, creditScore: cardScore },
    steps: [{ type: 'event', node: 'btn-welcome-next', event: 'onPress' }],
    expected: { ended: true, outcome: 'TECH_ERROR' },
  },
];

const policyFound = {
  kind: 'success' as const,
  outputs: {
    holderName: 'Synthetic Customer',
    product: 'Kasko',
    premium: 9000,
    endDate: '2026-12-01',
    claims: 0,
    coverages: [{ name: 'Synthetic cover', limit: '100000' }],
  },
};
const quoteReady = {
  kind: 'success' as const,
  outputs: { premium: 9600, quote: 'synthetic-quote' },
};
const renewed = { kind: 'success' as const, outputs: { reference: 'synthetic-renewal' } };
const insuranceMocks = {
  policyLookup: policyFound,
  renewalQuote: quoteReady,
  renewPolicy: renewed,
};
/** Recording notice read, policy checked, cover and needs reviewed, quote terms read. */
const toInsuranceDecision = [
  { type: 'read' as const, node: 'greeting-notice', acknowledged: true },
  { type: 'event' as const, node: 'btn-greeting-next', event: 'onPress' },
  { type: 'variable' as const, variable: 'policyNumber', value: 'SYN-POL-1' },
  { type: 'variable' as const, variable: 'identityConfirmed', value: true },
  { type: 'event' as const, node: 'btn-verify-next', event: 'onPress' },
  { type: 'event' as const, node: 'btn-coverage-next', event: 'onPress' },
  { type: 'variable' as const, variable: 'addRoadside', value: true },
  { type: 'event' as const, node: 'btn-needs-next', event: 'onPress' },
  { type: 'read' as const, node: 'quote-terms', acknowledged: true },
];

export const INSURANCE_SCENARIOS: TestScenarioInput[] = [
  {
    id: 'insuranceRenewed',
    name: 'Müşteri yenileme teklifini kabul edip kayıtlı kartla ödüyor',
    synthetic: true,
    context: {},
    dataSources: insuranceMocks,
    steps: [
      ...toInsuranceDecision,
      { type: 'event', node: 'btn-quote-accept', event: 'onPress' },
      { type: 'variable', variable: 'paymentMethod', value: 'cardOnFile' },
      { type: 'variable', variable: 'consentGiven', value: true },
      { type: 'event', node: 'btn-confirm', event: 'onPress' },
      { type: 'event', node: 'btn-summary-finish', event: 'onPress' },
    ],
    expected: {
      ended: true,
      outcome: 'RENEWED',
      variables: { renewalReference: 'synthetic-renewal', newPremium: 9600 },
    },
  },
  {
    id: 'insuranceCallback',
    name: 'Müşteri düşünmek istiyor, geri arama planlanıyor',
    synthetic: true,
    context: {},
    dataSources: insuranceMocks,
    steps: [
      ...toInsuranceDecision,
      { type: 'event', node: 'btn-quote-think', event: 'onPress' },
      { type: 'variable', variable: 'callbackDate', value: '2026-11-15' },
      { type: 'event', node: 'btn-callback', event: 'onPress' },
    ],
    expected: { ended: true, outcome: 'CALLBACK' },
  },
  {
    id: 'insuranceDeclined',
    name: 'Müşteri fiyat nedeniyle yenilemeyi reddediyor',
    synthetic: true,
    context: {},
    dataSources: insuranceMocks,
    steps: [
      ...toInsuranceDecision,
      { type: 'event', node: 'btn-quote-decline', event: 'onPress' },
      { type: 'variable', variable: 'declineReason', value: 'price' },
      { type: 'event', node: 'btn-decline', event: 'onPress' },
    ],
    expected: { ended: true, outcome: 'NOT_RENEWED' },
  },
  {
    id: 'insuranceUnavailable',
    name: 'Müşteri şu an konuşamıyor; görüşme bilgilendirmeden önce bitiyor',
    synthetic: true,
    context: {},
    dataSources: insuranceMocks,
    steps: [{ type: 'event', node: 'btn-greeting-unavailable', event: 'onPress' }],
    expected: { ended: true, outcome: 'NOT_AVAILABLE' },
  },
  {
    id: 'insuranceLookupFails',
    name: 'Poliçe sorgusu başarısız olunca görüşme teknik hata sonucuyla bitiyor',
    synthetic: true,
    context: {},
    dataSources: { ...insuranceMocks, policyLookup: { kind: 'error', outputs: {} } },
    steps: toInsuranceDecision.slice(0, 5),
    expected: { ended: true, outcome: 'TECH_ERROR' },
  },
];

const orderFound = {
  kind: 'success' as const,
  outputs: {
    buyer: 'Synthetic Customer',
    status: 'shipped',
    statusText: 'kargoda',
    carrier: 'Synthetic Kargo',
    tracking: 'SYN123',
    eta: '2026-10-25',
    delay: 2,
    items: [{ name: 'Synthetic item', quantity: 1 }],
  },
};
const caseCreated = { kind: 'success' as const, outputs: { reference: 'synthetic-case' } };
const orderMocks = { orderLookup: orderFound, createReturn: caseCreated, createClaim: caseCreated };
const toRequest = [
  { type: 'read' as const, node: 'greeting-notice', acknowledged: true },
  { type: 'variable' as const, variable: 'orderNumber', value: 'SYN-ORDER-1' },
  { type: 'event' as const, node: 'btn-greeting-next', event: 'onPress' },
  { type: 'variable' as const, variable: 'identityConfirmed', value: true },
  { type: 'event' as const, node: 'btn-verify-next', event: 'onPress' },
];

export const ECOMMERCE_SCENARIOS: TestScenarioInput[] = [
  {
    id: 'orderWhereIsMyParcel',
    name: 'Müşteri kargosunu soruyor ve bilgilendiriliyor',
    synthetic: true,
    context: {},
    dataSources: orderMocks,
    steps: [
      ...toRequest,
      { type: 'event', node: 'btn-order-next', event: 'onPress' },
      { type: 'event', node: 'btn-delivery-done', event: 'onPress' },
      { type: 'event', node: 'btn-summary-finish', event: 'onPress' },
    ],
    expected: { ended: true, outcome: 'RESOLVED' },
  },
  {
    id: 'orderReturn',
    name: 'Müşteri iade koşullarını dinledikten sonra ürünü iade ediyor',
    synthetic: true,
    context: {},
    dataSources: orderMocks,
    steps: [
      ...toRequest,
      { type: 'variable', variable: 'requestType', value: 'return' },
      { type: 'event', node: 'btn-order-next', event: 'onPress' },
      { type: 'read', node: 'return-terms', acknowledged: true },
      { type: 'variable', variable: 'returnReason', value: 'size' },
      { type: 'event', node: 'btn-return-create', event: 'onPress' },
      { type: 'event', node: 'btn-summary-finish', event: 'onPress' },
    ],
    expected: { ended: true, outcome: 'RESOLVED', variables: { caseReference: 'synthetic-case' } },
  },
  {
    id: 'orderDamaged',
    name: 'Müşteri hasarlı ürün bildiriyor, değişim talebi açılıyor',
    synthetic: true,
    context: {},
    dataSources: orderMocks,
    steps: [
      ...toRequest,
      { type: 'variable', variable: 'requestType', value: 'damaged' },
      { type: 'event', node: 'btn-order-next', event: 'onPress' },
      { type: 'variable', variable: 'damageDetails', value: 'Synthetic damage description' },
      { type: 'event', node: 'btn-damage-create', event: 'onPress' },
      { type: 'event', node: 'btn-summary-finish', event: 'onPress' },
    ],
    expected: { ended: true, outcome: 'RESOLVED', variables: { caseReference: 'synthetic-case' } },
  },
  {
    id: 'orderNotFound',
    name: 'Bilinmeyen sipariş numarasıyla görüşme kimlik doğrulamadan önce bitiyor',
    synthetic: true,
    context: {},
    dataSources: { ...orderMocks, orderLookup: { kind: 'error', outputs: {} } },
    steps: toRequest.slice(0, 3),
    expected: { ended: true, outcome: 'ORDER_NOT_FOUND' },
  },
];

export type TemplateWithScenarios =
  | 'survey'
  | 'collections'
  | 'telecomTariffChange'
  | 'creditCardSales'
  | 'insuranceRenewal'
  | 'ecommerceOrder';
export const TEMPLATE_SCENARIOS: Readonly<
  Record<TemplateWithScenarios, readonly TestScenarioInput[]>
> = {
  survey: SURVEY_SCENARIOS,
  collections: COLLECTIONS_SCENARIOS,
  telecomTariffChange: TELECOM_SCENARIOS,
  creditCardSales: CREDIT_CARD_SCENARIOS,
  insuranceRenewal: INSURANCE_SCENARIOS,
  ecommerceOrder: ECOMMERCE_SCENARIOS,
};
