import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';

import { Runtime, ScriptRenderer } from '@verbis/core-runtime';
import { createI18n } from '@verbis/i18n';
import { ScriptDocumentSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';
import { UiProvider } from '@verbis/ui';

import { createComponentRegistry } from './catalog.js';

beforeEach(() =>
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);
afterEach(() => vi.unstubAllGlobals());

it('evaluates bound ICU parameters reactively and escapes values as text', async () => {
  const document = ScriptDocumentSchema.parse(minimalScript());
  document.variables.push({
    key: 'customer',
    type: 'string',
    scope: 'session',
    classification: 'internal',
    pii: false,
    persist: false,
    default: 'Synthetic customer',
  });
  document.i18n.messages['tr']!['synthetic.greeting'] = 'Merhaba {name}';
  document.pages[0]!.layout.children = [
    {
      id: 'synthetic-text',
      type: 'scriptText',
      props: { textKey: 'synthetic.greeting' },
      bindings: [{ prop: 'params', expression: '{ name: vars.customer }' }],
      events: {},
      style: { base: {} },
    },
  ];
  const runtime = new Runtime({
    document,
    registry: createComponentRegistry(),
    simulation: true,
    ports: { sessionEvent: () => undefined },
  });
  runtime.store.set('runtime.page', 'home');
  const view = render(
    <UiProvider i18n={await createI18n('tr')}>
      <ScriptRenderer runtime={runtime} autoStart={false} />
    </UiProvider>,
  );
  try {
    expect(screen.getByText('Merhaba Synthetic customer')).toBeTruthy();
    act(() => {
      runtime.store.setVariable('customer', '<img src=x onerror=alert(1)>');
    });
    expect(screen.getByText('Merhaba <img src=x onerror=alert(1)>')).toBeTruthy();
    expect(view.container.querySelector('img')).toBeNull();
  } finally {
    view.unmount();
    runtime.dispose();
  }
});
it('loads select options from a bound source and writes the chosen value', async () => {
  const document = ScriptDocumentSchema.parse(minimalScript());
  document.variables.push(
    {
      key: 'choices',
      type: 'array',
      scope: 'session',
      classification: 'internal',
      pii: false,
      persist: false,
      default: [{ value: 'synthetic', labelKey: 'common.next' }],
    },
    {
      key: 'selected',
      type: 'string',
      scope: 'session',
      classification: 'internal',
      pii: false,
      persist: false,
      default: '',
    },
  );
  document.pages[0]!.layout.children = [
    {
      id: 'synthetic-select',
      type: 'select',
      props: { labelKey: 'common.next' },
      bindings: [
        { prop: 'options', expression: 'vars.choices' },
        { prop: 'value', variable: 'selected' },
      ],
      events: {},
      style: { base: {} },
    },
  ];
  const runtime = new Runtime({
    document,
    registry: createComponentRegistry(),
    simulation: true,
    ports: { sessionEvent: () => undefined },
  });
  runtime.store.set('runtime.page', 'home');
  const view = render(
    <UiProvider i18n={await createI18n('tr')}>
      <ScriptRenderer runtime={runtime} autoStart={false} />
    </UiProvider>,
  );
  try {
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'İleri' }));
    expect(runtime.store.variable('selected')).toBe('synthetic');
  } finally {
    view.unmount();
    runtime.dispose();
  }
});
