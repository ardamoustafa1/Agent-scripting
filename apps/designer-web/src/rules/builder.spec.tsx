import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import { createI18n } from '@verbis/i18n';
import type { Predicate } from '@verbis/script-schema';

import { RuleBuilder } from './builder.js';

describe('rule builder interaction', () => {
  it('adds a nested OR group with a structured predicate', async () => {
    const onChange = vi.fn<(value: Predicate) => void>(),
      i18n = await createI18n('en');
    render(
      <I18nextProvider i18n={i18n}>
        <RuleBuilder
          value={{ all: [{ fact: 'vars.amount', op: 'gt', value: 5 }] }}
          fields={[{ path: 'vars.amount', type: 'number', label: 'amount' }]}
          onChange={onChange}
        />
      </I18nextProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
    const updated = onChange.mock.calls[0]?.[0];
    expect(updated && 'all' in updated ? updated.all.length : 0).toBe(2);
  });
  it('lets an expression-only leaf become a visual group on explicit author action', async () => {
    const onChange = vi.fn<(value: Predicate) => void>(),
      i18n = await createI18n('en');
    render(
      <I18nextProvider i18n={i18n}>
        <RuleBuilder
          value={{ $expr: 'true' }}
          fields={[{ path: 'interaction.channel', type: 'string', label: 'channel' }]}
          onChange={onChange}
        />
      </I18nextProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    expect(onChange).toHaveBeenCalledWith({
      all: [{ fact: 'interaction.channel', op: 'eq', value: '' }],
    });
  });
});

it.each([true, false])(
  'edits literal conditions without an advanced expression warning: %s',
  async (booleanField) => {
    const onChange = vi.fn<(value: Predicate) => void>(),
      i18n = await createI18n('en');
    render(
      <I18nextProvider i18n={i18n}>
        <RuleBuilder
          value={{ $expr: ' true ' }}
          fields={booleanField ? [{ path: 'vars.enabled', type: 'boolean', label: 'enabled' }] : []}
          onChange={onChange}
        />
      </I18nextProvider>,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Value' }));
    // Literal conditions read as "Always"/"Never", not as code.
    expect(screen.queryByRole('option', { name: 'true' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'Never' }));
    expect(onChange).toHaveBeenLastCalledWith({ $expr: 'false' });
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    expect(onChange).toHaveBeenLastCalledWith({
      all: [
        {
          fact: booleanField ? 'vars.enabled' : 'interaction.channel',
          op: 'eq',
          value: booleanField ? false : '',
        },
      ],
    });
  },
);

it('edits a negated boolean predicate using a typed visual control', async () => {
  const onChange = vi.fn<(value: Predicate) => void>(),
    i18n = await createI18n('en');
  render(
    <I18nextProvider i18n={i18n}>
      <RuleBuilder
        value={{ not: { fact: 'vars.enabled', op: 'eq', value: false } }}
        fields={[
          { path: 'vars.enabled', type: 'boolean', label: 'enabled' },
          { path: 'vars.amount', type: 'number', label: 'amount' },
        ]}
        onChange={onChange}
      />
    </I18nextProvider>,
  );
  fireEvent.click(screen.getByRole('combobox', { name: 'Value' }));
  fireEvent.click(screen.getByRole('option', { name: 'Yes' }));
  expect(onChange).toHaveBeenLastCalledWith({
    not: { fact: 'vars.enabled', op: 'eq', value: true },
  });
  fireEvent.click(screen.getByRole('combobox', { name: 'Field' }));
  fireEvent.click(screen.getByRole('option', { name: 'amount' }));
  expect(onChange).toHaveBeenLastCalledWith({ not: { fact: 'vars.amount', op: 'eq', value: 0 } });
});

it('names call data and data source fields, groups them and offers bound choices as values', async () => {
  const onChange = vi.fn<(value: Predicate) => void>(),
    i18n = await createI18n('en');
  render(
    <I18nextProvider i18n={i18n}>
      <RuleBuilder
        value={{ all: [{ fact: 'vars.complaint', op: 'eq', value: 'delay' }] }}
        fields={[
          {
            path: 'vars.complaint',
            type: 'string',
            label: 'complaint',
            group: 'variable',
            choices: [
              { value: 'delay', label: 'Delivery delay' },
              { value: 'damage', label: 'Damaged parcel' },
            ],
          },
          {
            path: 'interaction.ani',
            type: 'string',
            label: 'interaction.ani',
            group: 'interaction',
          },
          { path: 'ds.lookup.status', type: 'string', label: 'lookup.status', group: 'dataSource' },
        ]}
        onChange={onChange}
      />
    </I18nextProvider>,
  );
  const value = screen.getByRole('combobox', { name: 'Value' });
  expect(value.textContent).toBe('Delivery delay');
  fireEvent.click(value);
  fireEvent.click(screen.getByRole('option', { name: 'Damaged parcel' }));
  expect(onChange).toHaveBeenLastCalledWith({
    all: [{ fact: 'vars.complaint', op: 'eq', value: 'damage' }],
  });
  fireEvent.click(screen.getByRole('combobox', { name: 'Field' }));
  expect(screen.getByRole('option', { name: 'Caller number' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Data source · lookup.status' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'interaction.ani' })).toBeNull();
  expect(screen.getAllByRole('group').map((g) => g.firstElementChild?.textContent)).toEqual([
    'Variables',
    'Call data',
    'Data sources',
  ]);
});
