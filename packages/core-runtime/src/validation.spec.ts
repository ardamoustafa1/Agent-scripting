import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { JsonValueSchema, type NodeInput } from '@verbis/script-schema';

import { createCoreRegistry } from './core-components.js';
import { runtimeFixture } from './fixtures.js';
import { Runtime } from './runtime.js';

const engines: Runtime[] = [];
afterEach(() => {
  for (const runtime of engines.splice(0)) runtime.dispose();
});
function engine(children: NodeInput[], serverValidation?: () => Promise<unknown>) {
  const registry = createCoreRegistry().register({
    type: 'textInput',
    renderer: () => null,
    propsSchema: z.record(z.string(), JsonValueSchema),
    defaults: {},
    designerMeta: {
      icon: 'Text',
      category: 'fields',
      acceptsChildren: [],
      allowedParents: '*',
      draggable: true,
    },
    events: [],
    bindableProps: ['value'],
  });
  const runtime = new Runtime({
    document: runtimeFixture(children),
    registry,
    ports: { sessionEvent: vi.fn(), ...(serverValidation ? { serverValidation } : {}) },
  });
  engines.push(runtime);
  return runtime;
}
const field: NodeInput = {
  id: 'field-name',
  type: 'textInput',
  bindings: [{ variable: 'name' }],
  requiredWhen: { $rule: 'has-name' },
  props: { validation: [{ when: { $expr: 'vars.count > 0' }, messageKey: 'common.invalid' }] },
};
describe('validation scopes', () => {
  it('validates field/page/script and publishes errors reactively', async () => {
    const runtime = engine([{ ...field, requiredWhen: { $expr: 'true' } }]);
    expect(await runtime.validation.page('home')).toEqual([
      { node: 'field-name', messageKey: 'runtime.required' },
      { node: 'field-name', messageKey: 'common.invalid' },
    ]);
    runtime.store.setVariable('name', 'value');
    runtime.store.setVariable('count', 1);
    expect(await runtime.validation.script()).toEqual([]);
    expect(runtime.store.get('runtime.errors.field-name')).toEqual([]);
  });
  it('skips descendants of invisible and disabled containers', async () => {
    const runtime = engine([
      {
        id: 'hidden',
        type: 'box',
        visibleWhen: { $expr: 'false' },
        children: [{ ...field, requiredWhen: { $expr: 'true' } }],
      },
    ]);
    expect(await runtime.validation.page('home')).toEqual([]);
  });
  it('merges server errors and rejects errors pointing outside the validated page', async () => {
    const runtime = engine([field], () =>
      Promise.resolve([{ node: 'field-name', messageKey: 'common.invalid' }]),
    );
    expect(await runtime.validation.page('home')).toContainEqual({
      node: 'field-name',
      messageKey: 'common.invalid',
    });
    const invalid = engine([], () =>
      Promise.resolve([{ node: 'untrusted', messageKey: 'common.invalid' }]),
    );
    await expect(invalid.validation.page('home')).rejects.toThrow('VERBIS_VALIDATION_RESPONSE');
  });
  it('blocks the remaining action chain after invalid validation', async () => {
    const runtime = engine([{ ...field, requiredWhen: { $expr: 'true' } }]);
    await runtime.start();
    await expect(
      runtime.executor.execute([
        { type: 'validatePage', onInvalid: [{ type: 'setVariable', variable: 'count', value: 2 }] },
        { type: 'next' },
      ]),
    ).rejects.toThrow('VERBIS_VALIDATION_FAILED');
    expect(runtime.store.variable('count')).toBe(2);
    expect(runtime.store.get('runtime.page')).toBe('home');
  });
  it('does not publish errors after server validation is cancelled', async () => {
    const runtime = engine([field], () => new Promise(() => undefined)),
      controller = new AbortController();
    const validation = runtime.validation.page('home', controller.signal);
    const rejection = expect(validation).rejects.toThrow('VERBIS_RUNTIME_CANCELLED');
    controller.abort();
    await rejection;
    expect(runtime.store.get('runtime.errors.field-name')).toBeNull();
  });
});
it('validates expression-bound values and normalizes custom validator failures', async () => {
  const runtime = engine([
    {
      ...field,
      requiredWhen: { $expr: 'true' },
      bindings: [{ prop: 'value', expression: 'vars.name' }],
    },
  ]);
  expect(await runtime.validation.field(runtime.page('home').layout.children![0]!)).toContainEqual({
    node: 'field-name',
    messageKey: 'runtime.required',
  });
  await expect(runtime.validation.page('missing')).rejects.toThrow('VERBIS_PAGE_UNKNOWN');
  const document = runtimeFixture([{ ...field, requiredWhen: { $expr: 'false' } }]);
  const registry = runtime.registry;
  const custom = new Runtime({
    document,
    registry,
    ports: {
      sessionEvent: vi.fn(),
      fieldValidation: (node, value) =>
        Promise.resolve([
          { node: node.id, messageKey: value === null ? 'runtime.required' : 'common.invalid' },
        ]),
    },
  });
  engines.push(custom);
  expect(await custom.validation.field(custom.page('home').layout.children![0]!)).toContainEqual({
    node: 'field-name',
    messageKey: 'common.invalid',
  });
  const failed = new Runtime({
    document,
    registry,
    ports: {
      sessionEvent: vi.fn(),
      fieldValidation: () => Promise.reject(new Error('private upstream detail')),
    },
  });
  engines.push(failed);
  await expect(failed.validation.field(failed.page('home').layout.children![0]!)).rejects.toThrow(
    'VERBIS_VALIDATION_SERVICE_FAILED',
  );
});
it.each([null, false, '', [], 0, true, [1]])(
  'enforces required values precisely for %j',
  async (value) => {
    const runtime = engine([]);
    const node = runtime.page('home').layout;
    node.props = { required: true, value };
    expect(await runtime.validation.field(node)).toEqual(
      value === null ||
        value === false ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)
        ? [{ node: node.id, messageKey: 'runtime.required' }]
        : [],
    );
  },
);
it('rejects an unrecognized message key in otherwise valid server errors', async () => {
  const runtime = engine([field], () =>
    Promise.resolve([{ node: 'field-name', messageKey: 'unconfigured.message' }]),
  );
  await expect(runtime.validation.page('home')).rejects.toThrow('VERBIS_VALIDATION_RESPONSE');
  expect(runtime.store.get('runtime.errors.field-name')).toBeNull();
});
