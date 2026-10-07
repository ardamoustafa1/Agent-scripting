import { describe, expect, it } from 'vitest';

import {
  DataSourceRefSchema,
  RuleSchema,
  VariableSchema,
  ScriptDocumentSchema,
  TestScenarioSchema,
  type ScriptDocument,
} from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { editorRegistry } from '../editor/store.js';

import { analyzeCoverage, generateForBranch } from './coverage.js';

function page(id: string) {
  return {
    id,
    name: id,
    layout: {
      id: `${id}-root`,
      type: 'box',
      children: [
        {
          id: `${id}-next`,
          type: 'button',
          props: { labelKey: 'common.next' },
          events: { onPress: [{ type: 'next' }] },
        },
      ],
    },
  };
}

/** home → decide → (tier == "vip" ? vip : standard) → end */
function branching(edit: (doc: ScriptDocument) => void = () => undefined): ScriptDocument {
  const doc = ScriptDocumentSchema.parse({
    ...minimalScript(),
    variables: [
      { key: 'tier', type: 'string', scope: 'session', default: 'standard' },
      { key: 'tckn', type: 'string', scope: 'session', pii: true },
    ],
    pages: [page('home'), page('vip'), page('standard')],
    flow: {
      id: 'main',
      start: 'n-home',
      nodes: [
        { id: 'n-home', type: 'page', page: 'home' },
        { id: 'n-decide', type: 'decision' },
        { id: 'n-vip', type: 'page', page: 'vip' },
        { id: 'n-standard', type: 'page', page: 'standard' },
        { id: 'n-end', type: 'end' },
      ],
      edges: [
        { id: 'e-home', from: 'n-home', to: 'n-decide' },
        { id: 'e-vip', from: 'n-decide', to: 'n-vip', when: { $expr: 'vars.tier == "vip"' } },
        { id: 'e-standard', from: 'n-decide', to: 'n-standard', default: true },
        { id: 'e-vip-end', from: 'n-vip', to: 'n-end' },
        { id: 'e-standard-end', from: 'n-standard', to: 'n-end' },
      ],
    },
  });
  doc.testScenarios = [
    TestScenarioSchema.parse({
      id: 'standardPath',
      name: 'Standard path',
      synthetic: true,
      context: {},
      steps: [{ type: 'event', node: 'home-next', event: 'onPress' }],
      expected: { page: 'standard' },
    }),
  ];
  edit(doc);
  return doc;
}

describe('analyzeCoverage', () => {
  it('measures flow-qualified branch coverage of the saved scenarios', async () => {
    const report = await analyzeCoverage(branching(), editorRegistry);
    expect(report.results.map((r) => r.passed)).toEqual([true]);
    expect(report.totalEdges).toBe(5);
    expect(report.coveredEdges).toBe(2);
    expect(report.percent).toBe(40);
    expect(report.edges.has('main:e-standard')).toBe(true);
    expect(report.uncovered.map((gap) => [gap.edgeId, gap.kind])).toEqual([
      ['e-vip', 'condition'],
      ['e-vip-end', 'plain'],
      ['e-standard-end', 'plain'],
    ]);
  });

  it('reports no percentage for a flow without edges and nothing covered without scenarios', async () => {
    const doc = ScriptDocumentSchema.parse(minimalScript());
    doc.flow.edges = [];
    expect((await analyzeCoverage(doc, editorRegistry, [])).percent).toBeNull();
    const none = await analyzeCoverage(branching(), editorRegistry, []);
    expect(none.coveredEdges).toBe(0);
    expect(none.uncovered).toHaveLength(5);
  });
});

describe('generateForBranch', () => {
  it('finds the condition value that opens an untested branch and asserts where it lands', async () => {
    const doc = branching();
    const report = await analyzeCoverage(doc, editorRegistry);
    const gap = report.uncovered.find((candidate) => candidate.edgeId === 'e-vip')!;
    const scenario = await generateForBranch(doc, editorRegistry, gap, report, 'VIP branch');
    expect(scenario).not.toBeNull();
    expect(scenario?.synthetic).toBe(true);
    expect(scenario?.name).toBe('VIP branch');
    expect(scenario?.context.variables).toEqual({ tier: 'vip' });
    expect(scenario?.expected).toEqual({ page: 'vip', variables: {} });
    // The generated scenario passes and covers the branch on its own.
    const after = await analyzeCoverage(doc, editorRegistry, [scenario!]);
    expect(after.results[0]?.passed).toBe(true);
    expect(after.edges.has('main:e-vip')).toBe(true);
  });

  it('never varies sensitive variables, so a PII-only branch is reported as not found', async () => {
    const doc = branching((d) => {
      const edge = d.flow.edges.find((e) => e.id === 'e-vip')!;
      edge.when = { $expr: 'vars.tckn == "12345678901"' };
    });
    const report = await analyzeCoverage(doc, editorRegistry);
    const gap = report.uncovered.find((candidate) => candidate.edgeId === 'e-vip')!;
    expect(await generateForBranch(doc, editorRegistry, gap, report, 'PII branch')).toBeNull();
  });

  it('opens a data source error port by switching that mock to an error', async () => {
    const doc = branching((d) => {
      d.dataSources = [
        DataSourceRefSchema.parse({
          id: 'lookup',
          ref: 'tenant-datasource:lookup',
          version: 1,
          outputs: { tier: { path: '$.tier', variable: 'tier' } },
        }),
      ];
      d.flow.nodes.splice(1, 0, { id: 'n-lookup', type: 'dataSource', dataSource: 'lookup' });
      d.flow.edges = [
        { id: 'e-home', from: 'n-home', to: 'n-lookup' },
        { id: 'e-ok', from: 'n-lookup', to: 'n-decide', port: 'success' },
        { id: 'e-fail', from: 'n-lookup', to: 'n-standard', port: 'error' },
        ...d.flow.edges.filter((e) => e.id !== 'e-home'),
      ];
      d.testScenarios = [
        TestScenarioSchema.parse({
          id: 'lookupOk',
          name: 'Lookup ok',
          synthetic: true,
          context: {},
          dataSources: { lookup: { kind: 'success', outputs: { tier: 'standard' } } },
          steps: [{ type: 'event', node: 'home-next', event: 'onPress' }],
          expected: { page: 'standard' },
        }),
      ];
    });
    const report = await analyzeCoverage(doc, editorRegistry);
    const gap = report.uncovered.find((candidate) => candidate.edgeId === 'e-fail')!;
    expect(gap.kind).toBe('error');
    const scenario = await generateForBranch(doc, editorRegistry, gap, report, 'Lookup fails');
    expect(scenario?.dataSources['lookup']?.kind).toBe('error');
    expect(scenario?.expected.page).toBe('standard');
  });

  it('gives up on an unsatisfiable branch within its budget', async () => {
    const doc = branching((d) => {
      const edge = d.flow.edges.find((e) => e.id === 'e-vip')!;
      edge.when = { $expr: 'vars.tier == "vip" && vars.tier == "gold"' };
    });
    const report = await analyzeCoverage(doc, editorRegistry);
    const gap = report.uncovered.find((candidate) => candidate.edgeId === 'e-vip')!;
    const started = performance.now();
    // A small budget keeps the suite light; the default budget is bounded the same way.
    expect(await generateForBranch(doc, editorRegistry, gap, report, 'x', 8)).toBeNull();
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('analyzeCoverage robustness', () => {
  it('records an invalid scenario as a failed result and still measures the rest', async () => {
    const doc = branching((d) => {
      d.testScenarios = [
        ...(d.testScenarios ?? []),
        TestScenarioSchema.parse({
          id: 'pointsNowhere',
          name: 'Points nowhere',
          synthetic: true,
          context: {},
          steps: [{ type: 'event', node: 'missing', event: 'onPress' }],
          expected: { page: 'vip' },
        }),
      ];
    });
    const report = await analyzeCoverage(doc, editorRegistry);
    expect(report.results.map((r) => [r.id, r.passed])).toEqual([
      ['standardPath', true],
      ['pointsNowhere', false],
    ]);
    expect(report.coveredEdges).toBe(2);
  });
});

describe('generateForBranch condition shapes', () => {
  function ruled(when: unknown, variables: unknown[]) {
    return branching((d) => {
      d.variables = [
        ...variables.map((input) => VariableSchema.parse(input)),
        ...d.variables.filter((v) => v.key === 'tier'),
      ];
      d.rules = [RuleSchema.parse({ id: 'r-gate', when })];
      const edge = d.flow.edges.find((e) => e.id === 'e-vip')!;
      edge.when = { $rule: 'r-gate' };
    });
  }
  async function solve(doc: ReturnType<typeof branching>) {
    const report = await analyzeCoverage(doc, editorRegistry);
    const gap = report.uncovered.find((candidate) => candidate.edgeId === 'e-vip')!;
    return generateForBranch(doc, editorRegistry, gap, report, 'Rule branch');
  }

  it('solves numeric thresholds inside nested all/any/not rules', async () => {
    const doc = ruled(
      {
        all: [
          { fact: 'vars.age', op: 'gte', value: 18 },
          { not: { fact: 'vars.blocked', op: 'eq', value: true } },
          { any: [{ fact: 'vars.age', op: 'lt', value: 65 }, { $expr: 'false' }] },
        ],
      },
      [
        { key: 'age', type: 'number', scope: 'session', default: 0 },
        { key: 'blocked', type: 'boolean', scope: 'session', default: true },
      ],
    );
    const scenario = await solve(doc);
    expect(scenario?.context.variables).toMatchObject({ age: 18, blocked: false });
    expect(scenario?.expected.page).toBe('vip');
  });

  it('tries enum values listed by an "in" rule', async () => {
    const doc = ruled({ fact: 'vars.plan', op: 'in', value: ['gold', 'platinum'] }, [
      {
        key: 'plan',
        type: 'enum',
        scope: 'session',
        enumValues: ['basic', 'gold', 'platinum'],
        default: 'basic',
      },
    ]);
    expect((await solve(doc))?.context.variables).toEqual({ plan: 'gold' });
  });

  it('ignores a missing rule and object variables it cannot vary', async () => {
    const doc = ruled({ fact: 'vars.profile', op: 'eq', value: 1 }, [
      { key: 'profile', type: 'object', scope: 'session', default: {} },
    ]);
    doc.rules = [];
    expect(await solve(doc)).toBeNull();
  });

  it('opens a success port from a failing base by switching the mock to success', async () => {
    const doc = branching((d) => {
      d.dataSources = [
        DataSourceRefSchema.parse({
          id: 'lookup',
          ref: 'tenant-datasource:lookup',
          version: 1,
          outputs: { tier: { path: '$.tier' } },
        }),
      ];
      d.flow.nodes.splice(1, 0, { id: 'n-lookup', type: 'dataSource', dataSource: 'lookup' });
      d.flow.edges = [
        { id: 'e-home', from: 'n-home', to: 'n-lookup' },
        { id: 'e-ok', from: 'n-lookup', to: 'n-vip', port: 'success' },
        { id: 'e-fail', from: 'n-lookup', to: 'n-standard', port: 'error' },
      ];
      d.testScenarios = [
        TestScenarioSchema.parse({
          id: 'lookupFails',
          name: 'Lookup fails',
          synthetic: true,
          context: {},
          dataSources: { lookup: { kind: 'error', outputs: {} } },
          steps: [{ type: 'event', node: 'home-next', event: 'onPress' }],
          expected: { page: 'standard' },
        }),
      ];
    });
    const report = await analyzeCoverage(doc, editorRegistry);
    const gap = report.uncovered.find((candidate) => candidate.edgeId === 'e-ok')!;
    expect(gap.kind).toBe('success');
    const scenario = await generateForBranch(doc, editorRegistry, gap, report, 'Lookup works');
    expect(scenario?.dataSources['lookup']?.kind).toBe('success');
    expect(scenario?.expected.page).toBe('vip');
  });

  it('starts from an empty run with default mocks when no scenario reaches the branch', async () => {
    const doc = branching((d) => {
      d.testScenarios = [];
      d.dataSources = [
        DataSourceRefSchema.parse({ id: 'unused', ref: 'tenant-datasource:unused', version: 1 }),
      ];
      d.flow.start = 'n-decide';
    });
    const report = await analyzeCoverage(doc, editorRegistry);
    const gap = report.uncovered.find((candidate) => candidate.edgeId === 'e-vip')!;
    const scenario = await generateForBranch(doc, editorRegistry, gap, report, 'From start');
    expect(scenario?.context.variables).toEqual({ tier: 'vip' });
    expect(Object.keys(scenario?.dataSources ?? {})).toEqual(['unused']);
    expect(
      await generateForBranch(doc, editorRegistry, { ...gap, flowId: 'nope' }, report, 'x'),
    ).toBeNull();
  });
});
