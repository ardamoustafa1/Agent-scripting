import { expect, it } from 'vitest';

import { TestScenarioSchema } from '@verbis/script-schema';

import { runtimeFixture } from './fixtures.js';
import { scenarioReleaseGate } from './release-gate.js';

const document = {
  ...runtimeFixture([{ id: 'terms', type: 'textInput', props: { mustRead: true } }]),
  dataSources: [{ id: 'crm' }],
} as never;
const scenario = (steps: unknown[], dataSources: Record<string, unknown> = {}) =>
  TestScenarioSchema.parse({
    id: 's1',
    name: 'S',
    synthetic: true,
    context: {},
    steps,
    dataSources,
    expected: { page: 'home' },
  });
const pass = [{ id: 's1', passed: true, durationMs: 1, assertions: [] }];
const good = scenario([{ type: 'read', node: 'terms', acknowledged: true }], {
  crm: { kind: 'error', outputs: {}, delayMs: 0 },
});
it('allows a release only with passing scenarios covering reads and services', () => {
  expect(scenarioReleaseGate(document, [good], pass)).toEqual({ ok: true, issues: [] });
});
it('blocks missing, failing, unread-legal-text and unmocked-service scenarios', () => {
  expect(scenarioReleaseGate(document, [], []).issues.map((i) => i.code)).toContain('NO_SCENARIOS');
  expect(
    scenarioReleaseGate(document, [good], [{ ...pass[0]!, passed: false }]).issues[0]?.code,
  ).toBe('SCENARIO_FAILED');
  expect(scenarioReleaseGate(document, [good], []).issues[0]?.code).toBe('SCENARIO_MISSING_RESULT');
  const bare = scenario([]);
  expect(scenarioReleaseGate(document, [bare], pass).issues.map((i) => i.code)).toEqual([
    'MUSTREAD_UNCOVERED',
    'SERVICE_UNCOVERED',
  ]);
});
