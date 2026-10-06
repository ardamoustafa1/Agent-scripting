import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { ScriptRenderer } from '@verbis/core-runtime';
import { createI18n } from '@verbis/i18n';
import { UiProvider } from '@verbis/ui';

import { ComponentProvider } from './environment.js';
import { SecureInput } from './inputs.js';
import { PrivacySchema } from './privacy.js';
import { createFixtureRuntime, syntheticRendererProps } from './test-fixtures.js';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

it('consent is optional, initially false, and notification is a separate component', async () => {
  expect(PrivacySchema.parse({}).value).toBe(false);
  const runtime = createFixtureRuntime('explicitConsent');
  try {
    runtime.executor.debugger.resume();
    await runtime.start();
    const i18n = await createI18n();
    render(
      <UiProvider i18n={i18n}>
        <ScriptRenderer runtime={runtime} autoStart={false} />
      </UiProvider>,
    );
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Rıza isteğe bağlıdır ve geri alınabilir.')).toBeTruthy();
  } finally {
    runtime.dispose();
  }
});
it('secure fields fail closed and never render a parent password/PAN input', async () => {
  const runtime = createFixtureRuntime('creditCardInput');
  try {
    runtime.executor.debugger.resume();
    await runtime.start();
    const i18n = await createI18n();
    const { container } = render(
      <UiProvider i18n={i18n}>
        <ScriptRenderer runtime={runtime} autoStart={false} />
      </UiProvider>,
    );
    expect(container.querySelector('input')).toBeNull();
    expect(runtime.store.variable('field')).toBe('');
  } finally {
    runtime.dispose();
  }
});

it('accepts only the exact hosted frame origin/source/challenge and keeps token values outside parent runtime', async () => {
  const runtime = createFixtureRuntime('creditCardInput'),
    confirmReceipt = vi.fn().mockResolvedValue(undefined);
  try {
    const i18n = await createI18n();
    const { container } = render(
      <UiProvider i18n={i18n}>
        <ComponentProvider
          environment={{
            mediaOrigins: [],
            frameOrigins: [],
            knowledgeOrigins: [],
            features: [],
            now: Date.now,
            secureCapture: {
              url: 'https://psp.example.test/capture',
              origin: 'https://psp.example.test',
              sessionId: 'session-test',
              confirmReceipt,
            },
          }}
        >
          <SecureInput {...syntheticRendererProps(runtime, 'creditCardInput')} />
        </ComponentProvider>
      </UiProvider>,
    );
    const frame = container.querySelector('iframe');
    if (!frame) throw new Error('Missing hosted capture frame');
    expect(container.querySelector('input')).toBeNull();
    const challenge = new URL(frame.src).searchParams.get('challenge');
    const data = {
      type: 'verbis.secure.receipt',
      sessionId: 'session-test',
      variable: 'field',
      challenge,
      receipt: 'tok_' + 'a'.repeat(32),
    };
    const dispatch = (origin: string, source: Window | null, payload: unknown) => {
      fireEvent(window, new MessageEvent('message', { origin, source, data: payload }));
    };
    dispatch('https://attacker.test', frame.contentWindow, data);
    dispatch('https://psp.example.test', window, data);
    dispatch('https://psp.example.test', frame.contentWindow, { ...data, challenge: 'wrong' });
    dispatch('https://psp.example.test', frame.contentWindow, {
      ...data,
      cardNumber: '4111111111111111',
    });
    expect(confirmReceipt).not.toHaveBeenCalled();
    dispatch('https://psp.example.test', frame.contentWindow, data);
    await waitFor(() => {
      expect(confirmReceipt).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(runtime.store.variable('field')).toBe('[TOKENIZED]');
    });
    expect(JSON.stringify(runtime.store.checkpoint())).not.toContain(data.receipt);
    expect(JSON.stringify(runtime.store.checkpoint())).not.toContain('4111111111111111');
    const node = {
      ...syntheticRendererProps(runtime, 'creditCardInput').node,
      props: { required: true },
    };
    expect(await runtime.validation.field(node)).toEqual([]);
  } finally {
    runtime.dispose();
  }
});

it('reports hosted receipt refusal safely and accepts only one receipt per mounted challenge', async () => {
  const runtime = createFixtureRuntime('creditCardInput'),
    i18n = await createI18n(),
    confirmReceipt = vi.fn().mockRejectedValue(new Error('private provider failure'));
  try {
    const view = render(
      <UiProvider i18n={i18n}>
        <ComponentProvider
          environment={{
            mediaOrigins: [],
            frameOrigins: [],
            knowledgeOrigins: [],
            features: [],
            now: Date.now,
            secureCapture: {
              url: 'https://psp.example.test/capture',
              origin: 'https://psp.example.test',
              sessionId: 'synthetic',
              confirmReceipt,
            },
          }}
        >
          <SecureInput {...syntheticRendererProps(runtime, 'creditCardInput')} />
        </ComponentProvider>
      </UiProvider>,
    );
    const frame = view.container.querySelector('iframe');
    if (!frame) throw new Error('Missing capture frame');
    const receipt = {
      type: 'verbis.secure.receipt',
      challenge: new URL(frame.src).searchParams.get('challenge'),
      sessionId: 'synthetic',
      variable: 'field',
      receipt: 'tok_' + 'a'.repeat(32),
    };
    for (let count = 0; count < 2; count += 1)
      fireEvent(
        window,
        new MessageEvent('message', {
          origin: 'https://psp.example.test',
          source: frame.contentWindow,
          data: receipt,
        }),
      );
    await screen.findByText(i18n.t('components.secureFailed'));
    expect(confirmReceipt).toHaveBeenCalledOnce();
    expect(runtime.store.variable('field')).toBe('');
    expect(screen.queryByText('private provider failure')).toBeNull();
  } finally {
    runtime.dispose();
  }
});
it.each(['disabled', 'unbound'])(
  'fails secure capture closed for a %s field even with a provisioned provider',
  async (mode) => {
    const runtime = createFixtureRuntime('creditCardInput'),
      i18n = await createI18n(),
      component = syntheticRendererProps(runtime, 'creditCardInput'),
      confirmReceipt = vi.fn();
    try {
      const view = render(
        <UiProvider i18n={i18n}>
          <ComponentProvider
            environment={{
              mediaOrigins: [],
              frameOrigins: [],
              knowledgeOrigins: [],
              features: [],
              now: Date.now,
              secureCapture: {
                url: 'https://psp.example.test/capture',
                origin: 'https://psp.example.test',
                sessionId: 'synthetic',
                confirmReceipt,
              },
            }}
          >
            <SecureInput
              {...component}
              enabled={mode !== 'disabled'}
              node={{
                ...component.node,
                bindings: mode === 'unbound' ? [] : component.node.bindings,
              }}
            />
          </ComponentProvider>
        </UiProvider>,
      );
      expect(view.container.querySelector('iframe')).toBeNull();
      expect(screen.getByText(i18n.t('components.secureUnavailable'))).toBeDefined();
      expect(confirmReceipt).not.toHaveBeenCalled();
    } finally {
      runtime.dispose();
    }
  },
);

it('writes optional consent through the ordinary field boundary without preselecting it', async () => {
  const runtime = createFixtureRuntime('explicitConsent');
  try {
    runtime.executor.debugger.resume();
    await runtime.start();
    const i18n = await createI18n();
    render(
      <UiProvider i18n={i18n}>
        <ScriptRenderer runtime={runtime} autoStart={false} />
      </UiProvider>,
    );
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(runtime.store.variable('field')).toBe(true);
    fireEvent.click(checkbox);
    expect(runtime.store.variable('field')).toBe(false);
  } finally {
    runtime.dispose();
  }
});
