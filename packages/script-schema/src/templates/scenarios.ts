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
    name: 'Promoter completes the survey',
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
    name: 'Detractor explains the low score',
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
    name: 'Passive goes straight to the comment',
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
    name: 'Failed submission keeps the agent on the comment page',
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
    name: 'Right party agrees an instalment plan and a promise to pay',
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
    name: 'Right party refuses any plan',
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
    name: 'Wrong party ends the call with its outcome and without disclosure',
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
    name: 'Verified subscriber confirms a new tariff',
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
    name: 'A rejected one-time code keeps the agent on verification',
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
    name: 'Without confirmation the agent returns to the catalog',
    synthetic: true,
    context: {},
    dataSources: telecomMocks,
    steps: [...toCatalog, { type: 'event', node: 'btn-confirm-next', event: 'onPress' }],
    expected: { page: 'catalog' },
  },
  {
    id: 'telecomChangeFails',
    name: 'A failed tariff change hands the call over',
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
 * Identity verification needs card digits (PCI), which scenarios may never contain, so the
 * credit card template is tested up to verification and on its technical-failure path.
 */
export const CREDIT_CARD_SCENARIOS: TestScenarioInput[] = [
  {
    id: 'cardReachesVerification',
    name: 'Customer found, agent reaches identity verification',
    synthetic: true,
    context: {},
    dataSources: { customerLookup: cardLookup, creditScore: cardScore },
    steps: [{ type: 'event', node: 'btn-welcome-next', event: 'onPress' }],
    expected: { page: 'verify-identity' },
  },
  {
    id: 'cardLookupFails',
    name: 'Failed customer lookup ends the call with a technical-error outcome',
    synthetic: true,
    context: {},
    dataSources: { customerLookup: { kind: 'error', outputs: {} }, creditScore: cardScore },
    steps: [{ type: 'event', node: 'btn-welcome-next', event: 'onPress' }],
    expected: { ended: true, outcome: 'TECH_ERROR' },
  },
];

export type TemplateWithScenarios =
  'survey' | 'collections' | 'telecomTariffChange' | 'creditCardSales';
export const TEMPLATE_SCENARIOS: Readonly<
  Record<TemplateWithScenarios, readonly TestScenarioInput[]>
> = {
  survey: SURVEY_SCENARIOS,
  collections: COLLECTIONS_SCENARIOS,
  telecomTariffChange: TELECOM_SCENARIOS,
  creditCardSales: CREDIT_CARD_SCENARIOS,
};
