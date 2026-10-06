import type { ScriptDocument, VariableType } from '@verbis/script-schema';

export interface RuleField {
  path: string;
  type: VariableType | 'unknown';
  label: string;
}
export function ruleFields(document: ScriptDocument): RuleField[] {
  return [
    ...document.variables.map((v) => ({ path: `vars.${v.key}`, type: v.type, label: v.key })),
    ...['channel', 'ani', 'dnis', 'direction', 'interactionId'].map((key) => ({
      path: `interaction.${key}`,
      type: 'string' as const,
      label: `interaction.${key}`,
    })),
    ...document.variables.flatMap((v) =>
      v.source ? [{ path: v.source, type: v.type, label: v.source }] : [],
    ),
    ...document.dataSources.flatMap((ds) =>
      Object.entries(ds.outputs).map(([key, output]) => ({
        path: `ds.${ds.id}.${key}`,
        type:
          document.variables.find((v) => v.key === output.variable)?.type ?? ('unknown' as const),
        label: `${ds.id}.${key}`,
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
