import { resolveLimits, type ExpressionLimits } from './limits.js';
import { assertKey, ExpressionError, type Value } from './types.js';

export interface EvaluationOptions {
  limits?: Partial<ExpressionLimits>;
  now?: () => number;
  budgetClock?: () => number;
  locale?: 'tr' | 'en';
}
export class Budget {
  readonly limits: ExpressionLimits;
  private steps = 0;
  private readonly start: number;
  private readonly clock: () => number;
  constructor(options: EvaluationOptions = {}) {
    this.limits = resolveLimits(options.limits);
    this.clock = options.budgetClock ?? (() => Date.now());
    this.start = this.clock();
  }
  tick(cost = 1): void {
    this.steps += cost;
    if (this.steps > this.limits.maxSteps) throw new ExpressionError('STEP_LIMIT');
    if (this.clock() - this.start > this.limits.timeoutMs) throw new ExpressionError('TIMEOUT');
  }
  snapshot(input: unknown, depth = 0): Value {
    this.tick();
    if (depth > this.limits.maxAstDepth) throw new ExpressionError('DEPTH_LIMIT');
    if (input === null || input === undefined) return null;
    if (typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new ExpressionError('NUMBER_INVALID');
      return input;
    }
    if (typeof input === 'string') {
      if (input.length > this.limits.maxStringLength) throw new ExpressionError('STRING_LIMIT');
      return input;
    }
    if (typeof input !== 'object') throw new ExpressionError('CONTEXT_INVALID');
    const prototype: unknown = Object.getPrototypeOf(input);
    if (Array.isArray(input)) {
      if (input.length > this.limits.maxCollectionLength)
        throw new ExpressionError('COLLECTION_LIMIT');
      const descriptors = Object.getOwnPropertyDescriptors(input);
      const result: Value[] = [];
      for (let i = 0; i < input.length; i++) {
        const item = descriptors[String(i)];
        if (!item || !('value' in item)) throw new ExpressionError('CONTEXT_INVALID');
        result.push(this.snapshot(item.value as unknown, depth + 1));
      }
      return Object.freeze(result) as Value[];
    }
    if (prototype !== null && prototype !== Object.prototype)
      throw new ExpressionError('CONTEXT_INVALID');
    const entries = Object.entries(Object.getOwnPropertyDescriptors(input));
    if (entries.length > this.limits.maxCollectionLength)
      throw new ExpressionError('COLLECTION_LIMIT');
    const result: Record<string, Value> = Object.create(null) as Record<string, Value>;
    for (const [key, descriptor] of entries) {
      if (key.length > this.limits.maxStringLength) throw new ExpressionError('STRING_LIMIT');
      assertKey(key);
      if (!('value' in descriptor)) throw new ExpressionError('CONTEXT_INVALID');
      result[key] = this.snapshot(descriptor.value as unknown, depth + 1);
    }
    return Object.freeze(result);
  }
  output(value: Value): Value {
    const checked = this.snapshot(value);
    // UTF-8 size without depending on Node Buffer or browser APIs.
    let bytes = 0;
    const text = JSON.stringify(checked);
    for (const char of text) {
      const cp = char.codePointAt(0) ?? 0;
      bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    }
    if (bytes > this.limits.maxOutputBytes) throw new ExpressionError('OUTPUT_LIMIT');
    return checked;
  }
}
export const numeric = (value: Value): number => {
  if (typeof value !== 'number') throw new ExpressionError('TYPE_NUMBER');
  return value;
};
export const text = (value: Value): string => {
  if (typeof value !== 'string') throw new ExpressionError('TYPE_STRING');
  return value;
};
export const array = (value: Value): Value[] => {
  if (!Array.isArray(value)) throw new ExpressionError('TYPE_ARRAY');
  return value;
};
export function display(value: Value): string {
  return value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
}
export const truth = (value: Value) =>
  value !== null && value !== false && value !== 0 && value !== '';
export const equal = (left: Value, right: Value, tick: () => void = () => undefined): boolean => {
  tick();
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
    return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every(
    (key) =>
      Object.hasOwn(right, key) &&
      equal(
        (left as Record<string, Value>)[key] ?? null,
        (right as Record<string, Value>)[key] ?? null,
        tick,
      ),
  );
};
