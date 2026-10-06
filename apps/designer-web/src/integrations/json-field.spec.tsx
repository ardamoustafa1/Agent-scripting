import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import { createI18n } from '@verbis/i18n';

import { JsonField } from './json-field.js';

describe('integration JSON editing', () => {
  it('shows newly inferred schema values without requiring a tab remount', async () => {
    const i18n = await createI18n('en'),
      change = vi.fn();
    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <JsonField label="Schema" value={{}} change={change} />
      </I18nextProvider>,
    );
    rerender(
      <I18nextProvider i18n={i18n}>
        <JsonField label="Schema" value={{ type: 'object' }} change={change} />
      </I18nextProvider>,
    );
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Schema' }).value).toContain(
      'object',
    );
  });
  it('retains invalid input and shows an error without committing it to the definition', async () => {
    const i18n = await createI18n('en'),
      change = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <JsonField label="Input" value={{}} change={change} />
      </I18nextProvider>,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Input' }), { target: { value: '{' } });
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeDefined();
  });
});
