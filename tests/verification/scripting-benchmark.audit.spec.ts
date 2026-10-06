import { mkdirSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from '../../apps/api/node_modules/vitest/dist/index.js';
import { createComponentRegistry } from '../../packages/components/dist/index.js';
import { runScenario } from '../../packages/core-runtime/dist/index.js';
import { TestScenarioSchema } from '../../packages/script-schema/dist/index.js';

import { benchmarkDocument, benchmarkScenarios, faultyBenchmark } from './scripting-benchmark.js';

const evidence = process.env['BENCHMARK_EVIDENCE'] ?? '/tmp/verbis-scripting-benchmark';
const results: unknown[] = [];
const gate = TestScenarioSchema.parse({
  id: 'unreadLegal',
  name: 'Unread legal text must block navigation',
  synthetic: true,
  context: {},
  steps: [
    { type: 'actions', ignoreError: true, actions: [{ type: 'validatePage' }, { type: 'next' }] },
  ],
  expected: { page: 'welcome', variables: { parcelStatus: '' } },
});

describe('neutral agent scripting benchmark', () => {
  for (const scenario of benchmarkScenarios)
    it(`finishes ${scenario.id} through both data sources and outcome`, async () => {
      const result = await runScenario(benchmarkDocument, createComponentRegistry(), scenario);
      results.push(result);
      expect(result.passed, JSON.stringify(result)).toBe(true);
    });
  it('blocks unread mandatory text', async () => {
    const result = await runScenario(benchmarkDocument, createComponentRegistry(), gate);
    results.push(result);
    expect(result.passed, JSON.stringify(result)).toBe(true);
  });
  for (const kind of ['branch', 'mapping', 'compliance'] as const)
    it(`detects intentional ${kind} defect and passes after repair`, async () => {
      const scenario = kind === 'compliance' ? gate : benchmarkScenarios[0]!;
      const broken = await runScenario(faultyBenchmark(kind), createComponentRegistry(), scenario);
      const repaired = await runScenario(benchmarkDocument, createComponentRegistry(), scenario);
      results.push({ defect: kind, broken, repaired });
      expect(broken.passed).toBe(false);
      if (kind === 'branch') expect(broken.code).toBe('VERBIS_PREVIEW_EVENT_UNAVAILABLE');
      else
        expect(broken.assertions).toContainEqual({
          path: kind === 'mapping' ? 'vars.parcelStatus' : 'page',
          passed: false,
        });
      expect(repaired.passed).toBe(true);
    });
  it('exports reproducible synthetic comparison packet', () => {
    mkdirSync(evidence, { recursive: true });
    for (const [file, data] of Object.entries({
      'script.json': benchmarkDocument,
      'scenarios.json': benchmarkScenarios,
      'mandatory-gate.json': gate,
      'results.json': results,
      ...Object.fromEntries(
        ['branch', 'mapping', 'compliance'].map((kind) => [
          `fault-${kind}.json`,
          faultyBenchmark(kind as 'branch' | 'mapping' | 'compliance'),
        ]),
      ),
    }))
      writeFileSync(`${evidence}/${file}`, JSON.stringify(data, null, 2) + '\n');
    expect(benchmarkDocument.pages).toHaveLength(5);
    expect(benchmarkDocument.dataSources).toHaveLength(2);
  });
});
