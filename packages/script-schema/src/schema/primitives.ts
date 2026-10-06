import { z } from 'zod';

import { NodeIdSchema } from '../ids.js';

/** Mirrors `DEFAULT_EXPRESSION_LIMITS.maxSourceLength` in `@verbis/expr` (ADR-0007). */
export const MAX_EXPRESSION_LENGTH = 2_000;

/** Arbitrary JSON (no functions, no undefined). */
export const JsonValueSchema = z.json().meta({ id: 'JsonValue' });
export type JsonValue = z.infer<typeof JsonValueSchema>;

/** Source text of a sandboxed expression (ADR-0007). Never evaluated by this package. */
export const ExpressionSchema = z.string().trim().min(1).max(MAX_EXPRESSION_LENGTH);

export const ExpressionRefSchema = z.strictObject({ $expr: ExpressionSchema }).meta({
  id: 'ExpressionRef',
  description: 'A value computed by the safe expression engine.',
});
export type ExpressionRef = z.infer<typeof ExpressionRefSchema>;

/** A literal JSON value or an expression. */
export const ValueSchema = z.union([ExpressionRefSchema, JsonValueSchema]).meta({ id: 'Value' });
export type Value = z.infer<typeof ValueSchema>;

export const RuleRefSchema = z.strictObject({ $rule: NodeIdSchema }).meta({ id: 'RuleRef' });

/** Boolean condition: an expression or a reference to a named rule. */
export const ConditionSchema = z
  .union([ExpressionRefSchema, RuleRefSchema])
  .meta({ id: 'Condition' });
export type Condition = z.infer<typeof ConditionSchema>;

/** Translation key, e.g. `offer.title`. Display text is never stored inline (CLAUDE.md rule 5). */
export const I18nKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)*$/,
    'Expected a dotted i18n key (e.g. "offer.title")',
  );
export type I18nKey = z.infer<typeof I18nKeySchema>;

/** BCP 47 subset: `tr`, `en`, `en-GB`. */
export const LocaleSchema = z
  .string()
  .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Expected a locale like "tr" or "en-GB"');
export type Locale = z.infer<typeof LocaleSchema>;

/** Design-token scales (CLAUDE.md §9: no ad-hoc colors or sizes). */
export const SpaceTokenSchema = z.enum(['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl']);
export const ToneTokenSchema = z.enum([
  'neutral',
  'primary',
  'success',
  'warning',
  'danger',
  'info',
]);
export type ToneToken = z.infer<typeof ToneTokenSchema>;
