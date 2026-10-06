import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { type Runtime } from '@verbis/core-runtime';
import { createI18n, type I18nInstance } from '@verbis/i18n';
import { UiProvider } from '@verbis/ui';

import { LIBRARY_DEFINITIONS } from './catalog.js';
import * as components from './components.js';
import { ComponentProvider } from './environment.js';
import { createFixtureRuntime, syntheticRendererProps } from './test-fixtures.js';

let i18n: I18nInstance;
const runtimes: Runtime[] = [];
beforeAll(async () => {
  i18n = await createI18n('tr');
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  runtimes.splice(0).forEach((runtime) => {
    runtime.dispose();
  });
});
describe.each(Object.entries(components))('public %s component', (name, Component) => {
  it('renders its declared component even when the incoming node type differs', () => {
    const definition = LIBRARY_DEFINITIONS.find(
      (entry) => entry.type.toLowerCase() === name.toLowerCase(),
    );
    expect(definition, 'Each public renderer must have a catalog contract').toBeDefined();
    const runtime = createFixtureRuntime(definition!.type);
    runtimes.push(runtime);
    const props = syntheticRendererProps(runtime, definition!.type);
    render(
      <UiProvider i18n={i18n}>
        <ComponentProvider
          environment={{
            mediaOrigins: [],
            frameOrigins: [],
            knowledgeOrigins: [],
            features: ['signature'],
            now: Date.now,
          }}
        >
          <Component {...props} node={{ ...props.node, type: 'box' }} />
        </ComponentProvider>
      </UiProvider>,
    );
    expect(screen.queryByText('Bu bileşen gösterilemedi')).toBeNull();
    expect(document.querySelector('#sample.vr-box, #sample-container.vr-box')).not.toBeNull();
  });
});
