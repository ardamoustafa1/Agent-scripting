import { describe, expect, it } from 'vitest';

import { VariableSchema } from '@verbis/script-schema';

import {
  assertSequence,
  emptySnapshot,
  persistedSnapshot,
  RuntimeStateSchema,
  safeSnapshot,
  SecureFieldSchema,
  transition,
  validateVariable,
} from './runtime.js';

const variable = (
  key: string,
  classification: 'public' | 'internal' | 'pii' | 'pci' = 'internal',
  persist = true,
) => VariableSchema.parse({ key, classification, persist, scope: 'session', type: 'string' });
describe('runtime state machine', () => {
  it('supports activation, pause/resume, wrap-up and outcome completion', () => {
    expect(transition('launching', 'active')).toBe('active');
    expect(transition('active', 'paused')).toBe('paused');
    expect(transition('paused', 'active')).toBe('active');
    expect(transition('paused', 'wrapup')).toBe('wrapup');
    expect(transition('wrapup', 'completed', true)).toBe('completed');
  });
  it('requires a disposition before completion', () => {
    expect(() => transition('wrapup', 'completed')).toThrow();
  });
  it.each(['completed', 'abandoned', 'expired'] as const)('never reopens %s', (state) => {
    for (const next of RuntimeStateSchema.options)
      expect(() => transition(state, next, true)).toThrow();
  });
  it.each(['launching', 'active', 'paused', 'wrapup'] as const)(
    'expires or abandons %s',
    (state) => {
      expect(transition(state, 'expired')).toBe('expired');
      expect(transition(state, 'abandoned')).toBe('abandoned');
    },
  );
  it('rejects skipped and backward transitions', () => {
    expect(() => transition('launching', 'wrapup')).toThrow();
    expect(() => transition('active', 'completed', true)).toThrow();
    expect(() => transition('wrapup', 'active')).toThrow();
  });
});
describe('classification and concurrency', () => {
  it('does not persist PCI, undeclared or volatile variables', () => {
    const snapshot = {
      ...emptySnapshot(),
      variables: {
        normal: 'value',
        customer: 'synthetic',
        card: 'tok_abcdefghijklmnop',
        scratch: 'temp',
        unknown: 'hidden',
      },
    };
    const definitions = [
      variable('normal'),
      variable('customer', 'pii'),
      variable('card', 'pci', false),
      variable('scratch', 'internal', false),
    ];
    expect(persistedSnapshot(snapshot, definitions).variables).toEqual({
      normal: 'value',
      customer: 'synthetic',
    });
    expect(safeSnapshot(snapshot, definitions, true).variables['customer']).toBe('[REDACTED]');
    expect(safeSnapshot(snapshot, definitions).variables['card']).toBe('[REDACTED]');
    expect(safeSnapshot(snapshot, definitions).variables['unknown']).toBe('[REDACTED]');
  });
  it('rejects clear PCI writes and global constants', () => {
    expect(() => {
      validateVariable(variable('card', 'pci', false), 'synthetic-cleartext');
    }).toThrow();
    expect(() => {
      validateVariable({ ...variable('constant'), scope: 'global' }, 'x');
    }).toThrow();
    expect(() => {
      validateVariable(undefined, 'x');
    }).toThrow();
  });
  it('validates value types and bounds', () => {
    expect(() => {
      validateVariable(variable('name'), 100);
    }).toThrow();
    expect(() => {
      validateVariable(variable('name'), 'x'.repeat(33_000));
    }).toThrow();
    expect(() => {
      validateVariable(variable('name'), 'value');
    }).not.toThrow();
  });
  it('fails stale sequence before a write', () => {
    expect(() => {
      assertSequence(2, 1);
    }).toThrow();
    expect(() => {
      assertSequence(2, 2);
    }).not.toThrow();
  });
  it('accepts only opaque token receipts at the secure-field boundary', () => {
    const claim = {
      expectedSequence: 0,
      tabId: '01900000-0000-7000-8000-000000000001',
      writeToken: 'a'.repeat(43),
      variable: 'card',
    };
    expect(
      SecureFieldSchema.safeParse({ ...claim, receipt: 'synthetic-clear-value' }).success,
    ).toBe(false);
    expect(SecureFieldSchema.safeParse({ ...claim, receipt: 'tok_abcdefghijklmnop' }).success).toBe(
      true,
    );
  });
});
