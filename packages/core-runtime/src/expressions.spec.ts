import { afterEach, describe, expect, it } from 'vitest';

import { createCoreRegistry } from './core-components.js';
import { runtimeFixture } from './fixtures.js';
import { Runtime } from './runtime.js';

const engines: Runtime[] = [];
afterEach(() => {
  for (const runtime of engines.splice(0)) runtime.dispose();
});
function runtime() {
  const engine = new Runtime({
    document: runtimeFixture(),
    registry: createCoreRegistry(),
    ports: { sessionEvent: () => undefined },
  });
  engines.push(engine);
  return engine;
}

// ADR-0054: an empty operand means "does not hold yet"; every other failure stays visible.
describe('conditions on empty values', () => {
  it('reads a comparison with an empty field or unanswered data source as not holding', () => {
    const r = runtime();
    r.store.setVariable('count', null);
    expect(r.condition({ $expr: 'vars.count >= 30000' })).toBe(false);
    // The whole condition does not hold, so a negation cannot turn an empty field into "true".
    expect(r.condition({ $expr: '!(vars.count > 1)' })).toBe(false);
    expect(r.condition({ $expr: 'ds.lookup.result > 1' })).toBe(false);
    r.store.setVariable('count', 40000);
    expect(r.condition({ $expr: 'vars.count >= 30000' })).toBe(true);
  });

  it('keeps type errors with filled values, dynamic reads and other engine errors', () => {
    const r = runtime();
    r.store.setVariable('name', 'text');
    expect(() => r.condition({ $expr: 'vars.name > 1' })).toThrow('TYPE_COMPARISON');
    // A whole root is not "a field nobody filled".
    expect(() => r.condition({ $expr: 'interaction > 1' })).toThrow('TYPE_COMPARISON');
    // A dynamic read says nothing about which field is empty.
    r.store.setVariable('name', 'absent');
    expect(() => r.condition({ $expr: 'vars[vars.name] > 1' })).toThrow();
    // Only type errors caused by an empty operand are relaxed.
    r.store.setVariable('count', null);
    expect(() => r.condition({ $expr: 'vars.count / 0 > 0' })).toThrow('DIVISION_BY_ZERO');
  });
});

describe('bindings on empty values', () => {
  it('reads as no value while an operand is empty and keeps every other failure', () => {
    const r = runtime();
    r.store.setVariable('count', null);
    expect(r.expressions.bindingValue('formatCurrency(vars.count)')).toBeNull();
    r.store.setVariable('count', 1500);
    expect(r.expressions.bindingValue('formatCurrency(vars.count)')).toMatch(/1\.500/);
    r.store.setVariable('name', 'text');
    expect(() => r.expressions.bindingValue('formatCurrency(vars.name)')).toThrow('TYPE_NUMBER');
  });
});
