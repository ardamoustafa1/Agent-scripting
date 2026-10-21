import {
  walkNodes,
  type Rule,
  type ScriptDocument,
  type VariableType,
} from '@verbis/script-schema';

export interface RuleChoice {
  readonly value: string;
  readonly label: string;
}
export interface RuleField {
  path: string;
  type: VariableType | 'unknown';
  label: string;
  /** Where the fact comes from; drives grouping and readable names in pickers. */
  group?: 'variable' | 'interaction' | 'dataSource';
  /** Known values (enum variables, or options of the choice field that writes the variable). */
  choices?: readonly RuleChoice[];
}
export const INTERACTION_FACTS = ['channel', 'ani', 'dnis', 'direction', 'interactionId'] as const;

/** Options of choice components keyed by the variable their value is stored in. */
function boundChoices(document: ScriptDocument): Map<string, RuleChoice[]> {
  const messages = document.i18n.messages[document.i18n.defaultLocale] ?? {};
  const choices = new Map<string, RuleChoice[]>();
  walkNodes(document, ({ node }) => {
    const options = node.props['options'];
    const binding = node.bindings.find((b) => b.prop === 'value' && 'variable' in b);
    if (!binding || !('variable' in binding) || !Array.isArray(options)) return true;
    const rows = options.flatMap((option) => {
      if (option === null || typeof option !== 'object' || Array.isArray(option)) return [];
      const value = option['value'],
        labelKey = option['labelKey'];
      if (typeof value !== 'string') return [];
      const label = typeof labelKey === 'string' ? messages[labelKey] : undefined;
      return [{ value, label: label?.trim() ? label : value }];
    });
    if (rows.length && !choices.has(binding.variable)) choices.set(binding.variable, rows);
    return true;
  });
  return choices;
}

export function ruleFields(document: ScriptDocument): RuleField[] {
  const bound = boundChoices(document);
  return [
    ...document.variables.map((v) => {
      const choices =
        v.type === 'enum'
          ? (v.enumValues ?? []).map((value) => ({
              value,
              label: bound.get(v.key)?.find((c) => c.value === value)?.label ?? value,
            }))
          : bound.get(v.key);
      return {
        path: `vars.${v.key}`,
        type: v.type,
        label: v.key,
        group: 'variable' as const,
        ...(choices?.length ? { choices } : {}),
      };
    }),
    ...INTERACTION_FACTS.map((key) => ({
      path: `interaction.${key}`,
      type: 'string' as const,
      label: `interaction.${key}`,
      group: 'interaction' as const,
    })),
    ...document.variables.flatMap((v) =>
      v.source
        ? [{ path: v.source, type: v.type, label: v.source, group: 'interaction' as const }]
        : [],
    ),
    ...document.dataSources.flatMap((ds) =>
      Object.entries(ds.outputs).map(([key, output]) => ({
        path: `ds.${ds.id}.${key}`,
        type:
          document.variables.find((v) => v.key === output.variable)?.type ?? ('unknown' as const),
        label: `${ds.id}.${key}`,
        group: 'dataSource' as const,
      })),
    ),
  ].filter((v, i, all) => all.findIndex((f) => f.path === v.path) === i);
}
export function operators(type: RuleField['type']): readonly string[] {
  switch (type) {
    case 'number':
      return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'exists'];
    case 'date':
      return ['eq', 'neq', 'before', 'after', 'dateRange', 'exists'];
    case 'boolean':
      return ['eq', 'neq', 'exists'];
    case 'array':
      return ['contains', 'exists'];
    case 'object':
      return ['exists'];
    default:
      return ['eq', 'neq', 'contains', 'startsWith', 'in', 'notIn', 'exists', 'empty'];
  }
}

const AUTO_RULE = /^rule-(.+)-(visible|enabled|required)-when$/;
/**
 * The name authors see for a rule: its description, or for rules the inspector created from a
 * component condition, "<component> · <kind>"; never the generated id alone.
 */
export function ruleDisplayName(
  rule: Pick<Rule, 'id' | 'description'>,
  document: ScriptDocument,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (rule.description?.trim()) return rule.description;
  const auto = AUTO_RULE.exec(rule.id);
  if (auto?.[1] && auto[2]) {
    const messages = document.i18n.messages[document.i18n.defaultLocale] ?? {};
    let name: string | undefined;
    walkNodes(document, ({ node }) => {
      if (node.id !== auto[1]) return true;
      const key = ['labelKey', 'textKey', 'titleKey']
        .map((prop) => node.props[prop])
        .find((value): value is string => typeof value === 'string' && !!messages[value]);
      name = key ? messages[key] : t(`designer.editor.componentNames.${node.type}`);
      return false;
    });
    return t(`designer.rules.autoNames.${auto[2]}`, {
      component: name ?? t('designer.rules.removedComponent'),
    });
  }
  const index = document.rules.findIndex((r) => r.id === rule.id);
  return t('designer.rules.unnamed', { number: index + 1 });
}
