import { describe, expect, it } from 'vitest';

import { minimalScript } from '../fixtures/minimal.js';
import { validateSemantics } from '../validation/semantic.js';

import { ScriptDocumentSchema } from './document.js';
import { TestScenarioSchema } from './preview.js';

describe('synthetic preview contracts', () => {
  it('requires an assertion, synthetic provenance and bounded recording', () => {
    const base = {
      id: 'synthetic',
      name: 'Synthetic',
      synthetic: true,
      context: {},
      steps: [],
      expected: { page: 'home' },
    };
    expect(TestScenarioSchema.safeParse(base).success).toBe(true);
    expect(TestScenarioSchema.safeParse({ ...base, synthetic: false }).success).toBe(false);
    expect(TestScenarioSchema.safeParse({ ...base, expected: {} }).success).toBe(false);
    expect(
      TestScenarioSchema.safeParse({
        ...base,
        steps: Array.from({ length: 501 }, () => ({ type: 'variable', variable: 'x', value: 1 })),
      }).success,
    ).toBe(false);
  });
  it('blocks sensitive recordings through the same schema boundary used by API imports and draft saves', () => {
    const doc = ScriptDocumentSchema.parse(minimalScript());
    doc.variables.push({
      key: 'personal',
      type: 'string',
      scope: 'session',
      default: '',
      classification: 'pii',
      pii: true,
      persist: false,
    });
    doc.testScenarios = [
      TestScenarioSchema.parse({
        id: 'synthetic',
        name: 'Synthetic',
        synthetic: true,
        context: { variables: { personal: 'synthetic' } },
        steps: [],
        expected: { page: 'home' },
      }),
    ];
    expect(validateSemantics(doc).some((issue) => issue.code === 'SCENARIO_SENSITIVE')).toBe(true);
    doc.testScenarios[0]!.context.variables = {};
    doc.testScenarios[0]!.expected.page = 'missing';
    expect(validateSemantics(doc).some((issue) => issue.code === 'SCENARIO_INVALID')).toBe(true);
  });
});
