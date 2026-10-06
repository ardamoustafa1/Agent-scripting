import { describe, expect, it } from 'vitest';

import { ScriptDocumentSchema, VariableSchema, TestScenarioSchema } from '@verbis/script-schema';
import { minimalScript, VALID_FIXTURES } from '@verbis/script-schema/fixtures';

import { jsonDefault, renameVariable, variableUses } from './variables.js';

function fixture() {
  const doc = ScriptDocumentSchema.parse(minimalScript());
  doc.variables = [
    {
      key: 'name',
      type: 'string',
      scope: 'session',
      classification: 'pii',
      pii: true,
      persist: false,
      default: '',
    },
  ];
  doc.rules = [
    {
      id: 'named',
      when: { all: [{ fact: 'vars.name', op: 'neq', value: 'name' }] },
      then: [{ type: 'setVariable', variable: 'name', value: { $expr: 'vars.name' } }],
    },
  ];
  doc.pages[0]!.layout.visibleWhen = { $expr: 'vars.name != "name"' };
  doc.i18n.messages['tr']!['greeting'] = 'Merhaba {{name}} / {{ vars.name }}';
  return doc;
}
describe('safe document reference rename', () => {
  it('updates facts, expressions, writes and interpolations while preserving literal data', () => {
    const doc = fixture(),
      original = structuredClone(doc);
    expect(variableUses(doc, 'name').some((use) => use.kind === 'write')).toBe(true);
    const renamed = renameVariable(doc, 'name', 'customer');
    expect(renamed.variables[0]?.key).toBe('customer');
    expect(renamed.variables[0]?.default).toBe('');
    expect(renamed.pages[0]?.layout.visibleWhen).toEqual({ $expr: 'vars.customer != "name"' });
    expect(renamed.i18n.messages['tr']?.['greeting']).toBe(
      'Merhaba {{customer}} / {{ vars.customer }}',
    );
    expect(renamed.rules[0]?.when).toEqual({
      all: [{ fact: 'vars.customer', op: 'neq', value: 'name' }],
    });
    expect(variableUses(renamed, 'name')).toEqual([]);
    expect(doc).toEqual(original);
  });
  it('refuses collisions and dynamic references without changing the source', () => {
    const doc = fixture();
    doc.pages[0]!.layout.visibleWhen = { $expr: 'vars[interaction.channel]' };
    expect(() => renameVariable(doc, 'name', 'customer')).toThrow();
    doc.variables.push({ ...doc.variables[0]!, key: 'other' });
    expect(() => renameVariable(doc, 'name', 'other')).toThrow();
    expect(doc.variables[0]?.key).toBe('name');
  });
  it('keeps invalid in-progress expressions inspectable and refuses unsafe rename', () => {
    const doc = fixture();
    doc.pages[0]!.layout.visibleWhen = { $expr: 'vars.' };
    expect(variableUses(doc, 'name').length).toBeGreaterThan(0);
    expect(() => renameVariable(doc, 'name', 'customer')).toThrow();
  });
});

it('renames synthetic scenario initial values, assertions and action references atomically', () => {
  const document = ScriptDocumentSchema.parse(minimalScript());
  document.variables.push(
    VariableSchema.parse({
      key: 'old',
      type: 'string',
      scope: 'session',
      classification: 'public',
    }),
  );
  document.testScenarios = [
    TestScenarioSchema.parse({
      id: 'renameFixture',
      name: 'Rename fixture',
      synthetic: true,
      context: { variables: { old: 'synthetic' } },
      steps: [
        { type: 'variable', variable: 'old', value: 'synthetic' },
        {
          type: 'actions',
          actions: [{ type: 'setVariable', variable: 'old', value: { $expr: 'vars.old' } }],
        },
      ],
      expected: { variables: { old: 'synthetic' } },
    }),
  ];
  const renamed = renameVariable(document, 'old', 'new');
  expect(renamed.testScenarios?.[0]?.context.variables).toEqual({ new: 'synthetic' });
  expect(renamed.testScenarios?.[0]?.expected.variables).toEqual({ new: 'synthetic' });
  expect(JSON.stringify(renamed.testScenarios?.[0]?.steps)).not.toContain('"old"');
});

it.each(Object.entries(VALID_FIXTURES))(
  'renames every declared variable in %s without losing its consumers',
  (_, fixture) => {
    const doc = ScriptDocumentSchema.parse(fixture);
    for (const variable of doc.variables) {
      const before = variableUses(doc, variable.key);
      const renamed = renameVariable(doc, variable.key, 'syntheticRenamed');
      expect(variableUses(renamed, variable.key)).toEqual([]);
      expect(variableUses(renamed, 'syntheticRenamed')).toHaveLength(before.length);
      expect(renamed.variables.find((v) => v.key === 'syntheticRenamed')).toEqual({
        ...variable,
        key: 'syntheticRenamed',
      });
      expect(renameVariable(doc, variable.key, variable.key)).toBe(doc);
    }
    expect(() => renameVariable(doc, 'missingVariable', 'syntheticRenamed')).toThrow(
      'VERBIS_VARIABLE_RENAME',
    );
  },
);
it.each([
  ['number', 0],
  ['boolean', false],
  ['array', []],
  ['object', {}],
  ['date', '2000-01-01'],
  ['string', ''],
])('provides a valid starting value for %s variables', (type, value) => {
  const initial = jsonDefault(type);
  expect(initial).toEqual(value);
  expect(
    VariableSchema.safeParse({
      key: 'synthetic',
      type,
      scope: 'session',
      classification: 'public',
      default: initial,
    }).success,
  ).toBe(true);
});
