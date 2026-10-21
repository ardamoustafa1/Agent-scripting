import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createI18n, type I18nInstance } from '@verbis/i18n';
import type { Value } from '@verbis/script-schema';
import { UiProvider } from '@verbis/ui';

import {
  ValueEditor,
  emptyValue,
  parseList,
  valueKind,
  valueMode,
  type ValueKind,
} from './value-editor.js';

let i18n: I18nInstance;
beforeAll(async () => {
  i18n = await createI18n('en');
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
const variables = [
  { key: 'amount', type: 'number' as const },
  { key: 'customerName', type: 'string' as const },
];
function mount(kind: ValueKind, initial: Value, options: { allowSources?: boolean } = {}) {
  const changes: Value[] = [];
  function Harness() {
    const [value, setValue] = useState<Value>(initial);
    return (
      <ValueEditor
        label="Synthetic value"
        value={value}
        kind={kind}
        variables={variables}
        {...(options.allowSources === undefined ? {} : { allowSources: options.allowSources })}
        choices={kind === 'string' && initial === 'late' ? [{ value: 'late', label: 'Late' }] : []}
        onChange={(next) => {
          changes.push(next);
          setValue(next);
        }}
      />
    );
  }
  render(
    <UiProvider i18n={i18n}>
      <Harness />
    </UiProvider>,
  );
  return changes;
}
async function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

describe('value helpers', () => {
  it('classifies authored values and maps variable types to editors', () => {
    expect(valueMode(5)).toBe('fixed');
    expect(valueMode({ $expr: ' vars.amount ' })).toBe('variable');
    expect(valueMode({ $expr: 'vars.amount * 2' })).toBe('formula');
    expect(valueKind('enum')).toBe('string');
    expect(valueKind('date')).toBe('date');
    expect(valueKind(undefined)).toBe('any');
    expect(
      ['number', 'boolean', 'array', 'object', 'any'].map((k) => emptyValue(k as ValueKind)),
    ).toEqual([0, false, [], {}, '']);
    expect(parseList(' a, 2 ,, -1.5 ,b ')).toEqual(['a', 2, -1.5, 'b']);
  });
});

describe('ValueEditor', () => {
  it('edits numbers in a number field and clears to no value', () => {
    const number = mount('number', 3, { allowSources: false });
    const field = screen.getByLabelText<HTMLInputElement>('Synthetic value');
    expect(field.type).toBe('number');
    fireEvent.change(field, { target: { value: '42' } });
    fireEvent.change(field, { target: { value: '' } });
    expect(number).toEqual([42, null]);
  });

  it('offers yes/no for booleans', async () => {
    const yes = mount('boolean', false, { allowSources: false });
    await choose('Synthetic value', i18n.t('designer.value.yes'));
    expect(yes).toEqual([true]);
  });

  it('keeps dates as ISO days', () => {
    const date = mount('date', '2026-10-21T10:00:00Z', { allowSources: false });
    const input = screen.getByLabelText<HTMLInputElement>('Synthetic value');
    expect(input.value).toBe('2026-10-21');
    fireEvent.change(input, { target: { value: '2026-11-01' } });
    expect(date).toEqual(['2026-11-01']);
  });

  it('edits flat lists as comma separated text', () => {
    const list = mount('array', ['a', 1], { allowSources: false });
    const input = screen.getByLabelText<HTMLInputElement>('Synthetic value');
    expect(input.value).toBe('a, 1');
    fireEvent.change(input, { target: { value: 'x, 2' } });
    expect(list).toEqual([['x', 2]]);
  });

  it('switches between a fixed value, another variable and a formula', async () => {
    const changes = mount('number', 1);
    await choose(i18n.t('designer.value.mode'), i18n.t('designer.value.modes.variable'));
    // The first variable of the same type is chosen, not one that would not fit.
    expect(changes.at(-1)).toEqual({ $expr: 'vars.amount' });
    await choose(i18n.t('designer.value.sourceVariable'), 'customerName');
    expect(changes.at(-1)).toEqual({ $expr: 'vars.customerName' });
    await choose(i18n.t('designer.value.mode'), i18n.t('designer.value.modes.formula'));
    expect(changes.at(-1)).toEqual({ $expr: 'vars.customerName' });
    await choose(i18n.t('designer.value.mode'), i18n.t('designer.value.modes.fixed'));
    expect(changes.at(-1)).toBe(0);
  });

  it('shows enum choices as a picker', () => {
    const changes = mount('string', 'late', { allowSources: false });
    expect(screen.getByRole('combobox', { name: 'Synthetic value' })).toBeTruthy();
    expect(changes).toEqual([]);
  });
});
