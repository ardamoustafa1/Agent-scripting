import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createCoreRegistry } from './core-components.js';
import { runtimeFixture } from './fixtures.js';

import type { ComponentDefinition } from './registry.js';

const plugin: ComponentDefinition = {
  type: 'acme.counter',
  renderer: () => null,
  propsSchema: z.strictObject({ value: z.number().default(0) }),
  defaults: {},
  designerMeta: {
    icon: 'Hash',
    category: 'plugin',
    acceptsChildren: [],
    allowedParents: ['box'],
    draggable: true,
  },
  events: ['onChange'],
  bindableProps: ['value'],
  plugin: { version: '1.0.0', integrity: `sha384-${'A'.repeat(64)}` },
};
describe('component registry', () => {
  it('still validates static props when one valid prop is bound', () => {
    const doc = runtimeFixture([
      {
        id: 'bad',
        type: 'button',
        props: { contentKey: 'unknown' },
        bindings: [{ prop: 'labelKey', expression: 'vars.name' }],
      },
    ]);
    expect(() => {
      createCoreRegistry().validate(doc);
    }).toThrow();
  });
  it('publishes all core contracts and enforces designer drop constraints', () => {
    const registry = createCoreRegistry().register(plugin);
    expect(registry.list().map((d) => d.type)).toEqual([
      'box',
      'button',
      'webService',
      'acme.counter',
    ]);
    expect(registry.canDrop('box', 'acme.counter')).toBe(true);
    expect(registry.canDrop('button', 'box')).toBe(false);
    expect(() => registry.register(plugin)).toThrow('VERBIS_COMPONENT_DUPLICATE');
  });
  it('validates event and bindable prop allowlists', () => {
    const registry = createCoreRegistry();
    expect(() => {
      registry.validate(runtimeFixture([{ id: 'bad', type: 'button', events: { onBad: [] } }]));
    }).toThrow('VERBIS_COMPONENT_EVENT');
    expect(() => {
      registry.validate(
        runtimeFixture([
          {
            id: 'bad',
            type: 'button',
            bindings: [{ prop: 'unexpected', expression: 'vars.name' }],
          },
        ]),
      );
    }).toThrow('VERBIS_BINDING_PROP');
    expect(() => {
      registry.validate(
        runtimeFixture([{ id: 'bad', type: 'button', children: [{ id: 'child', type: 'box' }] }]),
      );
    }).toThrow('VERBIS_COMPONENT_CHILD');
  });
  it('requires an exact host plugin version and SRI pin', () => {
    const registry = createCoreRegistry().register(plugin),
      doc = runtimeFixture([{ id: 'counter', type: plugin.type }]);
    expect(() => {
      registry.validate(doc);
    }).toThrow('VERBIS_PLUGIN_PIN_MISMATCH');
    doc.componentRegistry.push({ type: plugin.type, ...plugin.plugin! });
    expect(() => {
      registry.validate(doc);
    }).not.toThrow();
    doc.componentRegistry[0]!.version = '2.0.0';
    expect(() => {
      registry.validate(doc);
    }).toThrow('VERBIS_PLUGIN_PIN_MISMATCH');
  });
});

it('uses a valid default but rejects malformed literals even when bound', () => {
  const required = {
    ...plugin,
    propsSchema: z.strictObject({ value: z.number() }),
    defaults: { value: 0 },
  };
  const registry = createCoreRegistry().register(required);
  const doc = runtimeFixture([
    { id: 'counter', type: plugin.type, bindings: [{ prop: 'value', expression: 'vars.count' }] },
  ]);
  doc.componentRegistry.push({ type: plugin.type, ...plugin.plugin! });
  expect(() => {
    registry.validate(doc);
  }).not.toThrow();
  const malformedBound = runtimeFixture([
    {
      id: 'counter',
      type: plugin.type,
      props: { value: 'invalid' },
      bindings: [{ prop: 'value', expression: 'vars.count' }],
    },
  ]);
  malformedBound.componentRegistry.push({ type: plugin.type, ...plugin.plugin! });
  expect(() => {
    registry.validate(malformedBound);
  }).toThrow(z.ZodError);
  const malformedLiteral = runtimeFixture([
    { id: 'counter', type: plugin.type, props: { value: null } },
  ]);
  malformedLiteral.componentRegistry.push({ type: plugin.type, ...plugin.plugin! });
  expect(() => {
    registry.validate(malformedLiteral);
  }).toThrow(z.ZodError);
});
it('rejects forged core pins and unknown host component types', () => {
  const registry = createCoreRegistry();
  const doc = runtimeFixture([{ id: 'button', type: 'button' }]);
  doc.componentRegistry.push({ type: 'button', ...plugin.plugin! });
  expect(() => {
    registry.validate(doc);
  }).toThrow('VERBIS_PLUGIN_PIN_MISMATCH');
  expect(() => registry.get('unknown')).toThrow('VERBIS_COMPONENT_UNKNOWN');
});
it('rejects a mismatched plugin integrity and an invalid host default even when bound', () => {
  const doc = runtimeFixture([
    { id: 'counter', type: plugin.type, bindings: [{ prop: 'value', expression: 'vars.count' }] },
  ]);
  doc.componentRegistry.push({
    type: plugin.type,
    version: plugin.plugin!.version,
    integrity: `sha384-${'B'.repeat(64)}`,
  });
  expect(() => {
    createCoreRegistry().register(plugin).validate(doc);
  }).toThrow('VERBIS_PLUGIN_PIN_MISMATCH');
  doc.componentRegistry[0]!.integrity = plugin.plugin!.integrity;
  const invalidDefault = {
    ...plugin,
    propsSchema: z.strictObject({ value: z.number() }),
    defaults: { value: 'invalid' },
  };
  expect(() => {
    createCoreRegistry().register(invalidDefault).validate(doc);
  }).toThrow(z.ZodError);
});
it('does not defer malformed nested literals just because the whole prop is bound', () => {
  const nested = {
    ...plugin,
    propsSchema: z.strictObject({ value: z.object({ count: z.number() }) }),
  };
  const doc = runtimeFixture([
    {
      id: 'counter',
      type: plugin.type,
      props: { value: {} },
      bindings: [{ prop: 'value', expression: 'vars.count' }],
    },
  ]);
  doc.componentRegistry.push({ type: plugin.type, ...plugin.plugin! });
  expect(() => {
    createCoreRegistry().register(nested).validate(doc);
  }).toThrow(z.ZodError);
});
it('prevents a non-draggable plugin from entering the designer layout', () => {
  const fixed = { ...plugin, designerMeta: { ...plugin.designerMeta, draggable: false } };
  expect(createCoreRegistry().register(fixed).canDrop('box', plugin.type)).toBe(false);
});
