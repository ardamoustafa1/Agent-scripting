import { describe, expect, it, vi } from 'vitest';

import { RuntimeExpressions } from './expressions.js';
import { runtimeFixture } from './fixtures.js';
import { RuntimeStore } from './store.js';

describe('reactive session store', () => {
  it('notifies only exact, ancestor and wildcard dependencies, once per batch', () => {
    const store = new RuntimeStore(runtimeFixture()),
      name = vi.fn(),
      other = vi.fn(),
      wildcard = vi.fn();
    const remove = store.subscribe(['vars.name', 'vars'], name);
    store.subscribe(['vars.other'], other);
    store.subscribe(['vars.*'], wildcard);
    store.batch(() => {
      store.setVariable('name', 'one');
      store.setVariable('name', 'two');
    });
    expect(name).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    expect(wildcard).toHaveBeenCalledTimes(1);
    remove();
    store.setVariable('name', 'three');
    expect(name).toHaveBeenCalledTimes(1);
  });
  it('keeps snapshots stable and catches updates before React subscribes', () => {
    const store = new RuntimeStore(runtimeFixture());
    const revision = store.revision(['vars.name']);
    expect(store.revision(['vars.name'])).toBe(revision);
    store.setVariable('name', 'new');
    expect(store.revision(['vars.name'])).not.toBe(revision);
  });
  it('rejects unknown, readonly and incorrectly typed variables at the boundary', () => {
    const store = new RuntimeStore(runtimeFixture());
    expect(() => {
      store.setVariable('constant', 'overwrite');
    }).toThrow('VERBIS_VARIABLE_READONLY');
    expect(() => {
      store.setVariable('missing', true);
    }).toThrow('VERBIS_VARIABLE_UNKNOWN');
    expect(() => {
      store.setVariable('count', 'wrong');
    }).toThrow('VERBIS_VARIABLE_TYPE');
    expect(() => new RuntimeStore(runtimeFixture(), { variables: { missing: 1 } })).toThrow();
  });
  it('isolates failing subscribers without dropping other publications', () => {
    const store = new RuntimeStore(runtimeFixture()),
      listener = vi.fn();
    store.subscribe(['vars.name'], () => {
      throw new Error('synthetic');
    });
    store.subscribe(['vars.name'], listener);
    store.setVariable('name', 'value');
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it('slices static expression context but supports dynamic variable reads and rule dependencies', () => {
    const doc = runtimeFixture(),
      store = new RuntimeStore(doc),
      expressions = new RuntimeExpressions(doc, store);
    store.setVariable('name', 'other');
    store.setVariable('other', 'result');
    expect(expressions.evaluate('vars[vars.name]')).toBe('result');
    expect(expressions.condition({ $rule: 'has-name' })).toBe(true);
    expect(store.variable('count')).toBe(0); // Predicate evaluation has no implicit side effects.
    expect(store.context(['vars.name'])['vars']).toEqual({ name: 'other' });
  });
});

it('retains inherited payment classification and clears payment memory on close', () => {
  const store = new RuntimeStore(runtimeFixture());
  store.setVariable('name', 'synthetic-payment', 'pci');
  store.setVariable('name', 'replacement');
  expect(store.classification('name')).toBe('pci');
  store.clearPaymentValues();
  expect(store.variable('name')).toBeNull();
  expect(store.variable('count')).toBe(0);
});

it('updates locale without replacing the session store or losing variables', () => {
  const document = runtimeFixture();
  const store = new RuntimeStore(document, { locale: 'tr' });
  const changed = vi.fn();
  const stop = store.subscribe(['runtime.locale'], changed);
  store.setLocale('en');
  expect(store.locale).toBe('en');
  expect(changed).toHaveBeenCalledOnce();
  stop();
});

it('resolves immutable context sources with session overrides and fallbacks across absent, scalar and array parents', () => {
  const document = runtimeFixture();
  document.variables[0]!.source = 'interaction.customer.name';
  document.variables[1]!.source = 'agent.profile.name';
  const sourced = new RuntimeStore(document, {
    interaction: { customer: { name: 'Synthetic' } },
    agent: { profile: 'scalar' },
  });
  expect(sourced.variable('name')).toBe('Synthetic');
  expect(sourced.variable('other')).toBe('');
  expect(Object.isFrozen(sourced.contextRoots['interaction'])).toBe(true);
  expect(
    new RuntimeStore(document, { interaction: { customer: [{ name: 'Ignored array' }] } }).variable(
      'name',
    ),
  ).toBe('');
  expect(
    new RuntimeStore(document, {
      variables: { name: 'Override' },
      interaction: { customer: { name: 'Source' } },
    }).variable('name'),
  ).toBe('Override');
  expect(() => new RuntimeStore(document, { interaction: { customer: { name: 12 } } })).toThrow(
    'VERBIS_VARIABLE_TYPE',
  );
});
it('publishes classification-only changes exactly once and retains inherited classification inside a batch', () => {
  const store = new RuntimeStore(runtimeFixture()),
    listener = vi.fn();
  store.subscribe(['vars.name'], listener);
  store.setVariable('name', '', 'pii');
  expect(listener).toHaveBeenCalledOnce();
  expect(store.classification('name')).toBe('pii');
  store.batch(() => {
    store.setVariable('name', '', 'pci');
    store.setVariable('name', 'replacement');
  }, 'synthetic');
  expect(listener).toHaveBeenCalledTimes(2);
  expect(store.classification('name')).toBe('pci');
  expect(store.changeSource).toBeUndefined();
});
it('restores removed internal paths, resets page variables, slices context roots and restores nested change sources even on failure', () => {
  const document = runtimeFixture();
  document.variables[0]!.scope = 'page';
  delete document.variables[0]!.default;
  const store = new RuntimeStore(document),
    checkpoint = store.checkpoint();
  store.set('runtime.transient', true);
  store.setVariable('name', 'changed');
  store.restore(checkpoint);
  expect(store.get('runtime.transient')).toBeNull();
  expect(store.variable('name')).toBeNull();
  store.setVariable('name', 'page value');
  store.resetPageVariables();
  expect(store.variable('name')).toBeNull();
  for (const dependency of ['vars', 'vars.*', 'ds', 'ds.*'])
    expect(store.context([dependency])['vars']).toHaveProperty('name', null);
  expect(store.context(['ds.lookup.rows'])['ds']).toEqual({
    lookup: { status: 'idle', loading: false, error: null },
  });
  expect(store.context(['vars.name'])['ds']).toEqual({});
  expect(() =>
    store.batch(() => {
      expect(store.changeSource).toBe('outer');
      store.batch(() => {
        expect(store.changeSource).toBe('inner');
      }, 'inner');
      expect(store.changeSource).toBe('outer');
      throw new Error('synthetic');
    }, 'outer'),
  ).toThrow('synthetic');
  expect(store.changeSource).toBeUndefined();
  const unsubscribe = store.subscribe(['vars.name', 'vars.name'], vi.fn());
  unsubscribe();
  unsubscribe();
});
