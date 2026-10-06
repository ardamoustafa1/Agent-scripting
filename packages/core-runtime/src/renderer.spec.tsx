import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createI18n } from '@verbis/i18n';
import type { NodeInput } from '@verbis/script-schema';
import { UiProvider, Input } from '@verbis/ui';

import { createCoreRegistry, matchesShortcut } from './core-components.js';
import { runtimeFixture } from './fixtures.js';
import { ScriptRenderer } from './renderer.js';
import { Runtime } from './runtime.js';

import type { RendererProps } from './registry.js';

const engines: Runtime[] = [];
afterEach(() => {
  for (const runtime of engines.splice(0)) runtime.dispose();
  vi.useRealTimers();
});
async function mount(
  children: NodeInput[],
  fieldRenderer?: (props: RendererProps) => React.ReactNode,
  ports = {},
) {
  const registry = createCoreRegistry();
  if (fieldRenderer)
    registry.register({
      type: 'textInput',
      renderer: fieldRenderer,
      propsSchema: z.strictObject({ value: z.string().default('') }),
      defaults: {},
      designerMeta: {
        icon: 'Text',
        category: 'field',
        acceptsChildren: [],
        allowedParents: '*',
        draggable: true,
      },
      events: [],
      bindableProps: ['value'],
    });
  const runtime = new Runtime({
    document: runtimeFixture(children),
    registry,
    ports: { sessionEvent: vi.fn(), ...ports },
  });
  engines.push(runtime);
  await runtime.start();
  const i18n = await createI18n();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const view = render(
    <UiProvider i18n={i18n}>
      <ScriptRenderer runtime={runtime} />
    </UiProvider>,
  );
  return { runtime, ...view };
}
describe('shared React renderer', () => {
  it('updates a bound input without rendering an unrelated sibling', async () => {
    const counts = new Map<string, number>();
    const renderer = ({ node, props, write }: RendererProps) => {
      counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
      return (
        <Input
          label={node.id}
          aria-label={node.id}
          value={String(props['value'])}
          onChange={(event) => {
            write('value', event.target.value);
          }}
        />
      );
    };
    const { runtime } = await mount(
      [
        { id: 'input-name', type: 'textInput', bindings: [{ variable: 'name' }] },
        { id: 'input-other', type: 'textInput', bindings: [{ variable: 'other' }] },
      ],
      renderer,
    );
    const before = counts.get('input-other');
    fireEvent.change(screen.getByLabelText('input-name'), { target: { value: 'new' } });
    expect(runtime.store.variable('name')).toBe('new');
    expect(counts.get('input-other')).toBe(before);
  });
  it('honors conditional visibility and enabled state', async () => {
    const { runtime } = await mount([
      {
        id: 'button-run',
        type: 'button',
        props: { labelKey: 'common.run' },
        visibleWhen: { $expr: 'vars.count > 0' },
        enabledWhen: { $expr: 'vars.count > 1' },
      },
    ]);
    expect(screen.queryByRole('button', { name: 'Çalıştır' })).toBeNull();
    act(() => {
      runtime.store.setVariable('count', 1);
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Çalıştır' }).disabled).toBe(true);
    act(() => {
      runtime.store.setVariable('count', 2);
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Çalıştır' }).disabled).toBe(
      false,
    );
  });
  it('isolates a throwing leaf and preserves the rest of the script', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await mount(
        [
          { id: 'bad-leaf', type: 'textInput' },
          { id: 'button-good', type: 'button', props: { labelKey: 'common.run' } },
        ],
        () => {
          throw new Error('synthetic leaf error');
        },
      );
      expect(screen.getByText('Bu bileşen gösterilemedi')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Çalıştır' })).toBeTruthy();
    } finally {
      error.mockRestore();
    }
  });
  it('confirms before running the action chain and blocks duplicate clicks while loading', async () => {
    const command = vi.fn().mockResolvedValue(undefined);
    await mount(
      [
        {
          id: 'button-run',
          type: 'button',
          props: {
            labelKey: 'common.run',
            confirm: { titleKey: 'common.title', descriptionKey: 'common.description' },
          },
          events: { onPress: [{ type: 'setDisposition', code: 'DONE' }] },
        },
      ],
      undefined,
      { command },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Çalıştır' }));
    expect(command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Onayla' }));
    await waitFor(() => {
      expect(command).toHaveBeenCalledTimes(1);
    });
  });
  it('triggers a datasource on load and renders safe failure with retry', async () => {
    const dataSource = vi
      .fn()
      .mockRejectedValueOnce(new Error('synthetic'))
      .mockResolvedValue({ result: 'mapped' });
    const { runtime } = await mount(
      [
        {
          id: 'web-service',
          type: 'webService',
          props: { ds: 'lookup', trigger: 'onLoad', visible: true },
        },
      ],
      undefined,
      { dataSource },
    );
    await waitFor(() => {
      expect(screen.getByText('Veriler yüklenemedi')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    await waitFor(() => {
      expect(runtime.store.variable('name')).toBe('mapped');
    });
  });
  it('supports manual event requests and debounces observed input changes', async () => {
    const dataSource = vi.fn().mockResolvedValue({ result: 'value' });
    const { runtime } = await mount(
      [
        {
          id: 'web-event',
          type: 'webService',
          props: { ds: 'lookup', trigger: 'onEvent', debounceMs: 10 },
        },
      ],
      undefined,
      { dataSource },
    );
    act(() => {
      runtime.request('web-event');
      runtime.request('web-event');
    });
    await waitFor(() => {
      expect(dataSource).toHaveBeenCalledTimes(1);
    });
  });
  it('debounces input changes and suppresses its own mapped-output feedback', async () => {
    const dataSource = vi.fn().mockResolvedValue({ result: 'mapped-output' });
    const { runtime } = await mount(
      [
        {
          id: 'web-watch',
          type: 'webService',
          props: { ds: 'lookup', trigger: 'onChange', watch: ['vars.name'], debounceMs: 10 },
        },
      ],
      undefined,
      { dataSource },
    );
    vi.useFakeTimers();
    act(() => {
      runtime.store.setVariable('name', 'first');
      runtime.store.setVariable('name', 'second');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(runtime.store.variable('name')).toBe('mapped-output');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(dataSource).toHaveBeenCalledTimes(1);
  });
  it('matches exact shortcut modifiers', () => {
    expect(matchesShortcut(new KeyboardEvent('keydown', { key: 'L', altKey: true }), 'Alt+L')).toBe(
      true,
    );
    expect(
      matchesShortcut(
        new KeyboardEvent('keydown', { key: 'L', altKey: true, ctrlKey: true }),
        'Alt+L',
      ),
    ).toBe(false);
  });
});

it('decorates every node in a designer without changing the shared component renderer', async () => {
  const { NodeDecorationContext } = await import('./renderer.js');
  const doc = runtimeFixture([{ id: 'decorated-child', type: 'box' }]);
  const runtime = new Runtime({
    document: doc,
    registry: createCoreRegistry(),
    ports: {
      sessionEvent: () => {
        /* Fixture telemetry. */
      },
    },
    simulation: true,
  });
  engines.push(runtime);
  runtime.store.set('runtime.page', runtime.document.pages[0]?.id ?? '');
  const i18n = await createI18n();
  const { container } = render(
    <UiProvider i18n={i18n}>
      <NodeDecorationContext.Provider
        value={({ node, children }) => <div data-designer-node={node.id}>{children}</div>}
      >
        <ScriptRenderer runtime={runtime} autoStart={false} />
      </NodeDecorationContext.Provider>
    </UiProvider>,
  );
  expect(container.querySelector('[data-designer-node="decorated-child"] .vr-box')).not.toBeNull();
});
it('resets a failed leaf on explicit retry and emits metadata-only focus telemetry', async () => {
  let failed = true;
  const telemetry = vi.fn(),
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const { runtime } = await mount(
      [{ id: 'recoverable', type: 'textInput', bindings: [{ variable: 'name' }] }],
      ({ props, write }) => {
        if (failed) throw new Error('synthetic failure');
        return (
          <Input
            label="Recovered"
            value={String(props['value'])}
            onChange={(event) => {
              write('value', event.target.value);
            }}
          />
        );
      },
      { telemetry },
    );
    expect(screen.getByText('Bu bileşen gösterilemedi')).toBeDefined();
    failed = false;
    act(() => {
      runtime.store.set('runtime.retry.recoverable', 1);
    });
    const input = await screen.findByRole('textbox', { name: 'Recovered' });
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(telemetry).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'field.observed', name: 'recoverable', status: 'success' }),
    );
    input.setAttribute('aria-invalid', 'true');
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(telemetry).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failure' }));
    expect(JSON.stringify(telemetry.mock.calls)).not.toContain('value');
  } finally {
    consoleError.mockRestore();
  }
});
it('renders field validation errors, respects masked expression bindings and closes runtime modals', async () => {
  const { runtime } = await mount(
    [{ id: 'field', type: 'textInput', bindings: [{ prop: 'value', expression: 'vars.name' }] }],
    ({ props }) => <Input label="Expression field" value={String(props['value'])} readOnly />,
  );
  act(() => {
    runtime.store.setVariable('name', 'visible');
    runtime.store.set('runtime.errors.field', ['common.invalid', 'runtime.required', 1]);
  });
  expect(screen.getByRole('textbox').getAttribute('value')).toBe('visible');
  expect(screen.getByText('Geçersiz değer')).toBeDefined();
  expect(screen.getByText('Bu alan zorunludur')).toBeDefined();
  act(() => {
    runtime.store.set('runtime.mask.field', true);
  });
  expect(screen.getByRole('textbox').getAttribute('value')).toBe('');
  act(() => {
    runtime.store.set('runtime.modal', 'second');
  });
  expect(screen.getByRole('dialog')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
  await waitFor(() => {
    expect(runtime.store.get('runtime.modal')).toBeNull();
  });
});
it('reports startup failure safely and never emits an unsupported component event', async () => {
  const runtime = new Runtime({
    document: runtimeFixture(),
    registry: createCoreRegistry(),
    ports: { sessionEvent: vi.fn() },
  });
  engines.push(runtime);
  vi.spyOn(runtime, 'start').mockRejectedValue(new Error('private startup failure'));
  const i18n = await createI18n();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  render(
    <UiProvider i18n={i18n}>
      <ScriptRenderer runtime={runtime} />
    </UiProvider>,
  );
  await screen.findByText('İşlem tamamlanamadı');
  expect(screen.queryByText('private startup failure')).toBeNull();
});

it('enforces readonly bindings and event allowlists even when a component calls its renderer capabilities directly', async () => {
  let captured: RendererProps | undefined;
  const { runtime } = await mount(
    [
      {
        id: 'restricted',
        type: 'textInput',
        enabledWhen: { $expr: 'vars.count > 0' },
        bindings: [{ prop: 'value', expression: 'vars.name' }],
      },
    ],
    (props) => {
      captured = props;
      return <span>Capability fixture</span>;
    },
  );
  if (!captured) throw new Error('Missing renderer capabilities');
  captured.write('value', 'ignored while disabled');
  expect(runtime.store.variable('name')).toBe('');
  act(() => {
    runtime.store.setVariable('count', 1);
  });
  expect(() => {
    captured?.write('value', 'attempted expression write');
  }).toThrow('VERBIS_BINDING_READONLY');
  await expect(captured.emit('unsupported')).rejects.toThrow('VERBIS_COMPONENT_EVENT');
});
it('rejects payment display in ordinary bindings and leaves secure bindings opaque', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const { runtime } = await mount(
      [{ id: 'ordinary', type: 'textInput', bindings: [{ variable: 'name' }] }],
      ({ props }) => <span>{String(props['value'])}</span>,
    );
    act(() => {
      runtime.store.setVariable('name', 'synthetic-payment', 'pci');
    });
    expect(screen.getByText('Bu bileşen gösterilemedi')).toBeDefined();
    expect(screen.queryByText('synthetic-payment')).toBeNull();
  } finally {
    consoleError.mockRestore();
  }
});
it('tracks expression-bound datasource dependencies and required field conditions', async () => {
  const { runtime } = await mount(
    [
      {
        id: 'source',
        type: 'webService',
        props: { visible: true, trigger: 'manual', emptyWhen: { $expr: 'vars.count == 0' } },
        bindings: [{ prop: 'ds', expression: '"lookup"' }],
      },
      { id: 'required-field', type: 'textInput', requiredWhen: { $expr: 'vars.count > 0' } },
    ],
    ({ required }) => <span>{required ? 'Required fixture' : 'Optional fixture'}</span>,
  );
  expect(screen.getByText('Optional fixture')).toBeDefined();
  act(() => {
    runtime.store.setVariable('count', 1);
  });
  expect(screen.getByText('Required fixture')).toBeDefined();
});
