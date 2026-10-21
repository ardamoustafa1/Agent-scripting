import { describe, expect, it } from 'vitest';

import { NodeSchema, ScriptDocumentSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { humanize, placeholderNames } from './placeholders.js';

const document = ScriptDocumentSchema.parse({
  ...minimalScript(),
  variables: [
    { key: 'customerName', type: 'string', scope: 'session', description: 'müşteri adı' },
    { key: 'tcKimlikNo', type: 'string', scope: 'session' },
    { key: 'premium', type: 'number', scope: 'session', description: '  ' },
  ],
});
const translate = (key: string) => `T(${key})`;
const names = (expression: string) =>
  placeholderNames(
    NodeSchema.parse({
      id: 'text',
      type: 'scriptText',
      bindings: [{ prop: 'params', expression }],
    }),
    document,
    translate,
  );

describe('placeholder names', () => {
  it('names each gap after where its value comes from', () => {
    expect(
      names(
        '{ name: vars.customerName, agent: agent.firstName, id: vars.tcKimlikNo, ani: interaction.ani }',
      ),
    ).toEqual({
      name: 'müşteri adı',
      agent: 'T(components.gaps.agent)',
      id: 'tc kimlik no',
      ani: 'T(components.gaps.ani)',
    });
  });

  it('looks through formatting calls and falls back to words, never code', () => {
    expect(
      names(
        "{ price: formatCurrency(vars.premium), when: if(exists(vars.customerName), 'x', 'y'), mixed: vars.premium + vars.tcKimlikNo, count: ds.orders.itemCount, orderNo: 'fixed' }",
      ),
    ).toEqual({
      // A blank display name is ignored.
      price: 'premium',
      when: 'müşteri adı',
      // Two sources: the placeholder's own name, in words.
      mixed: 'mixed',
      count: 'item count',
      orderNo: 'order no',
    });
  });

  it('has nothing to name without an object of parameters', () => {
    const text = (bindings: unknown[]) =>
      placeholderNames(
        NodeSchema.parse({ id: 'text', type: 'scriptText', bindings }),
        document,
        translate,
      );
    expect(text([])).toEqual({});
    expect(text([{ prop: 'params', expression: 'vars.customerName' }])).toEqual({});
    expect(text([{ prop: 'params', expression: '{ broken: ' }])).toEqual({});
  });

  it('splits code names into lower-case words', () => {
    expect(humanize('customerName')).toBe('customer name');
    expect(humanize('order_number2')).toBe('order number 2');
    expect(humanize('agent')).toBe('agent');
  });
});
