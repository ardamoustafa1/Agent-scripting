import { afterEach, describe, expect, it, vi } from 'vitest';

import { FlowSchema, type ActionInput, type ScriptDocument } from '@verbis/script-schema';

import { createCoreRegistry } from './core-components.js';
import { runtimeFixture } from './fixtures.js';
import { Runtime } from './runtime.js';

import type { RuntimePorts, RuntimeSessionEvent } from './ports.js';

const engines: Runtime[] = [];
afterEach(() => {
  for (const runtime of engines.splice(0)) runtime.dispose();
  vi.useRealTimers();
});
function engine(
  document = runtimeFixture(),
  ports: Partial<RuntimePorts> = {},
  simulation = false,
) {
  const events: RuntimeSessionEvent[] = [];
  const runtime = new Runtime({
    document,
    registry: createCoreRegistry(),
    ports: { sessionEvent: (event) => events.push(event), ...ports },
    simulation,
  });
  engines.push(runtime);
  return { runtime, events };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('action executor and runtime boundaries', () => {
  it('runs nested chains in order and emits redacted lifecycle metadata for every action', async () => {
    const { runtime, events } = engine();
    await runtime.executor.execute([
      {
        type: 'sequence',
        actions: [
          { type: 'setVariable', variable: 'name', value: 'synthetic' },
          {
            type: 'conditional',
            if: { $rule: 'has-name' },
            then: [{ type: 'setVariable', variable: 'count', value: { $expr: 'vars.count + 1' } }],
          },
        ],
      },
    ]);
    expect(runtime.store.variable('count')).toBe(1);
    expect(events.filter((e) => e.phase === 'started')).toHaveLength(4);
    expect(events.filter((e) => e.phase === 'completed')).toHaveLength(4);
    expect(JSON.stringify(events)).not.toContain('synthetic');
  });
  it('cancels a pending command even when the host ignores AbortSignal', async () => {
    const pending = deferred<undefined>(),
      { runtime, events } = engine(runtimeFixture(), { command: () => pending.promise });
    const controller = new AbortController();
    const execution = runtime.executor.execute(
      [
        { type: 'setDisposition', code: 'DONE' },
        { type: 'setVariable', variable: 'count', value: 9 },
      ],
      controller.signal,
    );
    controller.abort();
    await expect(execution).rejects.toThrow('VERBIS_RUNTIME_CANCELLED');
    pending.resolve(undefined);
    expect(runtime.store.variable('count')).toBe(0);
    expect(events.at(-1)?.phase).toBe('cancelled');
  });
  it('simulation waits for steps and never invokes live external ports', async () => {
    const command = vi.fn(),
      dataSource = vi.fn(),
      { runtime, events } = engine(runtimeFixture(), { command, dataSource }, true);
    const task = runtime.executor.execute([
      { type: 'setVariable', variable: 'count', value: 4 },
      { type: 'setDisposition', code: 'DONE' },
    ]);
    expect(runtime.store.variable('count')).toBe(0);
    expect(events.at(-1)?.phase).toBe('waiting');
    runtime.executor.debugger.step();
    await vi.waitFor(() => {
      expect(runtime.store.variable('count')).toBe(4);
    });
    runtime.executor.debugger.resume();
    await task;
    expect(command).not.toHaveBeenCalled();
    expect(dataSource).not.toHaveBeenCalled();
  });
  it('uses simulation datasource fixtures separately from live ports', async () => {
    const live = vi.fn();
    const runtime = new Runtime({
      document: runtimeFixture(),
      registry: createCoreRegistry(),
      ports: { sessionEvent: vi.fn(), dataSource: live },
      simulation: true,
      simulationPorts: { dataSource: () => Promise.resolve({ result: 'preview' }) },
    });
    engines.push(runtime);
    runtime.executor.debugger.resume();
    await runtime.executor.execute([{ type: 'callDataSource', dataSource: 'lookup' }]);
    expect(runtime.store.variable('name')).toBe('preview');
    expect(live).not.toHaveBeenCalled();
  });
  it('rejects stale results, validates mapped response keys, and atomically binds outputs', async () => {
    const first = deferred<unknown>(),
      second = deferred<unknown>(),
      calls = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { runtime } = engine(runtimeFixture(), { dataSource: calls });
    const old = runtime.callDataSource('lookup', undefined);
    const oldRejected = expect(old).rejects.toThrow('VERBIS_RUNTIME_CANCELLED');
    const fresh = runtime.callDataSource('lookup', undefined);
    second.resolve({ result: 'fresh' });
    await fresh;
    first.resolve({ result: 'stale' });
    await oldRejected;
    expect(runtime.store.variable('name')).toBe('fresh');
    calls.mockResolvedValue({ result: 'x', rawResponse: { secret: 'synthetic' } });
    await expect(runtime.callDataSource('lookup', undefined)).rejects.toThrow(
      'VERBIS_DATASOURCE_FAILED',
    );
    expect(runtime.store.variable('name')).toBe('fresh');
  });
  it('does not commit any datasource output when a mapped variable has the wrong type', async () => {
    const doc = runtimeFixture();
    doc.dataSources[0]!.outputs['count'] = { path: '$.count', variable: 'count' };
    const { runtime } = engine(doc, {
      dataSource: () => Promise.resolve({ result: 'would-change', count: 'wrong' }),
    });
    await expect(runtime.callDataSource('lookup', undefined)).rejects.toThrow(
      'VERBIS_VARIABLE_TYPE',
    );
    expect(runtime.store.variable('name')).toBe('');
  });
  it('times out, clears loading, and permits retry', async () => {
    vi.useFakeTimers();
    const calls = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValue({ result: 'retry' });
    const { runtime } = engine(runtimeFixture(), { dataSource: calls });
    const request = runtime.callDataSource('lookup', undefined);
    const rejection = expect(request).rejects.toThrow('VERBIS_DATASOURCE_TIMEOUT');
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
    expect(runtime.store.get('ds.lookup')).toMatchObject({ loading: false, status: 'error' });
    await runtime.callDataSource('lookup', undefined);
    expect(runtime.store.variable('name')).toBe('retry');
  });
  it('sanitizes untrusted error detail and invokes only onError on datasource failure', async () => {
    const { runtime, events } = engine(runtimeFixture(), {
      dataSource: () => Promise.reject(new Error('synthetic private server response')),
    });
    await runtime.executor.execute([
      {
        type: 'callDataSource',
        dataSource: 'lookup',
        onSuccess: [{ type: 'setVariable', variable: 'count', value: 1 }],
        onError: [{ type: 'setVariable', variable: 'count', value: 2 }],
      },
    ]);
    expect(runtime.store.variable('count')).toBe(2);
    expect(JSON.stringify(events)).not.toContain('private server response');
  });
  it('handles all external actions through capability checked ports and blocks absent capabilities', async () => {
    const command = vi.fn().mockResolvedValue(undefined),
      { runtime } = engine(runtimeFixture(), { command });
    const actions: ActionInput[] = [
      { type: 'submitOutcome', outcome: 'DONE' },
      { type: 'setDisposition', code: 'DONE' },
      { type: 'writeBackToPlatform', attributes: { name: { $expr: 'vars.name' } } },
      { type: 'transferHint', target: 'support' },
      { type: 'emitEvent', name: 'offer.accepted', payload: { count: { $expr: 'vars.count' } } },
      { type: 'logEvent', event: 'offer.accepted' },
    ];
    await runtime.executor.execute(actions);
    expect(command).toHaveBeenCalledTimes(6);
    await expect(
      engine().runtime.executor.execute([{ type: 'setDisposition', code: 'DONE' }]),
    ).rejects.toThrow('VERBIS_CAPABILITY_UNAVAILABLE');
  });
  it('executes parallel actions and cancels siblings after a failure', async () => {
    const pending = deferred<undefined>(),
      { runtime } = engine(runtimeFixture(), { command: () => pending.promise });
    const task = runtime.executor.execute([
      {
        type: 'parallel',
        actions: [
          { type: 'setDisposition', code: 'DONE' },
          { type: 'setVariable', variable: 'constant', value: 'bad' },
        ],
      },
    ]);
    await expect(task).rejects.toThrow('VERBIS_VARIABLE_READONLY');
    pending.resolve(undefined);
  });
  it('runs page hooks, modal actions, masking, timers, flow navigation and completion', async () => {
    vi.useFakeTimers();
    const doc = runtimeFixture();
    doc.pages[0]!.onEnter = [{ type: 'setVariable', variable: 'count', value: 1 }];
    doc.pages[0]!.timers = [
      {
        id: 'home-timer',
        durationMs: 1000,
        repeat: false,
        autoStart: false,
        onElapsed: [{ type: 'setVariable', variable: 'count', value: 2 }],
      },
    ];
    const { runtime } = engine(doc);
    await runtime.start();
    expect(runtime.store.get('runtime.page')).toBe('home');
    await runtime.executor.execute([
      { type: 'openModal', page: 'second' },
      { type: 'closeModal' },
      { type: 'maskField', node: 'home-root' },
      { type: 'startTimer', timer: 'home-timer' },
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runtime.store.variable('count')).toBe(2);
    await runtime.executor.execute([{ type: 'stopTimer', timer: 'home-timer' }, { type: 'next' }]);
    expect(runtime.store.get('runtime.page')).toBe('second');
    await runtime.back();
    expect(runtime.store.get('runtime.page')).toBe('home');
    await runtime.executor.execute([{ type: 'navigate', page: 'second' }, { type: 'next' }]);
    expect(runtime.store.get('runtime.ended')).toBe(true);
  });
  it('runs explicit Start, transfer hint and End disposition through the audited executor', async () => {
    const doc = runtimeFixture();
    doc.flow = {
      id: 'main',
      start: 'entry',
      limits: { maxSteps: 200 },
      nodes: [
        { id: 'entry', type: 'start' },
        { id: 'transfer', type: 'transfer', target: 'support' },
        { id: 'end', type: 'end', outcome: 'DONE', disposition: 'RESOLVED' },
      ],
      edges: [
        { id: 'a', from: 'entry', to: 'transfer' },
        { id: 'b', from: 'transfer', to: 'end' },
      ],
    };
    const command = vi.fn(() => Promise.resolve());
    const { runtime, events } = engine(doc, { command });
    await runtime.start();
    expect(command.mock.calls).toHaveLength(3);
    expect(runtime.store.get('runtime.ended')).toBe(true);
    expect(
      events.filter((event) => event.phase === 'completed').map((event) => event.action),
    ).toEqual(['flow', 'transferHint', 'flow', 'setDisposition', 'submitOutcome']);
  });
  it('bounds intentional loops and follows conditional edges before defaults', async () => {
    const doc = runtimeFixture();
    doc.flow.edges[0]!.maxIterations = 1;
    doc.flow.edges.push({
      id: 'return-edge',
      from: 'second-flow',
      to: 'home-flow',
      when: { $expr: 'vars.count == 0' },
      maxIterations: 1,
    });
    const { runtime } = engine(doc);
    await runtime.start();
    await runtime.next();
    await runtime.next();
    expect(runtime.store.get('runtime.page')).toBe('home');
    await expect(runtime.next()).rejects.toThrow('VERBIS_FLOW_LIMIT');
  });
  it('supports subflow pages and explicit rule execution', async () => {
    const doc = runtimeFixture();
    doc.subflows.push({
      id: 'child-flow',
      start: 'child-page',
      nodes: [
        { id: 'child-page', type: 'page', page: 'second' },
        { id: 'child-end', type: 'end' },
      ],
      edges: [{ id: 'child-edge', from: 'child-page', to: 'child-end' }],
      limits: { maxSteps: 10 },
    });
    const { runtime } = engine(doc);
    await runtime.start();
    runtime.store.setVariable('name', 'present');
    await runtime.runRule('has-name');
    expect(runtime.store.variable('count')).toBe(1);
    await runtime.executor.execute([{ type: 'runSubflow', flow: 'child-flow' }]);
    expect(runtime.store.get('runtime.page')).toBe('second');
  });
  it('rejects malformed documents, actions and global variable defaults without leaking payloads', async () => {
    expect(() => engine({} as ScriptDocument)).toThrow('VERBIS_DOCUMENT_INVALID');
    await expect(
      engine().runtime.executor.execute([{ type: 'unsupported' } as unknown as ActionInput]),
    ).rejects.toThrow();
  });
  it('preserves private classification across assignments before diagnostic sinks', async () => {
    const doc = runtimeFixture(),
      name = doc.variables.find((v) => v.key === 'name');
    if (!name) throw new Error('Missing fixture variable');
    name.classification = 'pii';
    name.pii = true;
    const command = vi.fn().mockResolvedValue(undefined),
      { runtime } = engine(doc, { command });
    await runtime.executor.execute([
      { type: 'setVariable', variable: 'other', value: { $expr: 'vars.name' } },
    ]);
    await expect(
      runtime.executor.execute([
        { type: 'logEvent', event: 'offer.accepted', data: { value: { $expr: 'vars.other' } } },
      ]),
    ).rejects.toThrow('VERBIS_SENSITIVE_SINK');
    expect(command).not.toHaveBeenCalled();
  });
  it('bounds action recursion across nested page lifecycle hooks', async () => {
    const doc = runtimeFixture();
    doc.pages[0]!.onEnter = [{ type: 'navigate', page: 'home' }];
    const { runtime } = engine(doc);
    await expect(runtime.start()).rejects.toThrow('VERBIS_ACTION_LIMIT');
  });
  it('requires mandatory pages to be visited before submitting', async () => {
    const doc = runtimeFixture();
    doc.pages[1]!.mandatory = true;
    const { runtime } = engine(doc, { command: vi.fn().mockResolvedValue(undefined) });
    await runtime.start();
    await expect(
      runtime.executor.execute([{ type: 'submitOutcome', outcome: 'DONE' }]),
    ).rejects.toThrow('VERBIS_MANDATORY_PAGE_UNVISITED');
    await runtime.next();
    await runtime.executor.execute([{ type: 'submitOutcome', outcome: 'DONE' }]);
  });
  it('supports ICU interpolation and locale fallback', () => {
    const runtime = new Runtime({
      document: runtimeFixture(),
      registry: createCoreRegistry(),
      session: { locale: 'en' },
      ports: { sessionEvent: vi.fn() },
    });
    engines.push(runtime);
    expect(runtime.message('common.greeting', { name: 'Demo' })).toBe('Hello Demo');
    expect(runtime.message('missing.key')).toBe('missing.key');
  });
});

describe('authorized session resume', () => {
  it('restores a page without replaying on-enter or flow side effects', async () => {
    const doc = runtimeFixture();
    doc.pages[0]!.onEnter = [{ type: 'setVariable', variable: 'count', value: 7 }];
    const { runtime } = engine(doc);
    const before = runtime.store.variable('count');
    runtime.resume(doc.pages[0]!.id);
    expect(runtime.store.variable('count')).toEqual(before);
    expect(runtime.store.get('runtime.page')).toBe(doc.pages[0]!.id);
    await expect(runtime.navigate(doc.pages[0]!.id)).resolves.toBeUndefined();
  });
  it('fences page navigation before changing the current page', async () => {
    const { runtime } = engine(runtimeFixture(), {
      navigationGuard: () => {
        throw Error('unsynchronized');
      },
    });
    runtime.resume(runtime.document.pages[0]!.id);
    await expect(runtime.next()).rejects.toThrow('unsynchronized');
    expect(runtime.store.get('runtime.page')).toBe(runtime.document.pages[0]!.id);
  });
});

it('persists a page transition before running entry effects and preserves the previous page on rejection', async () => {
  const port = vi.fn().mockRejectedValue(new Error('Synthetic navigation failure'));
  const { runtime } = engine(runtimeFixture(), { pageChange: port });
  runtime.resume('home');
  await expect(runtime.next()).rejects.toThrow('Synthetic navigation failure');
  expect(runtime.store.get('runtime.page')).toBe('home');
  port.mockResolvedValue(undefined);
  await runtime.next();
  expect(port).toHaveBeenLastCalledWith('second', ['home'], expect.any(AbortSignal));
  expect(runtime.store.get('runtime.page')).toBe('second');
});
it('resumes a nested subflow page and history without replaying commands', async () => {
  const document = runtimeFixture();
  document.subflows = [
    {
      ...document.flow,
      id: 'nested',
      start: 'nested-page',
      nodes: [
        { id: 'nested-page', type: 'page', page: 'second' },
        { id: 'nested-end', type: 'end' },
      ],
      edges: [{ id: 'nested-edge', from: 'nested-page', to: 'nested-end' }],
    },
  ];
  document.flow = {
    ...document.flow,
    nodes: [
      { id: 'home-flow', type: 'page', page: 'home' },
      { id: 'call-nested', type: 'subflow', flow: 'nested' },
      { id: 'end-flow', type: 'end' },
    ],
    edges: [
      { id: 'first-edge', from: 'home-flow', to: 'call-nested' },
      { id: 'last-edge', from: 'call-nested', to: 'end-flow' },
    ],
  };
  const command = vi.fn(),
    { runtime } = engine(document, { command });
  runtime.resume('second', ['home']);
  expect(runtime.store.get('runtime.page')).toBe('second');
  expect(runtime.store.get('runtime.visited.home')).toBe(true);
  expect(command).not.toHaveBeenCalled();
  await runtime.back();
  expect(runtime.store.get('runtime.page')).toBe('home');
  expect(() => {
    runtime.resume('home');
  }).toThrow('VERBIS_RUNTIME_STARTED');
});
it('restores pending sources as idle and rejects invalid checkpoint frames', async () => {
  const { runtime } = engine(runtimeFixture(), {}, true);
  runtime.executor.debugger.resume();
  await runtime.start();
  runtime.store.set('ds.lookup', { status: 'loading', loading: true, error: null });
  const checkpoint = runtime.checkpoint();
  const restored = engine(runtimeFixture(), {}, true).runtime;
  restored.restore(checkpoint);
  expect(restored.store.get('ds.lookup')).toEqual({ status: 'idle', loading: false, error: null });
  expect(() => {
    restored.restore(checkpoint);
  }).toThrow('VERBIS_PREVIEW_ONLY');
  const bad = engine(runtimeFixture(), {}, true).runtime;
  expect(() => {
    bad.restore({ ...checkpoint, frames: [{ ...checkpoint.frames[0]!, flowId: 'missing' }] });
  }).toThrow('VERBIS_FLOW_NODE_UNKNOWN');
  const invalidNode = engine(runtimeFixture(), {}, true).runtime;
  expect(() => {
    invalidNode.restore({
      ...checkpoint,
      frames: [{ ...checkpoint.frames[0]!, cursor: 'missing' }],
    });
  }).toThrow('VERBIS_FLOW_NODE_UNKNOWN');
});
it('records read acknowledgements only as bounded telemetry in a live runtime', () => {
  const telemetry = vi.fn(),
    simulationInput = vi.fn(),
    { runtime } = engine(runtimeFixture(), { telemetry, simulationInput });
  runtime.recordInput({ type: 'read', node: 'node', acknowledged: true });
  runtime.recordInput({ type: 'read', node: 'node', acknowledged: false });
  runtime.recordInput({ type: 'variable', variable: 'name', value: 'private' });
  expect(telemetry.mock.calls.map(([event]) => event as unknown)).toEqual([
    { type: 'text.acknowledged', name: 'node', status: 'success', durationMs: 0 },
    { type: 'text.acknowledged', name: 'node', status: 'failure', durationMs: 0 },
  ]);
  expect(simulationInput).not.toHaveBeenCalled();
});
it('finds nested datasource request nodes and rejects unrelated node ids', () => {
  const document = runtimeFixture([
    {
      id: 'group',
      type: 'box',
      children: [{ id: 'source', type: 'webService', props: { ds: 'lookup' } }],
    },
  ]);
  const { runtime } = engine(document);
  runtime.request('source');
  runtime.request('source');
  expect(runtime.store.get('runtime.request.source')).toBe(2);
  expect(() => {
    runtime.request('group');
  }).toThrow('VERBIS_NODE_UNKNOWN');
  expect(() => {
    runtime.request('missing');
  }).toThrow('VERBIS_NODE_UNKNOWN');
});
it('stops repeat timers explicitly and reports failed elapsed actions without unhandled rejection', async () => {
  const document = runtimeFixture();
  document.pages[0]!.timers = [
    {
      id: 'repeat',
      durationMs: 1000,
      repeat: true,
      autoStart: false,
      onElapsed: [{ type: 'setVariable', variable: 'count', value: { $expr: 'vars.count + 1' } }],
    },
  ];
  const { runtime, events } = engine(document);
  await runtime.start();
  vi.useFakeTimers();
  runtime.startTimer('repeat');
  await vi.advanceTimersByTimeAsync(3000);
  expect(runtime.store.variable('count')).toBe(3);
  runtime.stopTimer('repeat');
  await vi.advanceTimersByTimeAsync(500);
  expect(runtime.store.variable('count')).toBe(3);
  runtime.page('home').timers[0]!.onElapsed = [{ type: 'emitEvent', name: 'event', payload: {} }];
  runtime.startTimer('repeat');
  await vi.advanceTimersByTimeAsync(1000);
  expect(events).toContainEqual(
    expect.objectContaining({ action: 'startTimer', phase: 'failed', code: 'VERBIS_TIMER_FAILED' }),
  );
  expect(() => {
    runtime.startTimer('unknown');
  }).toThrow('VERBIS_TIMER_UNKNOWN');
});
it('handles rule failure with a stable error and emits no private exception text', async () => {
  const document = runtimeFixture();
  document.rules[0]!.then = [{ type: 'emitEvent', name: 'event', payload: {} }];
  const { runtime, events } = engine(document, {
    command: () => Promise.reject(new Error('private error')),
  });
  runtime.store.setVariable('name', 'trigger');
  await expect(runtime.runRule('has-name')).rejects.toThrow('VERBIS_RULE_FAILED');
  expect(events).toContainEqual(
    expect.objectContaining({ action: 'rule', phase: 'failed', code: 'VERBIS_RULE_FAILED' }),
  );
  expect(JSON.stringify(events)).not.toContain('private error');
  await expect(runtime.runRule('unknown')).rejects.toThrow('VERBIS_RULE_UNKNOWN');
});

it.each([false, true])(
  'routes datasource flow success and error ports without executing the opposite branch (failure=%s)',
  async (failure) => {
    const document = runtimeFixture();
    document.flow = FlowSchema.parse({
      id: 'main',
      start: 'lookup-node',
      nodes: [
        { id: 'lookup-node', type: 'dataSource', dataSource: 'lookup' },
        { id: 'good', type: 'page', page: 'home' },
        { id: 'bad', type: 'page', page: 'second' },
      ],
      edges: [
        { id: 'success', from: 'lookup-node', to: 'good', port: 'success' },
        { id: 'failure', from: 'lookup-node', to: 'bad', port: 'error' },
      ],
    });
    const { runtime } = engine(document, {
      dataSource: () =>
        failure
          ? Promise.reject(new Error('private upstream'))
          : Promise.resolve({ result: 'synthetic' }),
    });
    await runtime.start();
    expect(runtime.store.get('runtime.page')).toBe(failure ? 'second' : 'home');
  },
);
it('rejects unknown datasources, disposed requests, missing timers and invalid page transitions safely', async () => {
  const { runtime } = engine();
  await expect(runtime.callDataSource('missing', undefined)).rejects.toThrow(
    'VERBIS_DATASOURCE_UNKNOWN',
  );
  expect(() => {
    runtime.startTimer('missing');
  }).toThrow('VERBIS_PAGE_UNKNOWN');
  await runtime.start();
  expect(() => {
    runtime.startTimer('missing');
  }).toThrow('VERBIS_TIMER_UNKNOWN');
  await expect(runtime.navigate('missing')).rejects.toThrow('VERBIS_PAGE_UNKNOWN');
  runtime.dispose();
  await expect(runtime.callDataSource('lookup', undefined)).rejects.toThrow(
    'VERBIS_RUNTIME_DISPOSED',
  );
  await runtime.start();
});
it('enforces mandatory page validation on navigation and outcome submission', async () => {
  const document = runtimeFixture();
  document.pages[0]!.mandatory = true;
  const { runtime } = engine(document, { command: vi.fn().mockResolvedValue(undefined) });
  await runtime.start();
  vi.spyOn(runtime.validation, 'page').mockResolvedValue([
    { node: 'synthetic', messageKey: 'runtime.required' },
  ]);
  await expect(runtime.next()).rejects.toThrow('VERBIS_VALIDATION_FAILED');
  await expect(runtime.navigate('second')).rejects.toThrow('VERBIS_VALIDATION_FAILED');
  expect(runtime.store.get('runtime.page')).toBe('home');
  vi.spyOn(runtime.validation, 'script').mockResolvedValue([
    { node: 'synthetic', messageKey: 'runtime.required' },
  ]);
  await expect(
    runtime.executor.execute([{ type: 'submitOutcome', outcome: 'DONE' }]),
  ).rejects.toThrow('VERBIS_VALIDATION_FAILED');
});
it('restores history after a rejected back transition and retries it without replaying an entry side effect', async () => {
  const persist = vi.fn().mockResolvedValue(undefined),
    { runtime } = engine(runtimeFixture(), { pageChange: persist });
  await runtime.start();
  await runtime.next();
  persist.mockRejectedValueOnce(new Error('synthetic persistence failure'));
  await expect(runtime.back()).rejects.toThrow('synthetic persistence failure');
  expect(runtime.store.get('runtime.page')).toBe('second');
  await runtime.back();
  expect(runtime.store.get('runtime.page')).toBe('home');
  await runtime.back();
  expect(runtime.store.get('runtime.page')).toBe('home');
});
// M-Z6: "İyi günler, ben . Size özel…" — an empty or missing value must stay visible as a
// named gap, never collapse silently or replace the whole sentence with its key.
it('handles booleans and structured ICU values and marks empty or missing parameters visibly', () => {
  const document = runtimeFixture();
  document.i18n.messages['tr']!['synthetic.params'] = '{bool}|{nil}|{structured}';
  document.i18n.messages['tr']!['synthetic.greeting'] =
    'İyi günler, ben {agent}. Size özel teklif.';
  const { runtime } = engine(document);
  expect(
    runtime.message('synthetic.params', { bool: true, nil: null, structured: { key: 'value' } }),
  ).toBe('true|[nil]|{"key":"value"}');
  expect(runtime.message('synthetic.params')).toBe('[bool]|[nil]|[structured]');
  expect(runtime.message('synthetic.greeting', { agent: '' })).toBe(
    'İyi günler, ben [agent]. Size özel teklif.',
  );
  expect(runtime.message('synthetic.greeting', { agent: '  ' })).toBe(
    'İyi günler, ben [agent]. Size özel teklif.',
  );
  expect(runtime.message('synthetic.greeting', { agent: 'Ayşe' })).toBe(
    'İyi günler, ben Ayşe. Size özel teklif.',
  );
  expect(runtime.message('missing.key')).toBe('missing.key');
});
it('isolates a failed telemetry transport and suppresses simulation timers when configured', async () => {
  const document = runtimeFixture();
  document.pages[0]!.timers = [
    {
      id: 'synthetic',
      durationMs: 1000,
      autoStart: true,
      repeat: false,
      onElapsed: [{ type: 'setVariable', variable: 'count', value: 10 }],
    },
  ];
  const runtime = new Runtime({
    document,
    registry: createCoreRegistry(),
    ports: {
      sessionEvent: () => {
        throw new Error('synthetic transport failure');
      },
    },
    simulation: true,
    simulationTimers: false,
  });
  engines.push(runtime);
  runtime.executor.debugger.resume();
  vi.useFakeTimers();
  await runtime.start();
  await vi.advanceTimersByTimeAsync(2000);
  expect(runtime.store.variable('count')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('runs explicit invalid-validation recovery actions before stopping the remaining chain', async () => {
  const { runtime } = engine();
  await expect(runtime.executor.execute([{ type: 'validatePage' }])).rejects.toThrow(
    'VERBIS_PAGE_UNKNOWN',
  );
  await runtime.start();
  vi.spyOn(runtime.validation, 'page').mockResolvedValue([
    { node: 'synthetic', messageKey: 'runtime.required' },
  ]);
  await expect(
    runtime.executor.execute([
      { type: 'validatePage', onInvalid: [{ type: 'setVariable', variable: 'count', value: 12 }] },
      { type: 'setVariable', variable: 'count', value: 99 },
    ]),
  ).rejects.toThrow('VERBIS_VALIDATION_FAILED');
  expect(runtime.store.variable('count')).toBe(12);
});
it('runs rule and conditional fallback branches explicitly and rejects missing rules and subflows', async () => {
  const document = runtimeFixture();
  document.rules[0]!.else = [{ type: 'setVariable', variable: 'count', value: 2 }];
  const { runtime } = engine(document);
  await runtime.runRule('has-name');
  expect(runtime.store.variable('count')).toBe(2);
  await runtime.executor.execute([
    {
      type: 'conditional',
      if: { $expr: 'false' },
      then: [],
      else: [{ type: 'setVariable', variable: 'count', value: 3 }],
    },
  ]);
  expect(runtime.store.variable('count')).toBe(3);
  await runtime.executor.execute([{ type: 'conditional', if: { $expr: 'false' }, then: [] }]);
  await expect(runtime.runRule('missing')).rejects.toThrow('VERBIS_RULE_UNKNOWN');
  await expect(runtime.runSubflow('missing', runtime.signal)).rejects.toThrow(
    'VERBIS_SUBFLOW_INVALID',
  );
});
it('resynchronizes an authorized cursor atomically without replaying external commands', async () => {
  const command = vi.fn(),
    { runtime } = engine(runtimeFixture(), { command });
  runtime.resume('home');
  runtime.resynchronize('second', ['home']);
  expect(runtime.store.get('runtime.page')).toBe('second');
  expect(command).not.toHaveBeenCalled();
  expect(() => {
    runtime.resynchronize('home', ['missing']);
  }).toThrow('VERBIS_FLOW_NODE_UNKNOWN');
  expect(runtime.store.get('runtime.page')).toBe('second');
  await runtime.back();
  expect(runtime.store.get('runtime.page')).toBe('home');
  runtime.dispose();
  expect(() => {
    runtime.resynchronize('second');
  }).toThrow('VERBIS_RUNTIME_DISPOSED');
});
