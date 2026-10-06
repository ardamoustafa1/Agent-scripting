import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { ScriptRenderer } from '@verbis/core-runtime';
import { createI18n } from '@verbis/i18n';
import { UiProvider } from '@verbis/ui';

import { LIBRARY_DEFINITIONS } from './catalog.js';
import { createFixtureRuntime } from './test-fixtures.js';

it.each(LIBRARY_DEFINITIONS)(
  '$type renders its declared foundation instead of category-derived metadata',
  async (definition) => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const runtime = createFixtureRuntime(definition.type);
    runtime.executor.debugger.resume();
    await runtime.start();
    const i18n = await createI18n();
    const view = render(
      <UiProvider i18n={i18n}>
        <ScriptRenderer runtime={runtime} />
      </UiProvider>,
    );
    try {
      expect(
        view.container.querySelector('#sample.vr-box, #sample-container.vr-box'),
      ).not.toBeNull();
      if (definition.builtOn.includes('webService'))
        expect(view.container.querySelector('#sample-service')).not.toBeNull();
      // Configuration-dependent buttons are capabilities, never claimed as always-rendered primitives.
      expect(definition.builtOn).not.toContain('button');
      expect(definition.conditionalBuiltOn.every((type) => type === 'button')).toBe(true);
    } finally {
      view.unmount();
      runtime.dispose();
    }
  },
);
