import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCoreRegistry } from './core-components.js';
import { runtimeFixture } from './fixtures.js';
import { Runtime } from './runtime.js';

const engines: Runtime[] = [];
afterEach(() => {
  engines.splice(0).forEach((runtime) => {
    runtime.dispose();
  });
});
function fixture() {
  const runtime = new Runtime({
    document: runtimeFixture(),
    registry: createCoreRegistry(),
    session: { interaction: { ani: 'masked', key: 'count' } },
    ports: { sessionEvent: vi.fn() },
  });
  engines.push(runtime);
  runtime.store.setVariable('count', 1, 'pci');
  return runtime;
}
describe('runtime expression display and sink privacy', () => {
  it.each([
    'vars.count',
    'vars.count.detail',
    'vars',
    'vars[interaction.key]',
    'ds.lookup.result',
    'ds.lookup.result.detail',
    'ds.lookup',
    'ds.lookup[interaction.key]',
    'ds',
    'ds[interaction.key]',
  ])('rejects PCI display through %s', (source) => {
    const runtime = fixture();
    // Mapped source output shares the destination variable classification.
    runtime.store.setVariable('name', 'private', 'pci');
    expect(() => {
      runtime.expressions.assertDisplay(source);
    }).toThrow('VERBIS_SENSITIVE_DISPLAY');
  });
  it('allows public displays and returns the strongest classification across all dependencies', () => {
    const runtime = fixture();
    expect(() => {
      runtime.expressions.assertDisplay('vars.other');
    }).not.toThrow();
    expect(runtime.expressions.sensitivity({ $expr: 'vars.other' })).toBe('public');
    runtime.store.setVariable('other', 'private', 'pii');
    expect(runtime.expressions.sensitivity({ $expr: 'vars.other' })).toBe('pii');
    expect(runtime.expressions.sensitivity({ $expr: 'vars.count + vars.other' })).toBe('pci');
    expect(runtime.expressions.sensitivity({ $expr: 'interaction.ani' })).toBe('pii');
    expect(runtime.expressions.sensitivity({ $expr: 'ds.lookup.result' })).toBe('pii');
    for (const value of [null, 1, [], { literal: 1 }])
      expect(runtime.expressions.sensitivity(value)).toBe('public');
  });
  it('forbids private diagnostic payloads and unmapped datasource sinks', () => {
    const runtime = fixture();
    runtime.store.setVariable('name', 'private', 'pii');
    expect(() => {
      runtime.expressions.assertSink({ value: { $expr: 'vars.name' } }, true);
    }).toThrow('VERBIS_SENSITIVE_SINK');
    expect(() => {
      runtime.expressions.assertSink({ value: { $expr: 'vars.count' } });
    }).toThrow('VERBIS_SENSITIVE_SINK');
    expect(() => {
      runtime.expressions.assertSink({ value: { $expr: 'ds.lookup.result' } });
    }).toThrow('VERBIS_SENSITIVE_SINK');
    expect(() => {
      runtime.expressions.assertSink({
        value: { $expr: 'vars.other' },
        null: null,
        array: [],
        plain: { a: 1 },
      });
    }).not.toThrow();
  });
});
