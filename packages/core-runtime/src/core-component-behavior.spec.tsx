import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import { createI18n, type I18nInstance } from '@verbis/i18n';
import { NodeSchema } from '@verbis/script-schema';
import { UiProvider } from '@verbis/ui';

import { Box, Button, createCoreRegistry, WebService } from './core-components.js';
import { runtimeFixture } from './fixtures.js';
import { RuntimeProblem } from './problem.js';
import { Runtime } from './runtime.js';

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
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function fixture(type: string) {
  const runtime = new Runtime({
    document: runtimeFixture(),
    registry: createCoreRegistry(),
    ports: { sessionEvent: vi.fn() },
  });
  engines.push(runtime);
  const execute = vi.spyOn(runtime.executor, 'execute').mockResolvedValue(undefined),
    emit = vi.fn().mockResolvedValue(undefined),
    write = vi.fn();
  return {
    runtime,
    execute,
    emit,
    write,
    node: NodeSchema.parse({ id: 'synthetic', type }),
    props: {},
    enabled: true,
    required: false,
  };
}
it.each(['onLoad', 'onEnter'])(
  'runs %s services immediately and reports success once',
  async (trigger) => {
    const f = fixture('webService');
    render(
      <UiProvider i18n={i18n}>
        <WebService {...f} props={{ ds: 'lookup', trigger }} />
      </UiProvider>,
    );
    await waitFor(() => {
      expect(f.emit).toHaveBeenCalledExactlyOnceWith('onSuccess');
    });
    expect(f.execute).toHaveBeenCalledWith(
      [{ type: 'callDataSource', dataSource: 'lookup' }],
      expect.any(AbortSignal),
      'ui:source:synthetic',
    );
  },
);
it('debounces watched changes and ignores writes originating from the same datasource', async () => {
  vi.useFakeTimers();
  const f = fixture('webService');
  const view = render(
    <UiProvider i18n={i18n}>
      <WebService
        {...f}
        props={{ ds: 'lookup', trigger: 'onChange', watch: ['vars.name'], debounceMs: 100 }}
      />
    </UiProvider>,
  );
  act(() => {
    f.runtime.store.setVariable('name', 'first');
    f.runtime.store.setVariable('name', 'second');
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(99);
  });
  expect(f.execute).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(f.execute).toHaveBeenCalledOnce();
  act(() => {
    f.runtime.store.batch(() => {
      f.runtime.store.setVariable('name', 'mapped output');
    }, 'dataSource.lookup');
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(f.execute).toHaveBeenCalledOnce();
  view.unmount();
  act(() => {
    f.runtime.store.setVariable('name', 'after unmount');
  });
  await vi.advanceTimersByTimeAsync(100);
  expect(f.execute).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it.each(['onEvent', 'interval'])(
  'runs %s services only on their trigger and clears timers on unmount',
  async (trigger) => {
    vi.useFakeTimers();
    const f = fixture('webService'),
      view = render(
        <UiProvider i18n={i18n}>
          <WebService {...f} props={{ ds: 'lookup', trigger, intervalMs: 1000, debounceMs: 10 }} />
        </UiProvider>,
      );
    expect(f.execute).not.toHaveBeenCalled();
    act(() => {
      f.runtime.store.set('runtime.request.synthetic', 1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(trigger === 'onEvent' ? 10 : 1000);
    });
    expect(f.execute).toHaveBeenCalledOnce();
    view.unmount();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.execute).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  },
);
it('renders loading, empty and retry states without exposing datasource errors', async () => {
  const f = fixture('webService');
  f.runtime.store.set('ds.lookup', { status: 'loading' });
  const view = render(
    <UiProvider i18n={i18n}>
      <WebService {...f} props={{ ds: 'lookup', trigger: 'manual', visible: true }} />
    </UiProvider>,
  );
  expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(screen.getByRole('button').getAttribute('disabled')).not.toBeNull();
  f.runtime.store.set('ds.lookup', { status: 'error', error: 'private upstream failure' });
  view.rerender(
    <UiProvider i18n={i18n}>
      <WebService {...f} props={{ ds: 'lookup', trigger: 'manual', visible: true }} />
    </UiProvider>,
  );
  expect(screen.queryByText('private upstream failure')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('runtime.retry') }));
  await waitFor(() => {
    expect(f.emit).toHaveBeenCalledWith('onSuccess');
  });
  f.runtime.store.set('ds.lookup', { status: 'success' });
  view.rerender(
    <UiProvider i18n={i18n}>
      <WebService
        {...f}
        props={{ ds: 'lookup', trigger: 'manual', visible: true, emptyWhen: { $expr: 'true' } }}
      />
    </UiProvider>,
  );
  expect(screen.getByText(i18n.t('runtime.empty'))).toBeDefined();
});
it('emits an error for a failed request while suppressing canceled and superseded results', async () => {
  const f = fixture('webService');
  f.execute
    .mockRejectedValueOnce(new Error('synthetic error'))
    .mockRejectedValueOnce(new RuntimeProblem('VERBIS_RUNTIME_CANCELLED'));
  render(
    <UiProvider i18n={i18n}>
      <WebService {...f} props={{ ds: 'lookup', trigger: 'manual', visible: true }} />
    </UiProvider>,
  );
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => {
    expect(f.emit).toHaveBeenCalledExactlyOnceWith('onError');
  });
  fireEvent.click(screen.getByRole('button'));
  await act(async () => {
    await Promise.resolve();
  });
  expect(f.emit).toHaveBeenCalledOnce();
});
it('aborts an older request and publishes only the newest response', async () => {
  const f = fixture('webService');
  let finish: (() => void) | undefined;
  f.execute.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <UiProvider i18n={i18n}>
      <WebService {...f} props={{ ds: 'lookup', trigger: 'manual', visible: true }} />
    </UiProvider>,
  );
  fireEvent.click(screen.getByRole('button'));
  const firstSignal = f.execute.mock.calls[0]?.[1];
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => {
    expect(f.emit).toHaveBeenCalledExactlyOnceWith('onSuccess');
  });
  expect(firstSignal?.aborted).toBe(true);
  await act(async () => {
    finish?.();
    await Promise.resolve();
  });
  expect(f.emit).toHaveBeenCalledOnce();
});
it('never executes disabled service requests', async () => {
  const f = fixture('webService');
  render(
    <UiProvider i18n={i18n}>
      <WebService
        {...f}
        enabled={false}
        props={{ ds: 'lookup', trigger: 'onLoad', visible: true }}
      />
    </UiProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(f.execute).not.toHaveBeenCalled();
  expect(screen.queryByRole('button')).toBeNull();
});
it('respects shortcut contexts, ignores repeated/composing keys, and locks an active button invocation', async () => {
  const f = fixture('button');
  f.node.a11y = { shortcut: 'Ctrl+K' };
  let finish: (() => void) | undefined;
  f.emit.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(
    <UiProvider i18n={i18n}>
      <Button {...f} props={{ labelKey: 'common.run', iconKey: 'check' }} />
      <input aria-label="Typing" />
    </UiProvider>,
  );
  for (const extra of [{ repeat: true }, { isComposing: true }])
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true, ...extra });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'k', ctrlKey: true });
  expect(f.emit).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  expect(f.emit).toHaveBeenCalledOnce();
  view.unmount();
  await act(async () => {
    finish?.();
    await Promise.resolve();
  });
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  expect(f.emit).toHaveBeenCalledOnce();
});
it('confirms or cancels an action explicitly and renders grid accessibility labels', async () => {
  const f = fixture('button');
  const view = render(
    <UiProvider i18n={i18n}>
      <Button
        {...f}
        props={{
          labelKey: 'common.run',
          confirm: { titleKey: 'common.title', descriptionKey: 'common.description' },
        }}
      />
    </UiProvider>,
  );
  fireEvent.click(screen.getByRole('button'));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('runtime.cancel') }));
  expect(f.emit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button'));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('runtime.confirm') }));
  await waitFor(() => {
    expect(f.emit).toHaveBeenCalledOnce();
  });
  view.unmount();
  const box = fixture('box');
  box.node.a11y = { labelKey: 'common.name' };
  render(
    <UiProvider i18n={i18n}>
      <Box
        {...box}
        props={{ as: 'section', grid: 2, role: 'region', align: 'center', justify: 'between' }}
      >
        Synthetic content
      </Box>
    </UiProvider>,
  );
  expect(screen.getByRole('region', { name: 'Ad' }).tagName).toBe('SECTION');
});
