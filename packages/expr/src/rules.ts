import { z } from 'zod';

import { accessPath } from './analysis.js';
import { evaluateExpression, type EngineOptions } from './interpreter.js';
import { parseExpression } from './parser.js';
import { Budget, truth } from './runtime.js';
import { assertKey, type Ast, type Value } from './types.js';

export const RULE_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'notIn',
  'contains',
  'startsWith',
  'matches',
  'exists',
  'between',
  'before',
  'after',
] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];
export type Rule =
  | { all: Rule[] }
  | { any: Rule[] }
  | { not: Rule }
  | { fact: string; op: RuleOperator; value?: Value | undefined }
  | { $expr: string }
  | { operator: 'AND' | 'OR'; conditions: Rule[] };
const factSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)*$/)
  .refine(
    (path) =>
      !path
        .split('.')
        .some((key) =>
          ['__proto__', 'prototype', 'constructor', 'caller', 'callee', 'arguments'].includes(key),
        ),
  );
export const RuleSchema: z.ZodType<Rule> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(RuleSchema).min(1) }),
    z.strictObject({ any: z.array(RuleSchema).min(1) }),
    z.strictObject({ not: RuleSchema }),
    z.strictObject({ fact: factSchema, op: z.enum(RULE_OPERATORS), value: z.json().optional() }),
    z.strictObject({ $expr: z.string().min(1).max(2000) }),
    z.strictObject({ operator: z.enum(['AND', 'OR']), conditions: z.array(RuleSchema).min(1) }),
  ]),
);
const symbols: Partial<Record<RuleOperator, string>> = {
  eq: '===',
  neq: '!==',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  in: 'in',
};
export function ruleToExpression(input: unknown): string {
  const budget = new Budget();
  const rule = RuleSchema.parse(budget.snapshot(input));
  const walk = (node: Rule): string => {
    budget.tick();
    if ('all' in node) return `(${node.all.map(walk).join(' && ')})`;
    if ('any' in node) return `(${node.any.map(walk).join(' || ')})`;
    if ('operator' in node)
      return `(${node.conditions.map(walk).join(node.operator === 'AND' ? ' && ' : ' || ')})`;
    if ('not' in node) return `!(${walk(node.not)})`;
    if ('$expr' in node) {
      parseExpression(node.$expr);
      return `(${node.$expr})`;
    }
    node.fact.split('.').forEach(assertKey);
    const value = JSON.stringify(node.value ?? null);
    if (symbols[node.op]) return `(${node.fact} ${symbols[node.op]} ${value})`;
    if (node.op === 'notIn') return `!(${node.fact} in ${value})`;
    if (node.op === 'matches') return `regexTest(${node.fact}, ${value})`;
    if (node.op === 'exists') return `exists(${node.fact})`;
    return `${node.op}(${node.fact}, ${value})`;
  };
  const expression = walk(rule);
  parseExpression(expression);
  return expression;
}
function literal(node: Ast): Value | undefined {
  if (node.kind === 'literal') return node.value;
  if (
    node.kind === 'unary' &&
    node.operator === '-' &&
    node.operand.kind === 'literal' &&
    typeof node.operand.value === 'number'
  )
    return -node.operand.value;
  if (node.kind === 'array') {
    const values = node.items.map(literal);
    return values.some((value) => value === undefined) ? undefined : (values as Value[]);
  }
  if (node.kind === 'object') {
    const values = node.entries.map((entry) => [entry.key, literal(entry.value)] as const);
    return values.some((entry) => entry[1] === undefined)
      ? undefined
      : (Object.fromEntries(values) as Record<string, Value>);
  }
  return undefined;
}
/** Non-builder expressions are preserved losslessly as a supported `$expr` leaf. */
export function expressionToRule(source: string): Rule {
  const ast = parseExpression(source);
  const walk = (node: Ast): Rule | undefined => {
    if (node.kind === 'binary' && (node.operator === '&&' || node.operator === '||')) {
      const left = walk(node.left);
      const right = walk(node.right);
      if (!left || !right) return undefined;
      return node.operator === '&&' ? { all: [left, right] } : { any: [left, right] };
    }
    if (node.kind === 'unary' && node.operator === '!') {
      const inner = walk(node.operand);
      return inner ? { not: inner } : undefined;
    }
    if (node.kind === 'binary') {
      const fact = accessPath(node.left);
      const value = literal(node.right);
      const op =
        Object.entries(symbols).find(([, symbol]) => symbol === node.operator)?.[0] ??
        (node.operator === '==' ? 'eq' : node.operator === '!=' ? 'neq' : undefined);
      if (fact && value !== undefined && op) return { fact, op: op as RuleOperator, value };
    }
    if (node.kind === 'call') {
      const fact = node.args[0] ? accessPath(node.args[0]) : undefined;
      const op = node.name === 'regexTest' ? 'matches' : node.name;
      if (fact && RULE_OPERATORS.includes(op as RuleOperator)) {
        if (op === 'exists' && node.args.length === 1) return { fact, op };
        const value = node.args[1] ? literal(node.args[1]) : undefined;
        if (node.args.length === 2 && value !== undefined)
          return { fact, op: op as RuleOperator, value };
      }
    }
    return undefined;
  };
  const result = walk(ast) ?? { $expr: source };
  return RuleSchema.parse(result);
}
export function evaluateRule(
  rule: unknown,
  context: unknown,
  options: EngineOptions = {},
): boolean {
  return truth(evaluateExpression(ruleToExpression(rule), context, options));
}
export const ruleToExpr = ruleToExpression;
export const exprToRule = expressionToRule;
