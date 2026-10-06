import { createHash, webcrypto } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { Runtime, createCoreRegistry, type RendererProps } from '@verbis/core-runtime';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { PluginBridge } from './bridge.js';
import { checkApproval, sandboxDocument, verifyBundle } from './bundle.js';
import { PluginManifestSchema } from './protocol.js';
import { TenantComponentService, type EnablementTransaction } from './tenant.js';

const manifest = PluginManifestSchema.parse({
  type: 'acme.demo',
  version: '1.0.0',
  integrity: `sha384-${'A'.repeat(64)}`,
  builtOn: ['box'],
  permissions: { props: ['value'], write: ['value'], events: ['onPress'] },
});
function component(): RendererProps {
  const doc = minimalScript();
  doc.variables = [
    { key: 'value', type: 'string', scope: 'session', default: 'demo', classification: 'public' },
  ];
  const runtime = new Runtime({
    document: doc,
    registry: createCoreRegistry(),
    ports: { sessionEvent: vi.fn() },
  });
  const node = runtime.page('home').layout;
  node.bindings = [{ prop: 'value', variable: 'value' }];
  return {
    runtime,
    node,
    props: { value: 'demo' },
    enabled: true,
    required: false,
    write: (prop, value) => {
      if (prop === 'value') runtime.store.setVariable('value', value);
    },
    emit: vi.fn().mockResolvedValue(undefined),
  };
}
describe('isolated plugin protocol', () => {
  it('checks exact tenant, version, integrity, expiry and approved HTTPS origin', () => {
    const approval = {
      tenantId: '01928f3a-0000-7000-8000-0000000000ff',
      enabled: true,
      type: manifest.type,
      version: manifest.version,
      integrity: manifest.integrity,
      bundleUrl: 'https://assets.example.test/component.js',
      approvedOrigins: ['https://assets.example.test'],
      expiresAt: 10000,
    };
    expect(checkApproval(approval, approval.tenantId, manifest, 1000)).toEqual(approval);
    for (const bad of [
      { enabled: false },
      { version: '2.0.0' },
      { tenantId: '01928f3a-0000-7000-8000-000000000001' },
      { bundleUrl: 'https://evil.example.test/a' },
      { expiresAt: 1 },
    ])
      expect(() =>
        checkApproval({ ...approval, ...bad }, approval.tenantId, manifest, 1000),
      ).toThrow();
  });
  it('allows only declared writes/events and rejects replay, unknown operations and raw action payloads', async () => {
    const c = component(),
      bridge = new PluginBridge(manifest, c, z.strictObject({ value: z.string() }), vi.fn());
    await bridge.handle({ protocol: 1, seq: 1, op: 'write', prop: 'value', value: 'new' });
    expect(c.runtime.store.variable('value')).toBe('new');
    await expect(
      bridge.handle({ protocol: 1, seq: 1, op: 'emit', event: 'onPress' }),
    ).rejects.toThrow('VERBIS_PLUGIN_REPLAY');
    await expect(
      bridge.handle({ protocol: 1, seq: 2, op: 'emit', event: 'onAdmin' }),
    ).rejects.toThrow('VERBIS_PLUGIN_PERMISSION');
    await expect(
      bridge.handle({ protocol: 1, seq: 3, op: 'command', action: { type: 'submitOutcome' } }),
    ).rejects.toThrow();
    c.runtime.dispose();
  });
  it('never transfers private props or accepts writes to private variables', async () => {
    const c = component();
    c.runtime.store.setVariable('value', 'private', 'pii');
    const bridge = new PluginBridge(manifest, c, z.strictObject({ value: z.string() }), vi.fn());
    expect(() => bridge.publicProps()).toThrow('VERBIS_PLUGIN_PRIVATE_PROP');
    await expect(
      bridge.handle({ protocol: 1, seq: 1, op: 'write', prop: 'value', value: 'x' }),
    ).rejects.toThrow('VERBIS_PLUGIN_PRIVATE_WRITE');
    c.runtime.dispose();
  });
  it('bounds resize messages and denies messages when disabled', async () => {
    const c = component(),
      resize = vi.fn(),
      bridge = new PluginBridge(manifest, c, z.strictObject({ value: z.string() }), resize);
    await bridge.handle({ protocol: 1, seq: 1, op: 'resize', height: 200 });
    expect(resize).toHaveBeenCalledWith(200);
    await expect(
      bridge.handle({ protocol: 1, seq: 2, op: 'resize', height: 99999 }),
    ).rejects.toThrow();
    bridge.update({ ...c, enabled: false });
    await expect(
      bridge.handle({ protocol: 1, seq: 2, op: 'emit', event: 'onPress' }),
    ).rejects.toThrow('VERBIS_PLUGIN_DISABLED');
    c.runtime.dispose();
  });
  it('creates CSP-bound opaque frames without eval, same-origin, forms or top navigation permissions', () => {
    const html = sandboxDocument('data:application/javascript;base64,Y29uc29sZS5sb2coMSk=');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).not.toContain('unsafe-eval');
    expect(() => sandboxDocument('https://evil.example.test/a.js')).toThrow();
  });
  it('verifies valid artifacts and rejects changed bytes', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const bytes = new Uint8Array([1, 2, 3]);
    const integrity = `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
    await expect(verifyBundle(bytes, integrity)).resolves.toBeUndefined();
    await expect(verifyBundle(new Uint8Array([1, 2, 4]), integrity)).rejects.toThrow(
      'VERBIS_PLUGIN_INTEGRITY',
    );
  });
});
it('tenant enablement authorizes and writes audit in the same transaction', async () => {
  const calls: string[] = [],
    service = new TenantComponentService({
      authorize: () => {
        calls.push('authorize');
        return Promise.resolve();
      },
      transaction: async (_tenant, work) => {
        calls.push('transaction');
        return work({
          findPublished: () => Promise.resolve(manifest),
          save: () => {
            calls.push('save');
            return Promise.resolve();
          },
          audit: () => {
            calls.push('audit');
            return Promise.resolve();
          },
        });
      },
    });
  await service.setEnabled(
    { tenantId: 'tenant-context', actorId: 'actor-context' },
    { type: manifest.type, version: manifest.version, enabled: true },
  );
  expect(calls).toEqual(['authorize', 'transaction', 'save', 'audit']);
});
it('rolls back enablement when audit fails through the transaction port', async () => {
  const called = vi.fn();
  const transaction = async <T>(
    _tenant: string,
    work: (tx: EnablementTransaction) => Promise<T>,
  ): Promise<T> => {
    called();
    return work({
      findPublished: () => Promise.resolve(manifest),
      save: () => Promise.resolve(),
      audit: () => Promise.reject(new Error('synthetic audit failure')),
    });
  };
  const service = new TenantComponentService({ authorize: () => Promise.resolve(), transaction });
  await expect(
    service.setEnabled(
      { tenantId: 'tenant', actorId: 'actor' },
      { type: manifest.type, version: manifest.version, enabled: false },
    ),
  ).rejects.toThrow('synthetic audit failure');
  expect(called).toHaveBeenCalledOnce();
});
