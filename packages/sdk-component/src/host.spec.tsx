import { createHash, webcrypto } from 'node:crypto';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { Runtime, createCoreRegistry, type RendererProps } from '@verbis/core-runtime';
import { createI18n } from '@verbis/i18n';
import { minimalScript } from '@verbis/script-schema/fixtures';
import { UiProvider } from '@verbis/ui';

import { ComponentPluginHost, registerComponent, type PluginDescriptor } from './host.js';
import { PluginManifestSchema } from './protocol.js';

const bytes = new TextEncoder().encode('export {};');
const manifest = PluginManifestSchema.parse({
  type: 'acme.demo',
  version: '1.0.0',
  integrity: `sha384-${createHash('sha384').update(bytes).digest('base64')}`,
  builtOn: ['box'],
  permissions: { props: ['value'], write: ['value'], events: ['onPress'] },
});
const descriptor: PluginDescriptor = {
  manifest,
  propsSchema: z.strictObject({ value: z.string(), labelKey: z.string().optional() }),
  defaults: { value: 'demo' },
  designerMeta: {
    icon: 'box',
    category: 'plugins',
    acceptsChildren: [],
    allowedParents: '*',
    draggable: true,
  },
};
const tenantId = '01928f3a-0000-7000-8000-0000000000ff';
const approval = {
  tenantId,
  type: manifest.type,
  version: manifest.version,
  integrity: manifest.integrity,
  enabled: true,
  bundleUrl: 'https://assets.example.test/a.js',
  approvedOrigins: ['https://assets.example.test'],
  expiresAt: 10_000,
};
class FakePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
  start = vi.fn();
}
class FakeChannel {
  static instances: FakeChannel[] = [];
  port1 = new FakePort();
  port2 = new FakePort();
  constructor() {
    FakeChannel.instances.push(this);
  }
}
const runtimes: Runtime[] = [];
afterEach(() => {
  runtimes.forEach((runtime) => {
    runtime.dispose();
  });
  runtimes.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function fixture(
  options: { locale?: 'tr' | 'en'; private?: boolean; label?: boolean; fetchError?: boolean } = {},
) {
  FakeChannel.instances = [];
  vi.stubGlobal('MessageChannel', FakeChannel);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'fetch',
    options.fetchError
      ? vi.fn().mockRejectedValue(new Error('offline'))
      : vi
          .fn()
          .mockResolvedValue(
            new Response(bytes, { headers: { 'content-type': 'application/javascript' } }),
          ),
  );
  const resolve = vi.fn().mockResolvedValue(approval);
  const host = new ComponentPluginHost(tenantId, { resolve }, () => 1000);
  const registry = createCoreRegistry();
  await registerComponent(host, registry, descriptor);
  const document = minimalScript();
  document.variables = [
    { key: 'value', type: 'string', scope: 'session', default: 'demo', classification: 'public' },
  ];
  const runtime = new Runtime({
    document,
    registry: createCoreRegistry(),
    ports: { sessionEvent: vi.fn() },
  });
  runtimes.push(runtime);
  if (options.private) runtime.store.setVariable('value', 'private', 'pii');
  runtime.store.setLocale(options.locale ?? 'tr');
  const node = runtime.page('home').layout;
  node.bindings = [{ prop: 'value', variable: 'value' }];
  const component: RendererProps = {
    runtime,
    node,
    props: { value: 'demo', ...(options.label ? { labelKey: 'home.title' } : {}) },
    enabled: true,
    required: false,
    emit: vi.fn().mockResolvedValue(undefined),
    write: vi.fn(),
  };
  const Renderer = registry.get(manifest.type).renderer;
  const i18n = await createI18n();
  const view = render(
    <UiProvider i18n={i18n}>
      <Renderer {...component} />
    </UiProvider>,
  );
  return { host, resolve, registry, component, Renderer, view, i18n };
}
async function frame() {
  const iframe = await screen.findByTitle('acme.demo');
  expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
  expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(iframe.getAttribute('srcdoc')).toContain("connect-src 'none'");
  if (FakeChannel.instances.length === 0) fireEvent.load(iframe);
  return iframe;
}
describe('tenant plugin host lifecycle', () => {
  it('registers pinned metadata, resolves trusted tenant catalog and notifies subscribers on revocation', async () => {
    const resolve = vi.fn().mockResolvedValue(approval),
      host = new ComponentPluginHost(tenantId, { resolve }, () => 1000),
      listener = vi.fn();
    const unsubscribe = host.subscribe(listener);
    await host.refresh(descriptor);
    expect(host.approval(manifest.type)).toEqual(approval);
    expect(resolve).toHaveBeenCalledWith(manifest.type, manifest.version, expect.any(AbortSignal));
    expect(listener).toHaveBeenCalledOnce();
    resolve.mockRejectedValue(new Error('revoked'));
    await expect(host.refresh(descriptor)).rejects.toThrow('revoked');
    expect(host.approval(manifest.type)).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    resolve.mockResolvedValue(approval);
    await host.refresh(descriptor);
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it.each(['tr', 'en'] as const)(
    'connects %s state over a capability port and acknowledges permitted writes and resizes',
    async (locale) => {
      const f = await fixture({ locale });
      expect(f.registry.get(manifest.type)).toMatchObject({
        plugin: { version: manifest.version, integrity: manifest.integrity },
        events: ['onPress'],
        bindableProps: ['value'],
      });
      await frame();
      const channel = FakeChannel.instances[0]!;
      expect(channel.port1.start).toHaveBeenCalledOnce();
      await act(async () => {
        await Promise.resolve();
        channel.port1.onmessage?.(
          new MessageEvent('message', {
            data: { protocol: 1, seq: 1, op: 'write', prop: 'value', value: 'updated' },
          }),
        );
      });
      expect(f.component.write).toHaveBeenCalledWith('value', 'updated');
      expect(channel.port1.postMessage).toHaveBeenCalledWith({
        protocol: 1,
        op: 'reply',
        seq: 1,
        ok: true,
      });
      await act(async () => {
        await Promise.resolve();
        channel.port1.onmessage?.(
          new MessageEvent('message', { data: { protocol: 1, seq: 2, op: 'resize', height: 256 } }),
        );
      });
      expect(screen.getByTitle('acme.demo').getAttribute('height')).toBe('256');
      const next = { ...f.component, props: { value: 'next' }, enabled: false };
      f.view.rerender(
        <UiProvider i18n={f.i18n}>
          <f.Renderer {...next} />
        </UiProvider>,
      );
      await waitFor(() => {
        expect(channel.port1.postMessage).toHaveBeenCalledWith({
          protocol: 1,
          op: 'state',
          props: { value: 'next' },
          locale,
          enabled: false,
        });
      });
      f.view.unmount();
      expect(channel.port1.close).toHaveBeenCalled();
      expect(channel.port2.close).toHaveBeenCalled();
    },
  );
  it('fails closed after invalid guest operations or a second frame load', async () => {
    const f = await fixture();
    const iframe = await frame(),
      channel = FakeChannel.instances[0]!;
    await act(async () => {
      await Promise.resolve();
      channel.port1.onmessage?.(
        new MessageEvent('message', {
          data: { protocol: 1, seq: 1, op: 'emit', event: 'onAdmin' },
        }),
      );
    });
    expect(channel.port1.close).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTitle('acme.demo')).toBeNull();
    });
    expect(f.component.emit).not.toHaveBeenCalled();
    f.view.unmount();
    await fixture();
    const second = await frame();
    fireEvent.load(second);
    await waitFor(() => {
      expect(screen.queryByTitle('acme.demo')).toBeNull();
    });
    expect(iframe.isConnected).toBe(false);
  });
  it('does not transfer private values and fails closed if classification changes after connection', async () => {
    const f = await fixture({ private: true });
    await frame();
    expect(FakeChannel.instances[0]!.port1.close).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTitle('acme.demo')).toBeNull();
    });
    f.view.unmount();
    const publicFixture = await fixture();
    await frame();
    publicFixture.component.runtime.store.setVariable('value', 'secret', 'pii');
    publicFixture.view.rerender(
      <UiProvider i18n={publicFixture.i18n}>
        <publicFixture.Renderer {...publicFixture.component} props={{ value: 'secret' }} />
      </UiProvider>,
    );
    await waitFor(() => {
      expect(screen.queryByTitle('acme.demo')).toBeNull();
    });
    expect(FakeChannel.instances[0]!.port1.close).toHaveBeenCalled();
  });
  it('removes a mounted plugin when its approval is revoked', async () => {
    const f = await fixture();
    await frame();
    f.resolve.mockRejectedValue(new Error('revoked'));
    await act(async () => {
      await Promise.resolve();
      await expect(f.host.refresh(descriptor)).rejects.toThrow('revoked');
    });
    await waitFor(() => {
      expect(screen.queryByTitle('acme.demo')).toBeNull();
    });
    expect(FakeChannel.instances[0]!.port2.close).toHaveBeenCalled();
  });
  it('closes the capability port and removes the frame at approval expiry', async () => {
    const f = await fixture();
    await frame();
    vi.useFakeTimers();
    // Remount schedules the expiry on the controlled clock.
    f.view.unmount();
    f.view = render(
      <UiProvider i18n={f.i18n}>
        <f.Renderer {...f.component} />
      </UiProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(9000);
    });
    vi.useRealTimers();
    await waitFor(() => {
      expect(screen.queryByTitle('acme.demo')).toBeNull();
    });
    expect(screen.getByRole('alert').textContent).toMatch(/eklenti|plugin/i);
  });
  it('renders safe error on bundle fetch failure', async () => {
    await fixture({ fetchError: true });
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/eklenti|plugin/i);
    });
    await waitFor(() => {
      expect(screen.queryByTitle('acme.demo')).toBeNull();
    });
  });
});
