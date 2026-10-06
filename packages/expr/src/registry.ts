import {
  addDays,
  age,
  dateMillis,
  diff,
  formatCurrency,
  formatDate,
  isBusinessDay,
  isoDate,
} from './dates.js';
import { array, display, numeric, text, truth, type Budget } from './runtime.js';
import { ExpressionError, assertKey, type Value, type ValueType } from './types.js';
import { isEmail, isIBAN, isPhoneTR, isTCKN, isVKN, luhn, regexTest } from './validators.js';

export interface FunctionContext {
  readonly budget: Budget;
  readonly now: number;
  readonly locale: 'tr' | 'en';
  lambda(index: number, value: Value, position: number): Value;
}
export interface FunctionDefinition {
  readonly name: string;
  readonly parameters: readonly ValueType[];
  readonly returns: ValueType;
  readonly minArgs: number;
  readonly maxArgs: number;
  readonly lambdaAt?: readonly number[];
  readonly implementation: (args: readonly Value[], context: FunctionContext) => Value;
}
/** Extensions are trusted application code only; expression data cannot register callbacks. */
export class FunctionRegistry {
  private readonly functions = new Map<string, FunctionDefinition>();
  register(definition: FunctionDefinition): this {
    assertKey(definition.name);
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(definition.name) ||
      this.functions.has(definition.name) ||
      definition.minArgs < 0 ||
      definition.maxArgs < definition.minArgs
    )
      throw new ExpressionError('FUNCTION_REGISTRATION_INVALID');
    this.functions.set(
      definition.name,
      Object.freeze({
        ...definition,
        parameters: Object.freeze([...definition.parameters]),
        ...(definition.lambdaAt ? { lambdaAt: Object.freeze([...definition.lambdaAt]) } : {}),
      }),
    );
    return this;
  }
  get(name: string): FunctionDefinition {
    const fn = this.functions.get(name);
    if (!fn) throw new ExpressionError('UNKNOWN_FUNCTION');
    return fn;
  }
  list(): readonly FunctionDefinition[] {
    return [...this.functions.values()];
  }
}
export function createDefaultRegistry(): FunctionRegistry {
  const registry = new FunctionRegistry();
  const add = (
    name: string,
    parameters: readonly ValueType[],
    returns: ValueType,
    implementation: FunctionDefinition['implementation'],
    minArgs = parameters.length,
    maxArgs = parameters.length,
    lambdaAt?: readonly number[],
  ) =>
    registry.register({
      name,
      parameters,
      returns,
      implementation,
      minArgs,
      maxArgs,
      ...(lambdaAt ? { lambdaAt } : {}),
    });
  const arg = (args: readonly Value[], i: number): Value => args[i] ?? null;
  add('upper', ['string'], 'string', (args) => text(arg(args, 0)).toUpperCase());
  add('lower', ['string'], 'string', (args) => text(arg(args, 0)).toLowerCase());
  add('trim', ['string'], 'string', (args) => text(arg(args, 0)).trim());
  add('contains', ['unknown', 'unknown'], 'boolean', (args) => {
    const value = arg(args, 0);
    return typeof value === 'string'
      ? value.includes(text(arg(args, 1)))
      : array(value).some((item) => item === arg(args, 1));
  });
  add('startsWith', ['string', 'string'], 'boolean', (args) =>
    text(arg(args, 0)).startsWith(text(arg(args, 1))),
  );
  add(
    'format',
    ['string'],
    'string',
    (args) =>
      text(arg(args, 0)).replace(/\{(\d+)\}/g, (_match, index: string) =>
        display(args[Number(index) + 1] ?? null),
      ),
    1,
    32,
  );
  add(
    'mask',
    ['string', 'number', 'string'],
    'string',
    (args) => {
      const value = text(arg(args, 0));
      const visible = args[1] === undefined ? 4 : numeric(arg(args, 1));
      const symbol = args[2] === undefined ? '*' : text(arg(args, 2));
      if (!Number.isInteger(visible) || visible < 0 || symbol.length !== 1)
        throw new ExpressionError('ARGUMENT_INVALID');
      return (
        symbol.repeat(Math.max(0, value.length - visible)) +
        value.slice(Math.max(0, value.length - visible))
      );
    },
    1,
    3,
  );
  add(
    'padStart',
    ['string', 'number', 'string'],
    'string',
    (args, ctx) => {
      const length = numeric(arg(args, 1));
      if (!Number.isInteger(length) || length < 0 || length > ctx.budget.limits.maxStringLength)
        throw new ExpressionError('STRING_LIMIT');
      return text(arg(args, 0)).padStart(length, args[2] === undefined ? ' ' : text(arg(args, 2)));
    },
    2,
    3,
  );
  add(
    'round',
    ['number', 'number'],
    'number',
    (args) => {
      const digits = args[1] === undefined ? 0 : numeric(arg(args, 1));
      if (!Number.isInteger(digits) || Math.abs(digits) > 10)
        throw new ExpressionError('ARGUMENT_INVALID');
      const scale = 10 ** digits;
      return Math.round(numeric(arg(args, 0)) * scale) / scale;
    },
    1,
    2,
  );
  add(
    'formatCurrency',
    ['number', 'string', 'string'],
    'string',
    (args, ctx) => {
      const locale = args[1] === undefined ? ctx.locale : text(arg(args, 1));
      if (locale !== 'tr' && locale !== 'en') throw new ExpressionError('LOCALE_INVALID');
      return formatCurrency(
        numeric(arg(args, 0)),
        locale,
        args[2] === undefined ? 'TRY' : text(arg(args, 2)),
      );
    },
    1,
    3,
  );
  add('now', [], 'string', (_args, ctx) => isoDate(ctx.now));
  add('addDays', ['string', 'number'], 'string', (args) =>
    addDays(text(arg(args, 0)), numeric(arg(args, 1))),
  );
  add(
    'diff',
    ['string', 'string', 'string'],
    'number',
    (args) =>
      diff(
        text(arg(args, 0)),
        text(arg(args, 1)),
        args[2] === undefined ? 'days' : text(arg(args, 2)),
      ),
    2,
    3,
  );
  add(
    'formatDate',
    ['string', 'string'],
    'string',
    (args) =>
      formatDate(text(arg(args, 0)), args[1] === undefined ? 'yyyy-MM-dd' : text(arg(args, 1))),
    1,
    2,
  );
  add(
    'isBusinessDay',
    ['string', 'array'],
    'boolean',
    (args) =>
      isBusinessDay(text(arg(args, 0)), args[1] === undefined ? [] : array(arg(args, 1)).map(text)),
    1,
    2,
  );
  add(
    'age',
    ['string', 'string'],
    'number',
    (args, ctx) =>
      age(text(arg(args, 0)), args[1] === undefined ? ctx.now : dateMillis(text(arg(args, 1)))),
    1,
    2,
  );
  add('count', ['array'], 'number', (args) => array(arg(args, 0)).length);
  add(
    'sum',
    ['array', 'unknown'],
    'number',
    (args, ctx) =>
      array(arg(args, 0)).reduce<number>((sum, item, i) => {
        ctx.budget.tick();
        return sum + numeric(args[1] === undefined ? item : ctx.lambda(1, item, i));
      }, 0),
    1,
    2,
    [1],
  );
  for (const name of ['filter', 'map', 'find', 'any', 'all'])
    add(
      name,
      ['array', 'unknown'],
      name === 'any' || name === 'all' ? 'boolean' : name === 'find' ? 'unknown' : 'array',
      (args, ctx) => {
        const values = array(arg(args, 0));
        const mapped: Value[] = [];
        for (let i = 0; i < values.length; i++) {
          ctx.budget.tick();
          const item = values[i] ?? null;
          const result = ctx.lambda(1, item, i);
          if (name === 'map') mapped.push(result);
          else if (name === 'filter' && truth(result)) mapped.push(item);
          else if (name === 'find' && truth(result)) return item;
          else if (name === 'any' && truth(result)) return true;
          else if (name === 'all' && !truth(result)) return false;
        }
        return name === 'find' ? null : name === 'any' ? false : name === 'all' ? true : mapped;
      },
      2,
      2,
      [1],
    );
  for (const [name, fn] of Object.entries({ isEmail, isPhoneTR, isTCKN, isIBAN, isVKN, luhn }))
    add(name, ['string'], 'boolean', (args) => fn(text(arg(args, 0))));
  add(
    'regexTest',
    ['string', 'string', 'string'],
    'boolean',
    (args, ctx) => {
      const value = text(arg(args, 0));
      ctx.budget.tick(value.length);
      return regexTest(value, text(arg(args, 1)), args[2] === undefined ? '' : text(arg(args, 2)));
    },
    2,
    3,
  );
  add('if', ['unknown', 'unknown', 'unknown'], 'unknown', (args) =>
    truth(arg(args, 0)) ? arg(args, 1) : arg(args, 2),
  );
  add('switch', ['unknown'], 'unknown', () => null, 4, 32);
  add('exists', ['unknown'], 'boolean', (args) => arg(args, 0) !== null);
  add('between', ['unknown', 'array'], 'boolean', (args) => {
    const value = numeric(arg(args, 0));
    const bounds = array(arg(args, 1));
    if (bounds.length !== 2) throw new ExpressionError('ARGUMENT_INVALID');
    return value >= numeric(bounds[0] ?? null) && value <= numeric(bounds[1] ?? null);
  });
  add(
    'before',
    ['string', 'string'],
    'boolean',
    (args) => diff(text(arg(args, 0)), text(arg(args, 1)), 'milliseconds') < 0,
  );
  add(
    'after',
    ['string', 'string'],
    'boolean',
    (args) => diff(text(arg(args, 0)), text(arg(args, 1)), 'milliseconds') > 0,
  );
  add('toNumber', ['unknown'], 'number', (args) => {
    const value = arg(args, 0);
    if (
      (typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' &&
        !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))
    )
      throw new ExpressionError('NUMBER_INVALID');
    const result = Number(value);
    if (!Number.isFinite(result)) throw new ExpressionError('NUMBER_INVALID');
    return result;
  });
  add('toString', ['unknown'], 'string', (args) => display(arg(args, 0)));
  add('parseJSON', ['string'], 'unknown', (args, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text(arg(args, 0))) as unknown;
    } catch {
      throw new ExpressionError('JSON_INVALID');
    }
    return ctx.budget.snapshot(parsed);
  });
  return registry;
}
