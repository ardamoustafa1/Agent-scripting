import { walkNodes, type ScriptDocument, type TestScenario } from '@verbis/script-schema';

import type { ScenarioResult } from './scenarios.js';

export interface ReleaseGateIssue {
  code:
    | 'NO_SCENARIOS'
    | 'SCENARIO_FAILED'
    | 'SCENARIO_MISSING_RESULT'
    | 'MUSTREAD_UNCOVERED'
    | 'SERVICE_UNCOVERED';
  /** Scenario id, node id or data source id the issue is about. */
  subject: string;
}
/**
 * Release gate over synthetic call scenarios: publication is allowed only when scenarios exist,
 * every one ran and passed, every mustRead node is exercised by a `read` step and every declared
 * data source has a mock in at least one scenario (so a broken service path cannot ship untested).
 */
export function scenarioReleaseGate(
  document: ScriptDocument,
  scenarios: readonly TestScenario[],
  results: readonly ScenarioResult[],
): { ok: boolean; issues: ReleaseGateIssue[] } {
  const issues: ReleaseGateIssue[] = [];
  if (scenarios.length === 0) issues.push({ code: 'NO_SCENARIOS', subject: '' });
  for (const scenario of scenarios) {
    const result = results.find((r) => r.id === scenario.id);
    if (!result) issues.push({ code: 'SCENARIO_MISSING_RESULT', subject: scenario.id });
    else if (!result.passed) issues.push({ code: 'SCENARIO_FAILED', subject: scenario.id });
  }
  const read = new Set(
    scenarios.flatMap((s) => s.steps.flatMap((step) => (step.type === 'read' ? [step.node] : []))),
  );
  walkNodes(document, ({ node }) => {
    if (node.props['mustRead'] === true && !read.has(node.id))
      issues.push({ code: 'MUSTREAD_UNCOVERED', subject: node.id });
    return true;
  });
  const mocked = new Set(scenarios.flatMap((s) => Object.keys(s.dataSources)));
  for (const source of document.dataSources)
    if (!mocked.has(source.id)) issues.push({ code: 'SERVICE_UNCOVERED', subject: source.id });
  return { ok: issues.length === 0, issues };
}
