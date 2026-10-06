import { applyJsonPatch, type JsonPatchOperation } from '../tree/json-patch.js';

import { collectionsScript } from './collections.js';
import { creditCardSalesScript } from './credit-card-sales.js';
import { surveyScript } from './survey.js';
import { telecomTariffChangeScript } from './telecom-tariff-change.js';

import type { ScriptDocumentInput } from '../schema/document.js';
import type { ValidationCode } from '../validation/issues.js';

export interface BrokenFixture {
  readonly name: string;
  readonly document: unknown;
  /** Exactly the set of issue codes validation must report. */
  readonly expectedCodes: readonly ValidationCode[];
}

const broken = (
  name: string,
  base: ScriptDocumentInput,
  operations: readonly JsonPatchOperation[],
  expectedCodes: readonly ValidationCode[],
): BrokenFixture => ({ name, document: applyJsonPatch(base, operations), expectedCodes });

const WELCOME_BUTTON_ACTIONS = '/pages/0/layout/children/2/events/onPress/-';

/** Deliberately broken documents: each one must yield exactly its expected codes. */
export const BROKEN_FIXTURES: readonly BrokenFixture[] = [
  broken(
    'cyclic-flow',
    creditCardSalesScript,
    [
      {
        op: 'add',
        path: '/flow/edges/-',
        value: { id: 'e-loop', from: 'n-summary', to: 'n-consent' },
      },
    ],
    ['FLOW_CYCLE'],
  ),
  broken(
    'unreachable-page',
    telecomTariffChangeScript,
    [
      {
        op: 'add',
        path: '/pages/-',
        value: { id: 'orphan', name: 'Kimsesiz', layout: { id: 'orphan-root', type: 'box' } },
      },
    ],
    ['PAGE_UNREACHABLE'],
  ),
  broken(
    'undefined-variable',
    collectionsScript,
    [
      {
        op: 'replace',
        path: '/pages/2/layout/children/0/bindings/0/expression',
        value: '{ amount: vars.debtAmount, days: vars.missingVar }',
      },
    ],
    ['VARIABLE_UNDEFINED'],
  ),
  broken(
    'unknown-component',
    surveyScript,
    [{ op: 'replace', path: '/pages/0/layout/children/0/type', value: 'fancyWidget' }],
    ['COMPONENT_TYPE_UNKNOWN'],
  ),
  broken(
    'broken-page-ref',
    creditCardSalesScript,
    [{ op: 'add', path: WELCOME_BUTTON_ACTIONS, value: { type: 'navigate', page: 'nowhere' } }],
    ['PAGE_REF_BROKEN'],
  ),
  broken(
    'duplicate-id',
    telecomTariffChangeScript,
    [
      {
        op: 'replace',
        path: '/pages/3/layout/children/2/children/1/id',
        value: 'btn-catalog-back',
      },
    ],
    ['DUPLICATE_ID'],
  ),
  broken(
    'broken-flow-edge',
    creditCardSalesScript,
    [
      {
        op: 'add',
        path: '/flow/edges/-',
        value: { id: 'e-ghost', from: 'n-welcome', to: 'n-ghost' },
      },
    ],
    ['FLOW_EDGE_BROKEN'],
  ),
  broken(
    'subflow-recursion',
    telecomTariffChangeScript,
    [
      {
        op: 'add',
        path: '/subflows/0/nodes/-',
        value: { id: 's-recheck', type: 'subflow', flow: 'verify-otp' },
      },
      {
        op: 'add',
        path: '/subflows/0/edges/-',
        value: {
          id: 's-e7',
          from: 's-check',
          to: 's-recheck',
          when: { $expr: 'vars.otpAttempts == 2' },
        },
      },
      {
        op: 'add',
        path: '/subflows/0/edges/-',
        value: { id: 's-e8', from: 's-recheck', to: 's-ok' },
      },
    ],
    ['SUBFLOW_CYCLE'],
  ),
  broken(
    'dangling-references',
    telecomTariffChangeScript,
    [
      { op: 'add', path: '/pages/0/layout/children/0/visibleWhen', value: { $rule: 'r-none' } },
      {
        op: 'add',
        path: '/pages/0/layout/children/1/events/onPress/-',
        value: { type: 'startTimer', timer: 'no-timer' },
      },
      {
        op: 'add',
        path: '/pages/0/layout/children/1/events/onPress/-',
        value: { type: 'runSubflow', flow: 'no-flow' },
      },
      {
        op: 'add',
        path: '/pages/0/layout/children/1/events/onPress/-',
        value: { type: 'maskField', node: 'no-node' },
      },
      {
        op: 'add',
        path: '/pages/0/layout/children/1/events/onPress/-',
        value: { type: 'callDataSource', dataSource: 'noSuchSource' },
      },
      {
        op: 'add',
        path: '/pages/0/layout/children/1/visibleWhen',
        value: { $expr: 'ds.subscriberInfo.unknownField != null' },
      },
    ],
    [
      'RULE_REF_BROKEN',
      'TIMER_REF_BROKEN',
      'SUBFLOW_REF_BROKEN',
      'NODE_REF_BROKEN',
      'DATASOURCE_REF_BROKEN',
      'DATASOURCE_FIELD_UNKNOWN',
    ],
  ),
  broken(
    'pci-leak',
    creditCardSalesScript,
    [
      { op: 'replace', path: '/variables/2/persist', value: true },
      {
        op: 'add',
        path: '/pages/1/layout/children/2/events/onPress/-',
        value: {
          type: 'logEvent',
          event: 'verify.attempt',
          data: { digits: { $expr: 'vars.cardLast4' } },
        },
      },
    ],
    ['VARIABLE_PCI_PERSISTED', 'SENSITIVE_DATA_EXPOSED'],
  ),
  broken(
    'readonly-global',
    creditCardSalesScript,
    [
      {
        op: 'add',
        path: WELCOME_BUTTON_ACTIONS,
        value: { type: 'setVariable', variable: 'maxCreditLimit', value: 1 },
      },
    ],
    ['VARIABLE_READONLY'],
  ),
  broken(
    'type-mismatch',
    surveyScript,
    [
      {
        op: 'add',
        path: '/pages/1/layout/children/1/events/onPress/0',
        value: { type: 'setVariable', variable: 'npsScore', value: 'ten' },
      },
    ],
    ['VARIABLE_TYPE_MISMATCH'],
  ),
  broken(
    'i18n-problems',
    surveyScript,
    [
      { op: 'add', path: '/pages/0/layout/children/0/props/label', value: 'Merhaba' },
      { op: 'replace', path: '/pages/0/layout/children/1/props/labelKey', value: 'intro.missing' },
      { op: 'remove', path: '/i18n/messages/en/thanks.text' },
    ],
    ['I18N_LITERAL_TEXT', 'I18N_KEY_MISSING', 'I18N_TRANSLATION_MISSING'],
  ),
  broken(
    'schema-invalid',
    surveyScript,
    [
      { op: 'add', path: '/pages/0/layout/children/1/onClick', value: 'alert(1)' },
      {
        op: 'add',
        path: '/pages/0/layout/children/1/events/onPress/-',
        value: { type: 'eval', code: 'fetch("/x")' },
      },
    ],
    ['SCHEMA_INVALID'],
  ),
  broken(
    'unsupported-version',
    surveyScript,
    [{ op: 'replace', path: '/schemaVersion', value: '2.0.0' }],
    ['SCHEMA_VERSION_UNSUPPORTED'],
  ),
];
