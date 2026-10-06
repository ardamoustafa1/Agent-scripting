import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Predicate } from '@verbis/script-schema';

import { evaluatePredicate, readFact } from './predicate.js';

const facts = {
  interaction: {
    balance: 1500,
    segment: 'gold',
    tags: ['vip', 'tr'],
    name: 'Ayşe',
    dueDate: '2026-10-10',
    nested: { a: 1 },
  },
  agent: { tier: 'senior' },
};
const leaf = (fact: string, op: string, value?: unknown): Predicate =>
  ({ fact, op, value }) as Predicate;

describe('predicate evaluator', () => {
  it.each([
    [leaf('interaction.balance', 'eq', 1500), true],
    [leaf('interaction.balance', 'neq', 1500), false],
    [leaf('interaction.balance', 'gt', 1000), true],
    [leaf('interaction.balance', 'gte', 1500), true],
    [leaf('interaction.balance', 'lt', 1500), false],
    [leaf('interaction.balance', 'lte', 1500), true],
    [leaf('interaction.balance', 'gt', '1000'), false],
    [leaf('interaction.segment', 'in', ['gold', 'platinum']), true],
    [leaf('interaction.segment', 'notIn', ['gold']), false],
    [leaf('interaction.tags', 'contains', 'vip'), true],
    [leaf('interaction.name', 'contains', 'yş'), true],
    [leaf('interaction.name', 'startsWith', 'Ay'), true],
    [leaf('interaction.name', 'matches', '^A.*e$'), true],
    [leaf('interaction.name', 'matches', '(a+)+$'), false],
    [leaf('interaction.name', 'matches', '['), false],
    [leaf('interaction.missing', 'exists'), false],
    [leaf('interaction.missing', 'exists', false), true],
    [leaf('interaction.balance', 'between', [1000, 2000]), true],
    [leaf('interaction.dueDate', 'between', ['2026-10-01', '2026-10-31']), true],
    [leaf('interaction.dueDate', 'before', '2026-11-01'), true],
    [leaf('interaction.dueDate', 'after', '2026-11-01'), false],
    [leaf('interaction.nested', 'eq', { a: 1 }), true],
    [leaf('agent.tier', 'eq', 'senior'), true],
  ] as const)('%j → %s', (predicate, expected) => {
    expect(evaluatePredicate(predicate, facts).value).toBe(expected);
  });

  it('combines all/any/not and records facts read', () => {
    const result = evaluatePredicate(
      {
        all: [
          leaf('interaction.balance', 'gt', 1),
          {
            any: [
              leaf('agent.tier', 'eq', 'junior'),
              { not: leaf('interaction.segment', 'eq', 'silver') },
            ],
          },
        ],
      },
      facts,
    );
    expect(result).toEqual({
      value: true,
      facts: ['agent.tier', 'interaction.balance', 'interaction.segment'],
      unsupported: false,
    });
  });

  it('fails closed on expressions, also under negation', () => {
    expect(evaluatePredicate({ $expr: 'x' }, facts)).toMatchObject({
      value: false,
      unsupported: true,
    });
    expect(evaluatePredicate({ not: { $expr: 'x' } }, facts)).toMatchObject({
      value: false,
      unsupported: true,
    });
  });

  it('never reads prototype properties', () => {
    expect(readFact(facts, 'interaction.constructor')).toBeUndefined();
    expect(readFact(facts, 'interaction.__proto__')).toBeUndefined();
    expect(readFact(facts, 'interaction.tags.length')).toBeUndefined();
  });

  it('limits depth', () => {
    let deep: Predicate = leaf('agent.tier', 'eq', 'senior');
    for (let i = 0; i < 40; i += 1) deep = { not: { not: deep } };
    expect(evaluatePredicate(deep, facts).unsupported).toBe(true);
  });
});

it('rejects unsupported regex syntax even through negation', () => {
  const result = evaluatePredicate(
    { not: { fact: 'interaction.name', op: 'matches', value: '(?=A)A' } },
    facts,
  );
  expect(result).toMatchObject({ value: false, unsupported: true });
});

it('property: ambiguous alternations remain safe for long nonmatching input', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 999 }),
      fc.constantFrom('^(a|aa)+$', '^(a|a?)+$', '^(a+)+$'),
      (length, pattern) => {
        const result = evaluatePredicate(
          { fact: 'interaction.value', op: 'matches', value: pattern },
          { interaction: { value: 'a'.repeat(length) + 'b' } },
        );
        expect(result).toMatchObject({ value: false, unsupported: false });
      },
    ),
    { seed: 607, numRuns: 200 },
  );
});
it('property: RE2 matches literal prefixes consistently for normalized routing facts', () => {
  fc.assert(
    fc.property(
      fc
        .array(fc.constantFrom('a', 'b', 'c'), { maxLength: 100 })
        .map((letters) => letters.join('')),
      fc
        .array(fc.constantFrom('a', 'b', 'c'), { maxLength: 100 })
        .map((letters) => letters.join('')),
      (prefix, suffix) => {
        expect(
          evaluatePredicate(
            { fact: 'interaction.value', op: 'matches', value: '^' + prefix },
            { interaction: { value: prefix + suffix } },
          ).value,
        ).toBe(true);
      },
    ),
    { seed: 608, numRuns: 200 },
  );
});
