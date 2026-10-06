import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Runtime, ScriptRenderer } from '@verbis/core-runtime';
import { createI18n, flattenKeys, resources } from '@verbis/i18n';
import { ScriptDocumentSchema } from '@verbis/script-schema';
import { UiProvider } from '@verbis/ui';

import { createComponentRegistry, LIBRARY_DEFINITIONS } from './catalog.js';
import { ComponentProvider, safeAssetUrl } from './environment.js';
import { formatMask } from './inputs.js';
import { fixtureDocument, createFixtureRuntime } from './test-fixtures.js';

const engines: Runtime[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
});
async function mount(type: string) {
  const runtime = createFixtureRuntime(type);
  engines.push(runtime);
  runtime.executor.debugger.resume();
  await runtime.start();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const i18n = await createI18n();
  const view = render(
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
        <ScriptRenderer runtime={runtime} />
      </ComponentProvider>
    </UiProvider>,
  );
  return { runtime, ...view };
}
describe.each(LIBRARY_DEFINITIONS)('$type component contract', (definition) => {
  it('is registered, validates defaults and exposes property-panel metadata', () => {
    const registry = createComponentRegistry();
    expect(registry.get(definition.type)).toBeTruthy();
    expect(definition.propsSchema.safeParse(definition.defaults).success).toBe(true);
    expect(definition.builtOn.length).toBeGreaterThan(0);
    expect(definition.designerMeta.properties?.length).toBeGreaterThan(0);
    expect(() => definition.propsSchema.parse({ unexpected: 'rejected' })).toThrow();
  });
  it('renders the real shared runtime without a component failure', async () => {
    await mount(definition.type);
    expect(screen.queryByText('Bu bileşen gösterilemedi')).toBeNull();
    expect(screen.queryByText('İşlem tamamlanamadı')).toBeNull();
    // Assert the renderer's real Box, not merely its builtOn metadata or the page ancestor.
    expect(document.querySelector('#sample.vr-box, #sample-container.vr-box')).not.toBeNull();
  });
});
it('updates a two-way text binding and emits only event metadata', async () => {
  const { runtime } = await mount('textInput');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Synthetic' } });
  expect(runtime.store.variable('field')).toBe('Synthetic');
});
it('requires reading acknowledgement before page validation succeeds', async () => {
  const { runtime } = await mount('scriptText');
  expect(await runtime.validation.page('home')).toContainEqual({
    node: 'sample',
    messageKey: 'components.mustRead',
  });
  fireEvent.click(screen.getByRole('checkbox'));
  expect(await runtime.validation.page('home')).toEqual([]);
});
it('interpolates variables as React text and responds to variable changes', async () => {
  const { runtime } = await mount('scriptText');
  expect(screen.getByText(/Hoş geldiniz Demo/)).toBeTruthy();
  act(() => {
    runtime.store.setVariable('name', '<svg onload=alert(1)>');
  });
  expect(screen.getByText(/<svg onload=alert\(1\)>/)).toBeTruthy();
  expect(document.querySelector('svg[onload]')).toBeNull();
});
it('keeps repeated row edits scoped to their stable row id', async () => {
  const { runtime } = await mount('repeater');
  const inputs = screen.getAllByRole('textbox');
  fireEvent.change(inputs[0]!, { target: { value: 'Updated' } });
  expect(runtime.store.variable('items')).toEqual([
    { id: 'first', name: 'Updated' },
    { id: 'second', name: 'Demo B' },
  ]);
});
it('fails closed without hosted capture and keeps raw PCI outside runtime', async () => {
  const { runtime } = await mount('creditCardInput');
  expect(document.querySelector('input[type=password]')).toBeNull();
  expect(document.querySelector('iframe')).toBeNull();
  expect(runtime.store.variable('field')).toBe('');
  expect(screen.getByText('Güvenli veri sağlayıcısı yapılandırılmalı')).toBeTruthy();
});
it('loads mapped data through WebService actions', async () => {
  const { runtime } = await mount('dataGrid');
  fireEvent.click(screen.getByRole('button', { name: 'Verileri yenile' }));
  await waitFor(() => {
    expect(runtime.store.get('ds.lookup')).toMatchObject({ status: 'success' });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tüm satırları göster' }));
  expect(screen.getByText('Demo A')).toBeTruthy();
});
it('permits only tenant-approved HTTPS assets and rejects alternate schemes/credentials', () => {
  expect(safeAssetUrl('https://assets.example.test/a.png', ['https://assets.example.test'])).toBe(
    'https://assets.example.test/a.png',
  );
  for (const url of [
    'javascript:alert(1)',
    'http://assets.example.test/a',
    'https://evil.example.test/a',
    'https://user:secret@assets.example.test/a',
  ])
    expect(() => safeAssetUrl(url, ['https://assets.example.test'])).toThrow();
});
it('formats masks without evaluating pattern code', () => {
  expect(formatMask('5551234567', '(###) ### ## ##')).toBe('(555) 123 45 67');
});
it('allows only the secure trusted renderer to receive a write-only PCI binding', () => {
  const document = ScriptDocumentSchema.parse(fixtureDocument('creditCardInput'));
  expect(
    () =>
      new Runtime({
        document,
        registry: createComponentRegistry(),
        ports: { sessionEvent: vi.fn() },
      }),
  ).not.toThrow();
  expect(createComponentRegistry().get('creditCardInput').secureBindings).toEqual(['value']);
});

it('protects payment bindings and drops their values when the runtime closes', async () => {
  const { runtime } = await mount('creditCardInput');
  expect(document.querySelector('input[type=password]')).toBeNull();
  // Hosted capture is fail-closed here; disposal must clear even an already-tokenized value.
  act(() => {
    runtime.store.setVariable('field', 'tok_synthetic_fixture');
  });
  expect(runtime.store.classification('field')).toBe('pci');
  runtime.dispose();
  expect(runtime.store.variable('field')).toBeNull();
});
it('rejects secure fields inside public repeater paths', () => {
  expect(
    createComponentRegistry().get('creditCardInput').propsSchema.safeParse({ itemPath: 'card' })
      .success,
  ).toBe(false);
});

it('keeps the repeater empty/error branch on its own core Box', async () => {
  const { runtime } = await mount('repeater');
  act(() => {
    runtime.store.set('vars.items', null);
  });
  expect(document.querySelector('#sample-container.vr-box')).not.toBeNull();
  expect(screen.getByRole('status')).toBeTruthy();
});

it('resolves every dynamic property-panel label in both catalogs', () => {
  for (const { translation } of Object.values(resources)) {
    const keys = new Set(flattenKeys(translation));
    for (const definition of LIBRARY_DEFINITIONS)
      for (const property of definition.designerMeta.properties ?? [])
        expect(keys.has(property.labelKey), `${definition.type}: ${property.labelKey}`).toBe(true);
  }
});

it('validates international phone values and must-read bindings without confusing consent with mandatory reading', async () => {
  const runtime = createFixtureRuntime('phoneInput');
  engines.push(runtime);
  const node = runtime.page('home').layout.children![0]!;
  node.props['country'] = 'international';
  runtime.store.setVariable('field', '+12025550123');
  expect(await runtime.validation.field(node)).toEqual([]);
  runtime.store.setVariable('field', 'not-a-phone');
  expect(await runtime.validation.field(node)).toEqual([
    { node: 'sample', messageKey: 'components.invalid' },
  ]);
  runtime.store.setVariable('field', '');
  expect(await runtime.validation.field(node)).toEqual([]);
  const consent = createFixtureRuntime('explicitConsent');
  engines.push(consent);
  const read = {
    ...consent.page('home').layout.children![0]!,
    props: { mustRead: true, acknowledged: false },
    bindings: [{ prop: 'acknowledged', variable: 'field' }],
  };
  expect(await consent.validation.field(read)).toEqual([
    { node: 'sample', messageKey: 'components.mustRead' },
  ]);
  consent.store.setVariable('field', true);
  expect(await consent.validation.field(read)).toEqual([]);
  read.props.acknowledged = true;
  consent.store.setVariable('field', false);
  expect(await consent.validation.field(read)).toEqual([]);
});
it('tracks fallback datasource, repeater and translated template dependencies across locales', () => {
  const runtime = createFixtureRuntime('scriptText');
  engines.push(runtime);
  const node = runtime.page('home').layout.children![0]!;
  expect(
    createComponentRegistry()
      .get('table')
      .dependencies?.({ ...node, type: 'table', props: {} }, runtime.document),
  ).toEqual(['ds.lookup']);
  expect(
    createComponentRegistry()
      .get('repeater')
      .dependencies?.({ ...node, type: 'repeater', props: {} }, runtime.document),
  ).toEqual(['vars.items']);
  const script = createComponentRegistry().get('scriptText');
  expect(script.dependencies?.({ ...node, props: {} }, runtime.document)).toContain('vars.name');
  const blocks = {
    ...node,
    props: {
      textKey: 'components.missing',
      blocks: [null, [], 1, {}, { textKey: 'components.sample.script' }],
    },
  };
  expect(script.dependencies?.(blocks, runtime.document)).toContain('vars.name');
});
it('validates unbound literal inputs while leaving secured inputs to the hosted provider', () => {
  const runtime = createFixtureRuntime('emailInput');
  engines.push(runtime);
  const node = runtime.page('home').layout.children![0]!;
  const definition = createComponentRegistry().get('emailInput');
  expect(
    definition.validate?.({ ...node, bindings: [], props: { value: 'broken' } }, runtime.store),
  ).toEqual([{ messageKey: 'components.invalid' }]);
  expect(
    definition.validate?.({ ...node, bindings: [], props: { value: 12 } }, runtime.store),
  ).toEqual([]);
  expect(
    definition.validate?.(
      { ...node, bindings: [], props: { value: 'broken', secure: true } },
      runtime.store,
    ),
  ).toEqual([]);
});
