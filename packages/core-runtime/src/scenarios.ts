import {
  findNode,
  JsonValueSchema,
  TestScenarioSchema,
  type TestScenario,
  type JsonValue,
} from '@verbis/script-schema';

import { RuntimeProblem, abortable } from './problem.js';
import { Runtime } from './runtime.js';

import type { DataSourceRequest } from './ports.js';
import type { ComponentRegistry } from './registry.js';

export function mockDataSource(sources: TestScenario['dataSources']) {
  return async (request: DataSourceRequest): Promise<Record<string, JsonValue>> => {
    const mock = sources[request.id];
    if (!mock) throw new RuntimeProblem('VERBIS_PREVIEW_MOCK_MISSING');
    if (mock.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const stop = () => {
          clearTimeout(timer);
          reject(new RuntimeProblem('VERBIS_RUNTIME_CANCELLED'));
        };
        const timer = setTimeout(() => {
          request.signal.removeEventListener('abort', stop);
          resolve();
        }, mock.delayMs);
        if (request.signal.aborted) stop();
        else request.signal.addEventListener('abort', stop, { once: true });
      });
    }
    if (mock.kind === 'error') throw new RuntimeProblem('VERBIS_PREVIEW_MOCK_ERROR');
    return mock.kind === 'empty'
      ? Object.fromEntries(
          Object.entries(mock.outputs).map(([key, value]) => [
            key,
            Array.isArray(value) ? [] : null,
          ]),
        )
      : structuredClone(mock.outputs);
  };
}
export interface ScenarioResult {
  id: string;
  passed: boolean;
  durationMs: number;
  assertions: { path: string; passed: boolean }[];
  code?: string;
}
/** Executes the exact action/flow/validation engine with mock-only ports, never external side effects. */
export async function runScenario(
  document: unknown,
  registry: ComponentRegistry,
  input: TestScenario,
  timeoutMs = 5000,
): Promise<ScenarioResult> {
  const scenario = TestScenarioSchema.parse(input);
  const began = Date.now();
  let outcome: string | undefined;
  const runtime = new Runtime({
    document,
    registry,
    session: scenario.context,
    simulation: true,
    simulationTimers: false,
    ports: { sessionEvent: () => undefined, now: () => 0 },
    simulationPorts: {
      dataSource: mockDataSource(scenario.dataSources),
      command: (action) => {
        if (action.type === 'submitOutcome') outcome = action.outcome;
        return Promise.resolve();
      },
    },
  });
  runtime.executor.debugger.resume();
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort();
  }, timeoutMs);
  const result: ScenarioResult = { id: scenario.id, passed: false, durationMs: 0, assertions: [] };
  try {
    await abortable(
      (async () => {
        await runtime.start(deadline.signal);
        for (const step of scenario.steps) {
          if (step.type === 'variable') runtime.store.setVariable(step.variable, step.value);
          else if (step.type === 'read') {
            const node = findNode(runtime.document, step.node)?.node;
            if (node?.props['mustRead'] !== true) throw new RuntimeProblem('VERBIS_NODE_UNKNOWN');
            runtime.store.set(`runtime.read.${step.node}`, step.acknowledged);
          } else if (step.type === 'actions') {
            try {
              await runtime.executor.execute(step.actions, deadline.signal);
            } catch (error) {
              if (!step.ignoreError || deadline.signal.aborted) throw error;
            }
          } else {
            const location = findNode(runtime.document, step.node);
            if (
              location?.pageId !== runtime.store.get('runtime.page') ||
              !runtime.condition(location.node.enabledWhen) ||
              !runtime.condition(location.node.visibleWhen)
            )
              throw new RuntimeProblem('VERBIS_PREVIEW_EVENT_UNAVAILABLE');
            let current = location;
            for (;;) {
              if (
                !runtime.condition(current.node.enabledWhen) ||
                !runtime.condition(current.node.visibleWhen) ||
                current.node.props['disabled'] === true
              )
                throw new RuntimeProblem('VERBIS_PREVIEW_EVENT_UNAVAILABLE');
              if (!current.parent) break;
              const parent = findNode(runtime.document, current.parent.id);
              if (!parent) throw new RuntimeProblem('VERBIS_NODE_UNKNOWN');
              current = parent;
            }
            if (!registry.get(location.node.type).events.includes(step.event))
              throw new RuntimeProblem('VERBIS_COMPONENT_EVENT');
            await runtime.executor.execute(location.node.events[step.event] ?? [], deadline.signal);
          }
        }
      })(),
      deadline.signal,
    );
    const assert = (path: string, actual: unknown, expected: unknown) => {
      const canonical = (value: unknown): string => {
        if (value && typeof value === 'object' && !Array.isArray(value))
          return JSON.stringify(
            Object.fromEntries(
              Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, child]) => [key, canonical(child)]),
            ),
          );
        if (Array.isArray(value)) return JSON.stringify(value.map(canonical));
        return value === undefined ? 'undefined' : JSON.stringify(value);
      };
      result.assertions.push({ path, passed: canonical(actual) === canonical(expected) });
    };
    if (scenario.expected.outcome !== undefined)
      assert('outcome', outcome, scenario.expected.outcome);
    if (scenario.expected.page !== undefined)
      assert('page', runtime.store.get('runtime.page'), scenario.expected.page);
    if (scenario.expected.ended !== undefined)
      assert('ended', runtime.store.get('runtime.ended') === true, scenario.expected.ended);
    for (const [key, value] of Object.entries(scenario.expected.variables))
      assert(`vars.${key}`, JsonValueSchema.parse(runtime.store.variable(key)), value);
    result.passed = result.assertions.every((assertion) => assertion.passed);
  } catch (error) {
    result.code = error instanceof RuntimeProblem ? error.code : 'VERBIS_PREVIEW_SCENARIO_FAILED';
  } finally {
    clearTimeout(timer);
    runtime.dispose();
    result.durationMs = Date.now() - began;
  }
  return result;
}
