import { describe, expect, it, vi } from 'vitest';

import { TestScenarioSchema } from '@verbis/script-schema';

import { createCoreRegistry } from './core-components.js';
import { SimulationController } from './executor.js';
import { runtimeFixture } from './fixtures.js';
import { Runtime } from './runtime.js';
import { runScenario, mockDataSource } from './scenarios.js';

describe('simulation debugging', () => {
  it('stops a running executor at a specific action path and releases exactly one step', async () => {
    const document = runtimeFixture();
    const runtime = new Runtime({
      document,
      registry: createCoreRegistry(),
      simulation: true,
      ports: { sessionEvent: () => undefined },
    });
    try {
      runtime.executor.debugger.resume();
      runtime.executor.debugger.breakpoints.add('node:submit/onPress/1');
      const execution = runtime.executor.execute(
        [
          { type: 'setVariable', variable: 'count', value: 1 },
          { type: 'setVariable', variable: 'count', value: 2 },
        ],
        undefined,
        'node:submit/onPress',
      );
      await vi.waitFor(() => {
        expect(runtime.executor.debugger.paused).toBe(true);
      });
      expect(runtime.store.variable('count')).toBe(1);
      runtime.executor.debugger.step();
      await execution;
      expect(runtime.store.variable('count')).toBe(2);
    } finally {
      runtime.dispose();
    }
  });
  it('aborts a waiting breakpoint without leaving a permit or waiter', async () => {
    const debugger_ = new SimulationController(),
      controller = new AbortController();
    const pending = debugger_.checkpoint(controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('VERBIS_RUNTIME_CANCELLED');
    debugger_.resume();
    await expect(debugger_.checkpoint(new AbortController().signal)).resolves.toBeUndefined();
  });
  it('restores flow position and variables into a fresh runtime without replaying commands', async () => {
    const command = vi.fn(() => Promise.resolve()),
      document = runtimeFixture();
    const options = {
      document,
      registry: createCoreRegistry(),
      simulation: true,
      ports: { sessionEvent: () => undefined },
      simulationPorts: { command },
    };
    const old = new Runtime(options);
    old.executor.debugger.resume();
    await old.start();
    old.store.setVariable('count', 7);
    const snapshot = old.checkpoint();
    await old.next();
    old.dispose();
    const restored = new Runtime(options);
    try {
      restored.restore(snapshot);
      restored.executor.debugger.resume();
      expect(restored.store.variable('count')).toBe(7);
      expect(restored.store.get('runtime.page')).toBe('home');
      await restored.next();
      expect(restored.store.get('runtime.page')).toBe('second');
      expect(command).not.toHaveBeenCalled();
    } finally {
      restored.dispose();
    }
  });
  it('rejects checkpoints in an agent session', () => {
    const runtime = new Runtime({
      document: runtimeFixture(),
      registry: createCoreRegistry(),
      ports: { sessionEvent: () => undefined },
    });
    expect(() => runtime.checkpoint()).toThrow('VERBIS_PREVIEW_ONLY');
    runtime.dispose();
  });
  it('replays synthetic inputs, data source outputs and assertions through the same engine', async () => {
    const scenario = TestScenarioSchema.parse({
      id: 'lookupCase',
      name: 'Lookup case',
      synthetic: true,
      context: {},
      dataSources: { lookup: { outputs: { result: 'synthetic' } } },
      steps: [{ type: 'actions', actions: [{ type: 'callDataSource', dataSource: 'lookup' }] }],
      expected: { variables: { name: 'synthetic' }, page: 'home' },
    });
    const result = await runScenario(runtimeFixture(), createCoreRegistry(), scenario);
    expect(result.passed).toBe(true);
    expect(JSON.stringify(result)).not.toContain('synthetic');
    const failed = await runScenario(runtimeFixture(), createCoreRegistry(), {
      ...scenario,
      expected: { variables: { name: 'different' } },
    });
    expect(failed.passed).toBe(false);
    expect(failed.assertions).toEqual([{ path: 'vars.name', passed: false }]);
  });
  it('reports a missing mock, never invoking a real port', async () => {
    const scenario = TestScenarioSchema.parse({
      id: 'missing',
      name: 'Missing',
      synthetic: true,
      context: {},
      steps: [{ type: 'actions', actions: [{ type: 'callDataSource', dataSource: 'lookup' }] }],
      expected: { page: 'home' },
    });
    expect((await runScenario(runtimeFixture(), createCoreRegistry(), scenario)).code).toBe(
      'VERBIS_PREVIEW_MOCK_MISSING',
    );
  });
  it('supports empty output shapes and abortable mock delays', async () => {
    const request = {
      id: 'lookup',
      ref: 'tenant-datasource:lookup',
      version: 1,
      inputs: {},
      signal: new AbortController().signal,
    };
    expect(
      await mockDataSource({
        lookup: { kind: 'empty', outputs: { result: ['synthetic'] }, delayMs: 0 },
      })(request),
    ).toEqual({ result: [] });
    const controller = new AbortController();
    controller.abort();
    await expect(
      mockDataSource({ lookup: { kind: 'delay', outputs: {}, delayMs: 1000 } })({
        ...request,
        signal: controller.signal,
      }),
    ).rejects.toThrow('VERBIS_RUNTIME_CANCELLED');
  });
});

it('fails recorded events when a changed ancestor disables the field', async () => {
  const document = runtimeFixture([
    {
      id: 'hidden-group',
      type: 'box',
      enabledWhen: { $expr: 'false' },
      children: [
        {
          id: 'blocked-button',
          type: 'button',
          props: { labelKey: 'common.run' },
          events: { onPress: [{ type: 'setVariable', variable: 'count', value: 1 }] },
        },
      ],
    },
  ]);
  const scenario = TestScenarioSchema.parse({
    id: 'blocked',
    name: 'Changed parent rule',
    synthetic: true,
    context: {},
    steps: [{ type: 'event', node: 'blocked-button', event: 'onPress' }],
    expected: { variables: { count: 1 } },
  });
  const result = await runScenario(document, createCoreRegistry(), scenario);
  expect(result).toMatchObject({ passed: false, code: 'VERBIS_PREVIEW_EVENT_UNAVAILABLE' });
});
