import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import type { Runtime } from '@verbis/core-runtime';
import { createI18n, type I18nInstance } from '@verbis/i18n';
import { UiProvider } from '@verbis/ui';

import { ActionComponent } from './actions.js';
import { ComponentProvider, type ComponentEnvironment } from './environment.js';
import { createFixtureRuntime, syntheticRendererProps } from './test-fixtures.js';

let i18n: I18nInstance;
const engines: Runtime[] = [];
beforeAll(async () => {
  i18n = await createI18n();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  engines.splice(0).forEach((runtime) => {
    runtime.dispose();
  });
  vi.restoreAllMocks();
});
function mount(
  type: string,
  props: Record<string, unknown> = {},
  scheduleCallback?: ComponentEnvironment['scheduleCallback'],
) {
  const runtime = createFixtureRuntime(type);
  engines.push(runtime);
  const component = syntheticRendererProps(runtime, type),
    write = vi.fn(),
    emit = vi.fn().mockResolvedValue(undefined);
  const execute = vi.spyOn(runtime.executor, 'execute').mockResolvedValue(undefined);
  const view = render(
    <UiProvider i18n={i18n}>
      <ComponentProvider
        environment={{
          mediaOrigins: [],
          frameOrigins: [],
          knowledgeOrigins: [],
          features: [],
          now: Date.now,
          ...(scheduleCallback ? { scheduleCallback } : {}),
        }}
      >
        <ActionComponent
          {...component}
          props={{ ...component.props, ...props }}
          node={{ ...component.node, bindings: [{ prop: 'value', variable: 'field' }] }}
          write={write}
          emit={emit}
        />
      </ComponentProvider>
    </UiProvider>,
  );
  return { runtime, write, emit, execute, view };
}
it.each([
  ['nextButton', { type: 'next' }],
  ['backButton', { type: 'back' }],
  ['outcomeSubmit', { type: 'submitOutcome', outcome: 'DONE' }],
  ['transferHint', { type: 'transferHint', target: 'support' }],
])('executes %s through the runtime before publishing the press event', async (type, action) => {
  const f = mount(type);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => {
    expect(f.emit).toHaveBeenCalledWith('onPress');
  });
  expect(f.execute).toHaveBeenCalledWith([action], f.runtime.signal, 'ui:sample');
  expect(f.execute.mock.invocationCallOrder[0]).toBeLessThan(
    f.emit.mock.invocationCallOrder[0] ?? 0,
  );
});
it('renders a plain action, while disabled actions cannot execute', async () => {
  const active = mount('actionButton');
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => {
    expect(active.emit).toHaveBeenCalledWith('onPress');
  });
  expect(active.execute).not.toHaveBeenCalled();
  active.view.unmount();
  const disabled = mount('nextButton', { disabled: true });
  fireEvent.click(screen.getByRole('button'));
  expect(disabled.execute).not.toHaveBeenCalled();
});
it('navigates button-group destinations, supports event-only options and blocks disabled options', async () => {
  const f = mount('buttonGroup', {
    options: [
      { value: 'page', labelKey: 'components.next', page: 'details' },
      { value: 'event', labelKey: 'components.back' },
      { value: 'disabled', labelKey: 'components.submit', disabled: true },
    ],
  });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('components.next') }));
  await waitFor(() => {
    expect(f.execute).toHaveBeenCalledWith(
      [{ type: 'navigate', page: 'details' }],
      f.runtime.signal,
      'ui:sample',
    );
  });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('components.back') }));
  await waitFor(() => {
    expect(f.emit).toHaveBeenCalledTimes(2);
  });
  expect(f.execute).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('components.submit') }));
  expect(f.emit).toHaveBeenCalledTimes(2);
});
it('requires host callback capability and a date, then schedules with the selected timezone and abort signal', async () => {
  const missing = mount('callbackScheduler');
  expect(screen.getByText(i18n.t('components.unavailable'))).toBeDefined();
  expect(screen.getByRole('button').getAttribute('disabled')).not.toBeNull();
  missing.view.unmount();
  const schedule = vi.fn().mockResolvedValue(undefined),
    f = mount('callbackScheduler', { timeZone: 'Europe/Istanbul' }, schedule);
  expect(screen.getByRole('button').getAttribute('disabled')).not.toBeNull();
  fireEvent.change(f.view.container.querySelector('input')!, {
    target: { value: '2026-10-04T14:30' },
  });
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => {
    expect(schedule).toHaveBeenCalledWith({
      scheduledAt: '2026-10-04T14:30',
      timeZone: 'Europe/Istanbul',
      signal: f.runtime.signal,
    });
  });
  await waitFor(() => {
    expect(f.emit).toHaveBeenCalledWith('onPress');
  });
});
it('shows a safe callback failure and recovers after a date change', async () => {
  const schedule = vi
    .fn()
    .mockRejectedValueOnce(new Error('private upstream details'))
    .mockResolvedValue(undefined);
  const f = mount('callbackScheduler', { scheduledAt: '2026-10-04T14:30' }, schedule);
  fireEvent.click(screen.getByRole('button'));
  await screen.findByText(i18n.t('components.invalid'));
  expect(screen.queryByText('private upstream details')).toBeNull();
  expect(f.emit).not.toHaveBeenCalled();
  fireEvent.change(f.view.container.querySelector('input')!, {
    target: { value: '2026-10-04T15:30' },
  });
  expect(screen.queryByText(i18n.t('components.invalid'))).toBeNull();
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => {
    expect(f.emit).toHaveBeenCalledWith('onPress');
  });
  expect(schedule).toHaveBeenCalledTimes(2);
});
it('rejects an invalid initial callback date before reaching the host', async () => {
  const schedule = vi.fn(),
    f = mount('callbackScheduler', { scheduledAt: 'invalid' }, schedule);
  fireEvent.click(screen.getByRole('button'));
  await screen.findByText(i18n.t('components.invalid'));
  expect(schedule).not.toHaveBeenCalled();
  expect(f.emit).not.toHaveBeenCalled();
});
it('persists disposition selection and executes its write-back action, reporting downstream failures safely', async () => {
  const f = mount('dispositionPicker');
  f.execute.mockRejectedValueOnce(new Error('private error'));
  fireEvent.click(screen.getByRole('combobox'));
  fireEvent.click(await screen.findByRole('option', { name: i18n.t('components.sample.first') }));
  await screen.findByText(i18n.t('components.invalid'));
  expect(f.write).toHaveBeenCalledWith('value', 'first');
  expect(f.execute).toHaveBeenCalledWith(
    [{ type: 'setDisposition', code: 'first' }],
    f.runtime.signal,
    'ui:sample',
  );
  expect(screen.queryByText('private error')).toBeNull();
});
