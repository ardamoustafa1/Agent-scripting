import type { Predicate, PredicateLeaf } from '@verbis/script-schema';

/**
 * Safe evaluator for the no-code predicate tree (SCRIPT_MODEL §6) used by assignment conditions.
 * Pure data walking: no eval, no dynamic code (CLAUDE.md §1.10). `{$expr}` nodes need the
 * expression engine (roadmap step 13) and evaluate to "unsupported" → the rule fails closed.
 * `matches` uses a bounded, anchored-free RegExp built from tenant data, with a length cap and a
 * catastrophic-pattern guard.
 */
export type Facts = Readonly<Record<string, unknown>>;

export interface PredicateResult {
  readonly value: boolean;
  /** Paths of facts that were read (decision trace). */
  readonly facts: readonly string[];
  readonly unsupported: boolean;
}

const MAX_DEPTH = 32;
const MAX_REGEX = 200;
// Nested quantifiers like (a+)+ or (a*)* are the classic ReDoS shapes.
const DANGEROUS_REGEX = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/;

export function readFact(facts: Facts, path: string): unknown {
  let current: unknown = facts;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const time = (v: unknown): number | undefined => {
  if (!isString(v) && !isNumber(v)) return undefined;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? undefined : t;
};
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function leaf(node: PredicateLeaf, facts: Facts): boolean {
  const actual = readFact(facts, node.fact);
  const expected = node.value;
  switch (node.op) {
    case 'exists':
      return expected === false
        ? actual === undefined || actual === null
        : actual !== undefined && actual !== null;
    case 'eq':
      return equal(actual, expected);
    case 'neq':
      return !equal(actual, expected);
    case 'gt':
      return isNumber(actual) && isNumber(expected) && actual > expected;
    case 'gte':
      return isNumber(actual) && isNumber(expected) && actual >= expected;
    case 'lt':
      return isNumber(actual) && isNumber(expected) && actual < expected;
    case 'lte':
      return isNumber(actual) && isNumber(expected) && actual <= expected;
    case 'in':
      return Array.isArray(expected) && expected.some((e) => equal(e, actual));
    case 'notIn':
      return Array.isArray(expected) && !expected.some((e) => equal(e, actual));
    case 'contains':
      if (Array.isArray(actual)) return actual.some((a) => equal(a, expected));
      return isString(actual) && isString(expected) && actual.includes(expected);
    case 'startsWith':
      return isString(actual) && isString(expected) && actual.startsWith(expected);
    case 'matches': {
      if (
        !isString(actual) ||
        !isString(expected) ||
        expected.length > MAX_REGEX ||
        DANGEROUS_REGEX.test(expected)
      )
        return false;
      try {
        return new RegExp(expected, 'u').test(actual.slice(0, 1000));
      } catch {
        return false;
      }
    }
    case 'between': {
      if (!Array.isArray(expected) || expected.length !== 2) return false;
      const [lo, hi] = expected;
      if (isNumber(actual) && isNumber(lo) && isNumber(hi)) return actual >= lo && actual <= hi;
      const t = time(actual);
      const l = time(lo);
      const h = time(hi);
      return t !== undefined && l !== undefined && h !== undefined && t >= l && t <= h;
    }
    case 'before': {
      const a = time(actual);
      const e = time(expected);
      return a !== undefined && e !== undefined && a < e;
    }
    case 'after': {
      const a = time(actual);
      const e = time(expected);
      return a !== undefined && e !== undefined && a > e;
    }
  }
}

export function evaluatePredicate(predicate: Predicate, facts: Facts): PredicateResult {
  const read = new Set<string>();
  let unsupported = false;
  // Read through a function: the flag is set inside the recursive walk.
  const isUnsupported = (): boolean => unsupported;
  const walk = (node: Predicate, depth: number): boolean => {
    if (depth > MAX_DEPTH) {
      unsupported = true;
      return false;
    }
    if ('all' in node) return node.all.every((child) => walk(child, depth + 1));
    if ('any' in node) return node.any.some((child) => walk(child, depth + 1));
    if ('not' in node) {
      const inner = walk(node.not, depth + 1);
      // An unsupported subtree must not flip into "true" through negation.
      return isUnsupported() ? false : !inner;
    }
    if ('fact' in node) {
      read.add(node.fact);
      return leaf(node, facts);
    }
    unsupported = true;
    return false;
  };
  const value = walk(predicate, 0);
  const failed = isUnsupported();
  return { value: failed ? false : value, facts: [...read].sort(), unsupported: failed };
}
