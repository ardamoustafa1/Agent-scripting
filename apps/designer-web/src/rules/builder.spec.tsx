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
    fireEvent.click(screen.getByRole('button', { name: 'Visual rule' }));
    expect(onChange).toHaveBeenCalledWith({
      all: [{ fact: 'interaction.channel', op: 'eq', value: '' }],
    });
  });
});
