import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { createI18n } from '@verbis/i18n';

import { UiProvider } from './provider.js';
import { RetryAfterNotice, retryAfterSeconds } from './retry-after.js';

afterEach(() => {
  vi.useRealTimers();
});
it('bounds both Retry-After formats and handles invalid headers', () => {
  expect(retryAfterSeconds('12')).toBe(12);
  expect(retryAfterSeconds('garbage')).toBe(60);
  expect(retryAfterSeconds('999999')).toBe(3600);
  expect(
    retryAfterSeconds('Tue, 06 Oct 2026 12:00:15 GMT', Date.parse('2026-10-06T12:00:00Z')),
  ).toBe(15);
});
it('announces the countdown, retries once, and cancels when unmounted', async () => {
  const i18n = await createI18n('en');
  vi.useFakeTimers();
  const retry = vi.fn();
  const view = render(
    <UiProvider i18n={i18n}>
      <RetryAfterNotice seconds={3} retry={retry} />
    </UiProvider>,
  );
  expect(screen.getByRole('status').textContent).toContain('3');
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  expect(retry).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(retry).toHaveBeenCalledOnce();
  view.unmount();
  act(() => {
    vi.advanceTimersByTime(10000);
  });
  expect(retry).toHaveBeenCalledOnce();
});
