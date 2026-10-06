import { describe, expect, it } from 'vitest';

import { expressionToRule, ruleToExpression } from '@verbis/expr';
import { PredicateSchema, ScriptDocumentSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { operators, ruleFields } from './fields.js';

describe('no-code conditions', () => {
  it('limits operators by field type and exposes interaction fields', () => {
    expect(operators('number')).toContain('gt');
    expect(operators('boolean')).not.toContain('contains');
    expect(operators('date')).toContain('dateRange');
    expect(
      ruleFields(ScriptDocumentSchema.parse(minimalScript())).some(
        (f) => f.path === 'interaction.channel',
      ),
    ).toBe(true);
  });
  it('keeps nested AND/OR conditions equivalent through expression mode', () => {
    const rule = PredicateSchema.parse({
      all: [
        { fact: 'vars.amount', op: 'gt', value: 10 },
        {
          any: [
            { fact: 'interaction.channel', op: 'eq', value: 'voice' },
            { fact: 'vars.vip', op: 'eq', value: true },
          ],
        },
      ],
    });
    const roundtrip = expressionToRule(ruleToExpression(rule));
    expect(ruleToExpression(roundtrip)).toBe(ruleToExpression(rule));
  });
});
