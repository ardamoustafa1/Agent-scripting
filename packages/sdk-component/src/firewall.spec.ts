import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { Runtime, createCoreRegistry, type RendererProps } from '@verbis/core-runtime';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { PluginBridge } from './bridge.js';
import { PluginManifestSchema } from './protocol.js';
import { TenantComponentService } from './tenant.js';

const manifest = PluginManifestSchema.parse({
  type: 'acme.demo',
  version: '1.0.0',
  integrity: `sha384-${'A'.repeat(64)}`,
  builtOn: ['box'],
  permissions: { props: ['value'], write: ['value'], events: ['onPress'] },
});
function fixture(expression?: string) {
  const document = minimalScript();
  document.variables = [
    { key: 'value', type: 'string', scope: 'session', default: 'demo', classification: 'public' },
  ];
  const runtime = new Runtime({
    document,
    registry: createCoreRegistry(),
    ports: { sessionEvent: vi.fn() },
  });
  const node = runtime.page('home').layout;
  node.bindings = expression
    ? [{ prop: 'value', expression }]
    : [{ prop: 'value', variable: 'value' }];
  const component: RendererProps = {
    runtime,
    node,
    props: { value: 'demo' },
    enabled: true,
    required: false,
    emit: vi.fn().mockResolvedValue(undefined),
    write: vi.fn(),
  };
  let now = 1000;
  const bridge = new PluginBridge(
    manifest,
    component,
    z.strictObject({ value: z.string() }),
    vi.fn(),
    () => now,
  );
  return {
    runtime,
    node,
    component,
    bridge,
    advance: () => {
      now += 1000;
    },
  };
}
describe('capability firewall boundaries', () => {
  it('allows the hundredth operation, rejects the next, and resets only after a second', async () => {
    const f = fixture();
    try {
      for (let seq = 1; seq <= 100; seq++)
        await f.bridge.handle({ protocol: 1, seq, op: 'emit', event: 'onPress' });
      expect(f.component.emit).toHaveBeenCalledTimes(100);
      await expect(
        f.bridge.handle({ protocol: 1, seq: 101, op: 'emit', event: 'onPress' }),
      ).rejects.toThrow('VERBIS_PLUGIN_RATE_LIMIT');
      f.advance();
      await expect(
        f.bridge.handle({ protocol: 1, seq: 102, op: 'emit', event: 'onPress' }),
      ).resolves.toBe(102);
    } finally {
      f.runtime.dispose();
    }
  });
  it('rejects undeclared writes and unbound or expression-only destinations before touching runtime', async () => {
    const f = fixture();
    try {
      await expect(
        f.bridge.handle({ protocol: 1, seq: 1, op: 'write', prop: 'admin', value: 'x' }),
      ).rejects.toThrow('VERBIS_PLUGIN_PERMISSION');
      f.node.bindings = [];
      await expect(
        f.bridge.handle({ protocol: 1, seq: 2, op: 'write', prop: 'value', value: 'x' }),
      ).rejects.toThrow('VERBIS_PLUGIN_PRIVATE_WRITE');
      f.node.bindings = [{ prop: 'value', expression: 'vars.value' }];
      await expect(
        f.bridge.handle({ protocol: 1, seq: 3, op: 'write', prop: 'value', value: 'x' }),
      ).rejects.toThrow('VERBIS_PLUGIN_PRIVATE_WRITE');
      expect(f.component.write).not.toHaveBeenCalled();
    } finally {
      f.runtime.dispose();
    }
  });
  it.each(['vars.value', 'interaction.ani', 'vars[interaction.key]'])(
    'checks every expression dependency in %s',
    (expression) => {
      const f = fixture(expression);
      try {
        if (expression === 'vars.value') expect(f.bridge.publicProps()).toEqual({ value: 'demo' });
        else expect(() => f.bridge.publicProps()).toThrow('VERBIS_PLUGIN_PRIVATE_PROP');
        f.component.props = {};
        f.node.bindings = [];
        expect(f.bridge.publicProps()).toEqual({});
      } finally {
        f.runtime.dispose();
      }
    },
  );
  it.each([{ type: 'acme.other' }, { version: '2.0.0' }])(
    'rejects a published manifest that disagrees with enablement %j',
    async (patch) => {
      const save = vi.fn(),
        audit = vi.fn();
      const service = new TenantComponentService({
        authorize: vi.fn().mockResolvedValue(undefined),
        transaction: (_tenant, work) =>
          work({ findPublished: () => Promise.resolve({ ...manifest, ...patch }), save, audit }),
      });
      await expect(
        service.setEnabled(
          { tenantId: 'tenant', actorId: 'actor' },
          { type: manifest.type, version: manifest.version, enabled: true },
        ),
      ).rejects.toThrow('VERBIS_PLUGIN_VERSION');
      expect(save).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    },
  );
});
