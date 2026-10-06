import { describe, expect, it } from 'vitest';

import { ComponentRegistry } from './registry.js';

describe('ComponentRegistry', () => {
  it('registers components built on primitives', () => {
    const registry = new ComponentRegistry();
    registry.register({ type: 'textInput', builtOn: ['box'] });
    expect(registry.get('textInput')?.builtOn).toEqual(['box']);
    expect(registry.list()).toHaveLength(1);
  });

  it('rejects core primitive names', () => {
    expect(() => {
      new ComponentRegistry().register({ type: 'button', builtOn: ['button'] });
    }).toThrow(/core primitive/);
  });

  it('rejects components not built on primitives', () => {
    expect(() => {
      new ComponentRegistry().register({ type: 'x', builtOn: [] });
    }).toThrow(/at least one/);
  });

  it('rejects duplicates', () => {
    const registry = new ComponentRegistry();
    registry.register({ type: 'table', builtOn: ['box', 'webService'] });
    expect(() => {
      registry.register({ type: 'table', builtOn: ['box'] });
    }).toThrow(/already/);
  });

  it('returns undefined for unknown components', () => {
    expect(new ComponentRegistry().get('nope')).toBeUndefined();
  });
});
