import { describe, expect, it } from 'vitest';

import { createI18n } from '@verbis/i18n';

import { describePredicate, shortCondition } from './describe.js';

import type { RuleField } from './fields.js';

const fields: RuleField[] = [
  {
    path: 'vars.complaint',
    type: 'string',
    label: 'complaint',
    group: 'variable',
    choices: [{ value: 'damage', label: 'Damaged parcel' }],
  },
  { path: 'vars.amount', type: 'number', label: 'amount', group: 'variable' },
  { path: 'vars.vip', type: 'boolean', label: 'vip', group: 'variable' },
  { path: 'interaction.ani', type: 'string', label: 'interaction.ani', group: 'interaction' },
];

describe('describePredicate', () => {
  it('reads conditions as sentences with choice labels, yes/no and call data names', async () => {
    const i18n = await createI18n('en');
    const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options ?? {});
    expect(
      describePredicate(
        {
          all: [
            { fact: 'vars.complaint', op: 'eq', value: 'damage' },
            { fact: 'vars.amount', op: 'gt', value: 500 },
            {
              any: [
                { fact: 'vars.vip', op: 'eq', value: true },
                { fact: 'interaction.ani', op: 'exists' },
              ],
            },
          ],
        },
        fields,
        t,
      ),
    ).toBe(
      'complaint = Damaged parcel and amount > 500 and (vip = Yes or Caller number is filled)',
    );
    expect(
      describePredicate({ fact: 'vars.amount', op: 'between', value: [10, 20] }, fields, t),
    ).toBe('amount is between 10 – 20');
    expect(
      describePredicate({ not: { fact: 'vars.vip', op: 'eq', value: false } }, fields, t),
    ).toBe('Not true: vip = No');
  });
  it('turns builder expressions back into sentences and hides other formulas', async () => {
    const i18n = await createI18n('tr');
    const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options ?? {});
    expect(describePredicate({ $expr: '((vars.complaint === "damage"))' }, fields, t)).toBe(
      'complaint = Damaged parcel',
    );
    expect(describePredicate({ $expr: 'true' }, fields, t)).toBe(t('designer.rules.always'));
    expect(describePredicate({ $expr: 'len(vars.complaint) * 2 > 3' }, fields, t)).toBe(
      t('designer.rules.describe.formula'),
    );
    expect(
      shortCondition({ fact: 'vars.complaint', op: 'eq', value: 'x'.repeat(200) }, fields, t),
    ).toHaveLength(80);
  });
  it('names blanks, lists, unknown facts and nested formulas without showing code', async () => {
    const i18n = await createI18n('en');
    const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options ?? {});
    const blank = t('designer.rules.describe.blank');
    expect(describePredicate({ $expr: 'false' }, fields, t)).toBe(t('designer.rules.never'));
    expect(describePredicate({ fact: 'vars.amount', op: 'eq', value: '' }, fields, t)).toBe(
      `amount = ${blank}`,
    );
    expect(
      describePredicate({ fact: 'vars.complaint', op: 'in', value: ['damage', 'late'] }, fields, t),
    ).toContain('Damaged parcel, late');
    expect(
      describePredicate({ fact: 'vars.complaint', op: 'eq', value: { nested: 1 } }, fields, t),
    ).toBe('complaint = …');
    // A fact the builder does not list still reads without the `vars.` prefix.
    expect(describePredicate({ fact: 'vars.unlisted', op: 'gte', value: 3 }, fields, t)).toBe(
      'unlisted ≥ 3',
    );
    expect(describePredicate({ fact: 'campaign.name', op: 'neq', value: 'A' }, fields, t)).toBe(
      'campaign.name ≠ A',
    );
    // Only the top level is converted back from an expression; nested formulas stay generic.
    expect(
      describePredicate(
        { any: [{ $expr: 'vars.amount > 1' }, { fact: 'vars.vip', op: 'eq', value: true }] },
        fields,
        t,
      ),
    ).toBe(`${t('designer.rules.describe.formula')} or vip = Yes`);
  });
});
