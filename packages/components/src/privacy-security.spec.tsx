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

// ADR-0053: TCKN/VKN/IBAN are typed by the agent, kept as personal data and masked on screen.
async function renderPersonalId(type: string) {
  const runtime = createFixtureRuntime(type);
  runtime.executor.debugger.resume();
  await runtime.start();
  const i18n = await createI18n();
  render(
    <UiProvider i18n={i18n}>
      <ScriptRenderer runtime={runtime} autoStart={false} />
    </UiProvider>,
  );
  return { runtime, i18n, input: screen.getByRole<HTMLInputElement>('textbox') };
}
it('lets the agent type a TCKN, stores digits as personal data and masks it after editing', async () => {
  const { runtime, i18n, input } = await renderPersonalId('tcknInput');
  try {
    expect(screen.queryByText(i18n.t('components.secureUnavailable'))).toBeNull();
    expect(input.autocomplete).toBe('off');
    expect(input.inputMode).toBe('numeric');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '100 000 001 46' } });
    await waitFor(() => {
      expect(runtime.store.variable('field')).toBe('10000000146');
    });
    // Declared public in the fixture, raised to PII by the write.
    expect(runtime.store.classification('field')).toBe('pii');
    expect(input.value).toBe('10000000146');
    fireEvent.blur(input);
    await waitFor(() => {
      expect(input.value).toBe('•••••••0146');
    });
    expect(screen.queryByText(i18n.t('components.invalid'))).toBeNull();
    fireEvent.focus(input);
    expect(input.value).toBe('10000000146');
  } finally {
    runtime.dispose();
  }
});
it('flags an invalid TCKN checksum after editing', async () => {
  const { runtime, i18n, input } = await renderPersonalId('tcknInput');
  try {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '10000000147' } });
    await waitFor(() => {
      expect(runtime.store.variable('field')).toBe('10000000147');
    });
    fireEvent.blur(input);
    expect(await screen.findByText(i18n.t('components.invalid'))).toBeTruthy();
  } finally {
    runtime.dispose();
  }
});
it('normalizes an IBAN typed with spaces and lower case', async () => {
  const { runtime, input } = await renderPersonalId('ibanInput');
  try {
    expect(input.inputMode).toBe('text');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'tr33 0006 1005 1978 6457 8413 26' } });
    await waitFor(() => {
      expect(runtime.store.variable('field')).toBe('TR330006100519786457841326');
    });
    expect(runtime.store.classification('field')).toBe('pii');
  } finally {
    runtime.dispose();
  }
});
it('shows an invalid value message once, as the field error', async () => {
  const { runtime, i18n, input } = await renderPersonalId('tcknInput');
  try {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '12345678901' } });
    fireEvent.blur(input);
    expect(await screen.findAllByText(i18n.t('components.invalid'))).toHaveLength(1);
    expect(input.getAttribute('aria-describedby')).toContain('error');
  } finally {
    runtime.dispose();
  }
});
