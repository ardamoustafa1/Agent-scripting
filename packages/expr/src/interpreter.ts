import { parseExpression } from './parser.js';
import { createDefaultRegistry, type FunctionRegistry } from './registry.js';
import {
  array,
  Budget,
  display,
  equal,
  numeric,
  truth,
  type EvaluationOptions,
} from './runtime.js';
import { assertKey, ExpressionError, type Ast, type Value } from './types.js';

const defaultRegistry = createDefaultRegistry();
export interface EngineOptions extends EvaluationOptions {
  registry?: FunctionRegistry;
}
export function evaluateExpression(
  source: string,
  context: unknown = {},
  options: EngineOptions = {},
): Value {
  const budget = new Budget(options);
  const ast = parseExpression(source, budget.limits);
  return interpret(ast, context, options, budget);
}
function interpret(ast: Ast, context: unknown, options: EngineOptions, budget: Budget): Value {
  const facts = budget.snapshot(context);
  const registry = options.registry ?? defaultRegistry;
  const now = options.now?.() ?? 0;
  if (!Number.isFinite(now)) throw new ExpressionError('DATE_INVALID');
  const walk = (node: Ast, locals: ReadonlyMap<string, Value>, depth: number): Value => {
    budget.tick();
    if (depth > budget.limits.maxAstDepth) throw new ExpressionError('DEPTH_LIMIT', node.position);
    const read = (child: Ast) => walk(child, locals, depth + 1);
    const checked = (value: Value) => budget.output(value);
    switch (node.kind) {
      case 'literal':
        return node.value;
      case 'identifier': {
        if (locals.has(node.name)) return locals.get(node.name) ?? null;
        if (facts && typeof facts === 'object' && Object.hasOwn(facts, node.name))
          return (facts as Record<string, Value>)[node.name] ?? null;
        throw new ExpressionError('UNKNOWN_IDENTIFIER', node.position);
      }
      case 'array':
        return checked(node.items.map(read));
      case 'object':
        return checked(
          Object.fromEntries(node.entries.map((entry) => [entry.key, read(entry.value)])),
        );
      case 'lambda':
        throw new ExpressionError('LAMBDA_NOT_ALLOWED', node.position);
      case 'member': {
        const object = read(node.object);
        if (object === null) {
          if (node.optional) return null;
          throw new ExpressionError('NULL_ACCESS', node.position);
        }
        const key = read(node.property);
        if (typeof key !== 'string' && typeof key !== 'number')
          throw new ExpressionError('PROPERTY_INVALID', node.position);
        const name = String(key);
        assertKey(name);
        if ((Array.isArray(object) || typeof object === 'string') && name === 'length')
          return object.length;
        if (Array.isArray(object))
          return /^(0|[1-9]\d*)$/.test(name) ? (object[Number(name)] ?? null) : null;
        if (typeof object === 'string')
          return /^(0|[1-9]\d*)$/.test(name) ? (object[Number(name)] ?? null) : null;
        if (typeof object !== 'object') throw new ExpressionError('TYPE_OBJECT', node.position);
        return Object.hasOwn(object, name) ? (object[name] ?? null) : null;
      }
      case 'unary': {
        const operand = read(node.operand);
        return node.operator === '!'
          ? !truth(operand)
          : node.operator === '-'
            ? checked(-numeric(operand))
            : numeric(operand);
      }
      case 'conditional':
        return read(truth(read(node.condition)) ? node.yes : node.no);
      case 'binary': {
        const left = read(node.left);
        if (node.operator === '&&') return truth(left) ? read(node.right) : left;
        if (node.operator === '||') return truth(left) ? left : read(node.right);
        if (node.operator === '??') return left ?? read(node.right);
        const right = read(node.right);
        switch (node.operator) {
          case '==':
          case '===':
            return equal(left, right, () => {
              budget.tick();
            });
          case '!=':
          case '!==':
            return !equal(left, right, () => {
              budget.tick();
            });
          case 'in':
            return array(right).some((item) => {
              budget.tick();
              return equal(left, item, () => {
                budget.tick();
              });
            });
          case '+':
            return checked(
              typeof left === 'string' && typeof right === 'string'
                ? left + right
                : numeric(left) + numeric(right),
            );
          case '-':
            return checked(numeric(left) - numeric(right));
          case '*':
            return checked(numeric(left) * numeric(right));
          case '/':
          case '%':
            if (numeric(right) === 0) throw new ExpressionError('DIVISION_BY_ZERO', node.position);
            return checked(
              node.operator === '/'
                ? numeric(left) / numeric(right)
                : numeric(left) % numeric(right),
            );
          case '**':
            return checked(numeric(left) ** numeric(right));
          case '<':
          case '>':
          case '<=':
          case '>=': {
            if (!(
              (typeof left === 'number' && typeof right === 'number') ||
              (typeof left === 'string' && typeof right === 'string')
            ))
              throw new ExpressionError('TYPE_COMPARISON', node.position);
            return node.operator === '<'
              ? left < right
              : node.operator === '>'
                ? left > right
                : node.operator === '<='
                  ? left <= right
                  : left >= right;
          }
          default:
            throw new ExpressionError('OPERATOR_INVALID', node.position);
        }
      }
      case 'call': {
        const fn = registry.get(node.name);
        if (node.args.length < fn.minArgs || node.args.length > fn.maxArgs)
          throw new ExpressionError('ARGUMENT_COUNT', node.position);
        if (node.name === 'if')
          return read(
            truth(read(node.args[0] ?? node)) ? (node.args[1] ?? node) : (node.args[2] ?? node),
          );
        if (node.name === 'switch') {
          if (node.args.length % 2 !== 0)
            throw new ExpressionError('ARGUMENT_COUNT', node.position);
          const value = read(node.args[0] ?? node);
          for (let i = 1; i < node.args.length - 1; i += 2) {
            if (
              equal(value, read(node.args[i] ?? node), () => {
                budget.tick();
              })
            )
              return read(node.args[i + 1] ?? node);
          }
          return read(node.args.at(-1) ?? node);
        }
        const args = node.args.map((arg, index) => {
          if (arg.kind !== 'lambda') return read(arg);
          if (!fn.lambdaAt?.includes(index))
            throw new ExpressionError('LAMBDA_NOT_ALLOWED', arg.position);
          return null;
        });
        return checked(
          fn.implementation(args, {
            budget,
            now,
            locale: options.locale ?? 'tr',
            lambda: (index, item, _position) => {
              const lambda = node.args[index];
              if (lambda?.kind !== 'lambda' || !fn.lambdaAt?.includes(index))
                throw new ExpressionError('LAMBDA_REQUIRED', node.position);
              const scoped = new Map(locals);
              scoped.set(lambda.parameter, item);
              return walk(lambda.body, scoped, depth + 1);
            },
          }),
        );
      }
    }
  };
  return budget.output(walk(ast, new Map(), 1));
}
export function compileExpression(source: string, options: EngineOptions = {}) {
  const ast = parseExpression(source, options.limits);
  return Object.freeze({
    source,
    evaluate: (context: unknown = {}, overrides: EvaluationOptions = {}) => {
      const settings = { ...options, ...overrides };
      const budget = new Budget(settings);
      if (source.length > budget.limits.maxSourceLength) throw new ExpressionError('SOURCE_LIMIT');
      return interpret(ast, context, settings, budget);
    },
  });
}
export function tryEvaluate(
  source: string,
  context: unknown = {},
  options: EngineOptions = {},
): { ok: true; value: Value } | { ok: false; error: { code: string; position: number } } {
  try {
    return { ok: true, value: evaluateExpression(source, context, options) };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof ExpressionError
          ? { code: error.code, position: error.position }
          : { code: 'EVALUATION_FAILED', position: 0 },
    };
  }
}
export const evaluate = evaluateExpression;
export { display };

/** Internal composition hook: templates share the entire operation's budget. */
export function evaluateWithBudget(
  source: string,
  context: unknown,
  options: EngineOptions,
  budget: Budget,
): Value {
  const ast = parseExpression(source, budget.limits);
  return interpret(ast, context, options, budget);
}
