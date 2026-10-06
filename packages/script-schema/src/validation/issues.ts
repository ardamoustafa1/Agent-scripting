/** Stable machine codes for script validation issues. Never rename; add new ones instead. */
export const VALIDATION_CODES = [
  // Structural (zod) and format
  'SCHEMA_INVALID',
  'SCHEMA_VERSION_MISSING',
  'SCHEMA_VERSION_UNSUPPORTED',
  'MIGRATION_FAILED',
  'DOCUMENT_TOO_LARGE',
  'NODE_DEPTH_EXCEEDED',
  'NODE_COUNT_EXCEEDED',
  // Identity
  'DUPLICATE_ID',
  'SCENARIO_INVALID',
  'SCENARIO_SENSITIVE',
  // References
  'PAGE_REF_BROKEN',
  'DATASOURCE_REF_BROKEN',
  'DATASOURCE_FIELD_UNKNOWN',
  'RULE_REF_BROKEN',
  'SUBFLOW_REF_BROKEN',
  'TIMER_REF_BROKEN',
  'NODE_REF_BROKEN',
  'VARIABLE_UNDEFINED',
  'COMPONENT_TYPE_UNKNOWN',
  // Flow graph
  'FLOW_START_MISSING',
  'FLOW_EDGE_BROKEN',
  'FLOW_CYCLE',
  'SUBFLOW_CYCLE',
  'FLOW_NODE_UNREACHABLE',
  'FLOW_DEAD_END',
  'FLOW_DATASOURCE_NO_ERROR_EDGE',
  'PAGE_UNREACHABLE',
  // Variables and data classification
  'VARIABLE_READONLY',
  'VARIABLE_TYPE_MISMATCH',
  'VARIABLE_ENUM_VALUES_MISSING',
  'VARIABLE_PCI_PERSISTED',
  'VARIABLE_CLASSIFICATION_MISMATCH',
  'SENSITIVE_DATA_EXPOSED',
  'CONSENT_PRESELECTED',
  // Bindings and i18n
  'BINDING_DUPLICATE_PROP',
  'I18N_DEFAULT_LOCALE_MISSING',
  'I18N_KEY_MISSING',
  'I18N_TRANSLATION_MISSING',
  'I18N_LITERAL_TEXT',
] as const;

export type ValidationCode = (typeof VALIDATION_CODES)[number];
export type Severity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  readonly severity: Severity;
  /** JSON Pointer (RFC 6901) into the document, e.g. `/pages/0/layout/children/2`. */
  readonly path: string;
  readonly code: ValidationCode;
  /** i18n key in `@verbis/i18n` (`script.validation.*`). */
  readonly messageKey: string;
  /** Interpolation parameters for the message. Never contains variable values. */
  readonly params?: Readonly<Record<string, string | number>>;
}

/** `FLOW_CYCLE` → `script.validation.flowCycle`. */
export function messageKeyFor(code: ValidationCode): string {
  const camel = code.toLowerCase().replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
  return `script.validation.${camel}`;
}

export function createIssue(
  severity: Severity,
  code: ValidationCode,
  path: string,
  params?: Readonly<Record<string, string | number>>,
): ValidationIssue {
  return params === undefined
    ? { severity, path, code, messageKey: messageKeyFor(code) }
    : { severity, path, code, messageKey: messageKeyFor(code), params };
}

export function hasErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}
