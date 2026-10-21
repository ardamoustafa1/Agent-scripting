import { expressionToRule } from '@verbis/expr';
import { PredicateSchema, type JsonValue, type Predicate } from '@verbis/script-schema';

import { factLabel } from './builder.js';

import type { RuleField } from './fields.js';

type Translate = (key: string, options?: Record<string, unknown>) => string;
const SYMBOLS: Record<string, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
};
const MAX_LENGTH = 80;

function valueText(
  value: JsonValue | undefined,
  field: RuleField | undefined,
  t: Translate,
): string {
  if (value === true) return t('designer.value.yes');
  if (value === false) return t('designer.value.no');
  if (value === null || value === undefined || value === '')
    return t('designer.rules.describe.blank');
  if (Array.isArray(value)) return value.map((item) => valueText(item, field, t)).join(', ');
  if (typeof value === 'object') return '…';
  const text = String(value);
  return field?.choices?.find((choice) => choice.value === text)?.label ?? text;
}

/**
 * A condition as a short sentence for canvas labels and summaries: "Complaint = Damaged parcel
 * and Amount > 500". Expressions the visual builder cannot represent read as "custom formula".
 */
export function describePredicate(
  predicate: Predicate,
  fields: readonly RuleField[],
  t: Translate,
  depth = 0,
): string {
  if ('$expr' in predicate) {
    const source = predicate.$expr.trim();
    if (source === 'true') return t('designer.rules.always');
    if (source === 'false') return t('designer.rules.never');
    if (depth === 0)
      try {
        const parsed = PredicateSchema.parse(expressionToRule(source));
        if (!('$expr' in parsed)) return describePredicate(parsed, fields, t, depth + 1);
      } catch {
        // Falls through to the generic label below.
      }
    return t('designer.rules.describe.formula');
  }
  if ('not' in predicate)
    return t('designer.rules.describe.not', {
      condition: describePredicate(predicate.not, fields, t, depth + 1),
    });
  if ('all' in predicate || 'any' in predicate) {
    const items = 'all' in predicate ? predicate.all : predicate.any;
    const joined = items
      .map((item) => {
        const text = describePredicate(item, fields, t, depth + 1);
        return 'all' in item || 'any' in item ? `(${text})` : text;
      })
      .join(` ${t(`designer.rules.describe.${'all' in predicate ? 'and' : 'or'}`)} `);
    return items.length === 1 && depth === 0 ? joined.replace(/^\((.*)\)$/, '$1') : joined;
  }
  const field = fields.find((f) => f.path === predicate.fact);
  const name = field
    ? factLabel(field, t)
    : predicate.fact.startsWith('vars.')
      ? predicate.fact.slice(5)
      : predicate.fact;
  if (predicate.op === 'exists') return t('designer.rules.describe.exists', { field: name });
  const symbol = SYMBOLS[predicate.op];
  const value =
    predicate.op === 'between' && Array.isArray(predicate.value)
      ? predicate.value.map((item) => valueText(item, field, t)).join(' – ')
      : valueText(predicate.value, field, t);
  return symbol
    ? `${name} ${symbol} ${value}`
    : t(`designer.rules.describe.ops.${predicate.op}`, { field: name, value });
}

/** Same as {@link describePredicate}, shortened for edge labels on the flow canvas. */
export function shortCondition(
  predicate: Predicate,
  fields: readonly RuleField[],
  t: Translate,
): string {
  const text = describePredicate(predicate, fields, t);
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text;
}
