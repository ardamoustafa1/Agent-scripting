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
