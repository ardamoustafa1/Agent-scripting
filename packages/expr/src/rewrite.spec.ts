import { describe, expect, it } from 'vitest';

import { renameVariableExpression } from './rewrite.js';

describe('AST variable rename', () => {
  it('replaces only variable member tokens, preserving literals and similar names', () => {
    expect(
      renameVariableExpression(
        'vars.name == "vars.name" && vars.names != vars.name',
        'name',
        'customerName',
      ),
    ).toBe('vars.customerName == "vars.name" && vars.names != vars.customerName');
  });
  it('supports quoted bracket members and nested properties', () => {
    expect(
      renameVariableExpression('vars[\'name\'].first == vars["name"]', 'name', 'customer'),
    ).toBe('vars["customer"].first == vars["customer"]');
  });
  it('refuses dynamic root lookups rather than making an unsafe partial rename', () => {
    expect(() =>
      renameVariableExpression('vars[interaction.channel] == vars.name', 'name', 'customer'),
    ).toThrow(expect.objectContaining({ code: 'RENAME_DYNAMIC_VARIABLE' }));
  });
  it('respects lambda locals that shadow the variable root', () => {
    expect(renameVariableExpression('map(vars.items, vars => vars.name)', 'name', 'customer')).toBe(
      'map(vars.items, vars => vars.name)',
    );
  });
  it('rejects invalid replacement identifiers', () => {
    expect(() => renameVariableExpression('vars.name', 'name', 'a-b')).toThrow();
  });
});
