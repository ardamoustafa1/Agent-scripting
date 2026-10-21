import { describe, expect, it } from 'vitest';

import { OutcomeCodeSchema } from '@verbis/script-schema';

import { OutcomeSchema } from './campaigns.dto.js';

const outcome = (code: string, subCodes: string[] = []) =>
  OutcomeSchema.safeParse({ code, label: 'Synthetic', category: 'success', subCodes }).success;

describe('campaign outcome codes', () => {
  it('accept every code a script can record, so wrap-up can always match it', () => {
    // Scripts record codes such as `SALE_OK` or `demo-success`; the campaign must be able to list them.
    for (const code of ['SALE_OK', 'demo-success', 'demo-abandoned', 'sale.ok', 'A1'])
      expect([code, outcome(code, [code])]).toEqual([
        code,
        OutcomeCodeSchema.safeParse(code).success,
      ]);
    expect(outcome('demo-success')).toBe(true);
  });
  it('still reject codes no script could record', () => {
    for (const code of ['', '-leading', '.leading', 'with space', 'ç', 'x'.repeat(65)])
      expect([code, outcome(code)]).toEqual([code, false]);
    expect(outcome('SALE_OK', ['bad sub'])).toBe(false);
  });
});
