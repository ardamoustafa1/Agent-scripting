import { describe, expect, it } from 'vitest';

import { scanExpression, scanFactPath } from './references.js';

describe('scanExpression', () => {
  it('finds variable and data source references', () => {
    expect(scanExpression('vars.a + vars.b * 2 > ds.lookup.score && ds.other')).toEqual({
      variables: ['a', 'b'],
      dataSources: [{ id: 'lookup', field: 'score' }, { id: 'other' }],
    });
  });

  it('ignores references inside string literals (with escapes)', () => {
    expect(scanExpression(`"vars.nope" + 'it\\'s vars.nope2' + vars.yes`).variables).toEqual([
      'yes',
    ]);
  });

  it('ignores member access on other roots and number literals', () => {
    expect(scanExpression('agent.vars.x + 1.5e3 + obj.ds.y + interaction.ani').variables).toEqual(
      [],
    );
    expect(scanExpression('1.vars').variables).toEqual([]);
  });

  it('handles bare roots, calls and object literals', () => {
    expect(scanExpression('vars').variables).toEqual([]);
    expect(scanExpression('min(vars.limit, vars.max)').variables).toEqual(['limit', 'max']);
    expect(scanExpression('{ name: vars.customerName }').variables).toEqual(['customerName']);
    expect(scanExpression('vars. x').variables).toEqual([]);
  });

  it('deduplicates', () => {
    expect(scanExpression('vars.a + vars.a + ds.x.y + ds.x.y')).toEqual({
      variables: ['a'],
      dataSources: [{ id: 'x', field: 'y' }],
    });
  });

  it('scans fact paths', () => {
    expect(scanFactPath('vars.segment').variables).toEqual(['segment']);
    expect(scanFactPath('ds.lookup.balance').dataSources).toEqual([
      { id: 'lookup', field: 'balance' },
    ]);
  });
});
