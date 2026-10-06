import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeAll, expect, it, vi } from 'vitest';

import { createI18n, type I18nInstance } from '@verbis/i18n';

import { UiProvider } from '../provider.js';

import { DatePicker } from './date-picker.js';

let i18n: I18nInstance;
beforeAll(async () => {
  i18n = await createI18n('en');
});
it('selects a calendar date within bounds, closes the popover and returns focus to its trigger', async () => {
  const selected = new Date(2026, 9, 10),
    change = vi.fn();
  render(
    <UiProvider i18n={i18n}>
      <DatePicker
        label="Start date"
        value={selected}
        min={new Date(2026, 9, 5)}
        max={new Date(2026, 9, 20)}
        onValueChange={change}
      />
    </UiProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Start date' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog.textContent).toContain('October 2026');
  const day = dialog.querySelector<HTMLButtonElement>('[data-day="2026-10-15"] button');
  expect(day).not.toBeNull();
  fireEvent.click(day!);
  expect(change).toHaveBeenCalledWith(new Date(2026, 9, 15));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Start date' }));
});
it('uses Turkish month navigation labels and respects disabled state without a selected date', async () => {
  const tr = await createI18n('tr'),
    change = vi.fn();
  const view = render(
    <UiProvider i18n={tr}>
      <DatePicker label="Tarih" onValueChange={change} disabled />
    </UiProvider>,
  );
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Tarih' }).disabled).toBe(true);
  expect(screen.getByRole('button').textContent).toBe(tr.t('ui.calendar'));
  view.rerender(
    <UiProvider i18n={tr}>
      <DatePicker label="Tarih" onValueChange={change} />
    </UiProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Tarih' }));
  expect(screen.getByRole('button', { name: tr.t('ui.nextMonth') })).toBeDefined();
  expect(screen.getByRole('button', { name: tr.t('ui.previousMonth') })).toBeDefined();
  await userEvent.keyboard('{Escape}');
  expect(change).not.toHaveBeenCalled();
});
