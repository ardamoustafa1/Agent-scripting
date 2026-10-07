import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { TestScenarioSchema } from '@verbis/script-schema';

import { createCoreRegistry } from './core-components.js';
import { runtimeFixture } from './fixtures.js';
import { mockDataSource, runScenario } from './scenarios.js';

const scenario = (patch: Record<string, unknown>) =>
  TestScenarioSchema.parse({
    id: 'boundary',
    name: 'Boundary',
    synthetic: true,
    context: {},
    steps: [],
    expected: { page: 'home' },
    ...patch,
  });
describe('synthetic acceptance runner boundaries', () => {
  it('runs variables, acknowledged reads, allowed events, outcome and termination assertions', async () => {
    const document = runtimeFixture([
      { id: 'readable', type: 'textInput', props: { mustRead: true } },
      {
        id: 'pressable',
        type: 'button',
        props: { labelKey: 'common.run' },
        events: { onPress: [{ type: 'setVariable', variable: 'count', value: 4 }] },
      },
    ]);
    const result = await runScenario(
      document,
      createCoreRegistry().register({
        type: 'textInput',
        renderer: () => null,
        propsSchema: z.record(z.string(), z.unknown()),
        defaults: {},
        events: [],
        bindableProps: [],
        designerMeta: {
          icon: 'Text',
          category: 'test',
          acceptsChildren: [],
          allowedParents: '*',
          draggable: true,
        },
      }),
      scenario({
        steps: [
          { type: 'variable', variable: 'name', value: 'fixture' },
          { type: 'read', node: 'readable', acknowledged: true },
          { type: 'event', node: 'pressable', event: 'onPress' },
          {
            type: 'actions',
            actions: [
              { type: 'submitOutcome', outcome: 'done' },
              { type: 'next' },
              { type: 'next' },
            ],
          },
        ],
        expected: { variables: { name: 'fixture', count: 4 }, outcome: 'done', ended: true },
      }),
    );
    expect(result).toMatchObject({
      passed: true,
      assertions: [
        { path: 'outcome', passed: true },
        { path: 'ended', passed: true },
        { path: 'vars.name', passed: true },
        { path: 'vars.count', passed: true },
      ],
    });
  });
  it.each(['not-readable', 'missing'])('rejects acknowledging %s', async (node) => {
    const result = await runScenario(
      runtimeFixture([{ id: 'not-readable', type: 'box' }]),
      createCoreRegistry(),
      scenario({ steps: [{ type: 'read', node, acknowledged: true }] }),
    );
    expect(result).toMatchObject({ passed: false, code: 'VERBIS_NODE_UNKNOWN' });
  });
  it.each([
    { type: 'event', node: 'missing', event: 'onPress' },
    { type: 'event', node: 'root', event: 'onPress' },
  ])('rejects unavailable or unsupported events %j', async (step) => {
    const document = runtimeFixture([{ id: 'root', type: 'box' }]);
    const result = await runScenario(document, createCoreRegistry(), scenario({ steps: [step] }));
    expect(result).toMatchObject({
      passed: false,
      code: step.node === 'missing' ? 'VERBIS_PREVIEW_EVENT_UNAVAILABLE' : 'VERBIS_COMPONENT_EVENT',
    });
  });
  it('ignores a recorded recoverable action error but respects the acceptance deadline', async () => {
    const recoverable = await runScenario(
      runtimeFixture(),
      createCoreRegistry(),
      scenario({
        steps: [
          {
            type: 'actions',
            actions: [{ type: 'callDataSource', dataSource: 'lookup' }],
            ignoreError: true,
          },
          { type: 'variable', variable: 'count', value: 2 },
        ],
        expected: { variables: { count: 2 } },
      }),
    );
    expect(recoverable.passed).toBe(true);
    const timedOut = await runScenario(
      runtimeFixture(),
      createCoreRegistry(),
      scenario({
        dataSources: { lookup: { kind: 'delay', delayMs: 100, outputs: {} } },
        steps: [
          {
            type: 'actions',
            actions: [{ type: 'callDataSource', dataSource: 'lookup' }],
            ignoreError: true,
          },
        ],
      }),
      1,
    );
    expect(timedOut).toMatchObject({ passed: false, code: 'VERBIS_RUNTIME_CANCELLED' });
  });
  it('compares nested objects independently from key order and reports mismatched assertions', async () => {
    const document = runtimeFixture();
    document.variables.push({
      key: 'payload',
      type: 'object',
      scope: 'session',
      classification: 'public',
      pii: false,
      persist: false,
      default: { b: [2, 3], a: 1 },
    });
    const result = await runScenario(
      document,
      createCoreRegistry(),
      scenario({
        expected: { variables: { payload: { a: 1, b: [2, 3] } }, outcome: 'not-set', ended: false },
      }),
    );
    expect(result.assertions).toEqual([
      { path: 'outcome', passed: false },
      { path: 'ended', passed: true },
      { path: 'vars.payload', passed: true },
    ]);
    expect(result.passed).toBe(false);
  });
  it('resolves delayed mocks, shapes empty values and aborts in-progress requests', async () => {
    const request = {
      id: 'lookup',
      ref: 'tenant-datasource:lookup',
      version: 1,
      inputs: {},
      signal: new AbortController().signal,
    };
    expect(
      await mockDataSource({
        lookup: { kind: 'delay', delayMs: 1, outputs: { value: 'synthetic' } },
      })(request),
    ).toEqual({ value: 'synthetic' });
    expect(
      await mockDataSource({
        lookup: { kind: 'empty', delayMs: 0, outputs: { scalar: 'synthetic', rows: [1] } },
      })(request),
    ).toEqual({ scalar: null, rows: [] });
    await expect(
      mockDataSource({ lookup: { kind: 'error', delayMs: 0, outputs: {} } })(request),
    ).rejects.toThrow('VERBIS_PREVIEW_MOCK_ERROR');
    const controller = new AbortController();
    const promise = mockDataSource({ lookup: { kind: 'delay', delayMs: 100, outputs: {} } })({
      ...request,
      signal: controller.signal,
    });
    const rejected = expect(promise).rejects.toThrow('VERBIS_RUNTIME_CANCELLED');
    controller.abort();
    await rejected;
  });
});
describe('scenario coverage and observation', () => {
  it('reports flow-qualified nodes and edges taken and where the run stopped', async () => {
    const document = runtimeFixture([
      {
        id: 'go',
        type: 'button',
        props: { labelKey: 'common.run' },
        events: { onPress: [{ type: 'next' }] },
      },
    ]);
    const flow = (document as { flow: { id: string; nodes: { id: string }[] } }).flow;
    const result = await runScenario(
      document,
      createCoreRegistry(),
      scenario({
        steps: [{ type: 'event', node: 'go', event: 'onPress' }],
        expected: { page: 'second' },
      }),
    );
    expect(result.passed).toBe(true);
    expect(result.observed).toEqual({ page: 'second', ended: false });
    expect(result.coverage.nodes.every((key) => key.startsWith(`${flow.id}:`))).toBe(true);
    expect(result.coverage.nodes).toContain(`${flow.id}:${flow.nodes[0]!.id}`);
    expect(result.coverage.nodes).toContain(`${flow.id}:second-flow`);
    expect(result.coverage.edges).toHaveLength(1);
  });

  it('still reports partial coverage and the stopping page when a scenario fails', async () => {
    const result = await runScenario(
      runtimeFixture([]),
      createCoreRegistry(),
      scenario({ expected: { ended: true } }),
    );
    expect(result.passed).toBe(false);
    expect(result.observed).toEqual({ page: 'home', ended: false });
    expect(result.coverage.nodes.length).toBeGreaterThan(0);
    expect(result.coverage.edges).toEqual([]);
  });
});
