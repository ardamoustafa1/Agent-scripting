import { runScenario, type ComponentRegistry, type ScenarioResult } from '@verbis/core-runtime';
import {
  PreviewMockSchema,
  TestScenarioSchema,
  literalMatchesType,
  scanExpression,
  type Condition,
  type FlowEdge,
  type JsonValue,
  type Predicate,
  type ScriptDocument,
  type TestScenario,
} from '@verbis/script-schema';

/**
 * Branch coverage of saved scenarios and search-based scenario generation (DIFFERENTIATORS B3).
 * Everything runs locally on the mock-only engine: no network, no telemetry, no real data.
 */

export interface BranchGap {
  flowId: string;
  edgeId: string;
  from: string;
  to: string;
  kind: 'condition' | 'default' | 'error' | 'success' | 'plain';
}
export interface CoverageReport {
  totalEdges: number;
  coveredEdges: number;
  /** 0–100, or null when the flow has no edges. */
  percent: number | null;
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
  uncovered: BranchGap[];
  results: ScenarioResult[];
}

const SCENARIO_TIMEOUT_MS = 2000;
/** Upper bound on generated variants per branch, so generation stays interactive. */
export const GENERATION_BUDGET = 48;

/** The runtime validates every saved scenario; run each one against a copy holding only itself. */
function isolated(document: ScriptDocument, scenario?: TestScenario): ScriptDocument {
  return { ...document, testScenarios: scenario ? [scenario] : [] };
}

function flows(document: ScriptDocument) {
  return [document.flow, ...document.subflows];
}
function gapKind(edge: FlowEdge): BranchGap['kind'] {
  if (edge.port === 'error') return 'error';
  if (edge.port === 'success') return 'success';
  if (edge.default) return 'default';
  return edge.when ? 'condition' : 'plain';
}

export async function analyzeCoverage(
  document: ScriptDocument,
  registry: ComponentRegistry,
  scenarios: readonly TestScenario[] = document.testScenarios ?? [],
): Promise<CoverageReport> {
  const nodes = new Set<string>(),
    edges = new Set<string>(),
    results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    // One invalid scenario is a failed result, as on the server; it never blocks the others.
    const result = await runScenario(
      isolated(document, scenario),
      registry,
      scenario,
      SCENARIO_TIMEOUT_MS,
    ).catch((): ScenarioResult => ({
      id: scenario.id,
      passed: false,
      durationMs: 0,
      assertions: [],
      code: 'VERBIS_PREVIEW_SCENARIO_INVALID',
      coverage: { nodes: [], edges: [] },
      observed: { page: null, ended: false },
    }));
    results.push(result);
    for (const node of result.coverage.nodes) nodes.add(node);
    for (const edge of result.coverage.edges) edges.add(edge);
  }
  const uncovered: BranchGap[] = [];
  let totalEdges = 0;
  for (const flow of flows(document))
    for (const edge of flow.edges) {
      totalEdges += 1;
      if (!edges.has(`${flow.id}:${edge.id}`))
        uncovered.push({
          flowId: flow.id,
          edgeId: edge.id,
          from: edge.from,
          to: edge.to,
          kind: gapKind(edge),
        });
    }
  const coveredEdges = totalEdges - uncovered.length;
  return {
    totalEdges,
    coveredEdges,
    percent: totalEdges === 0 ? null : Math.round((coveredEdges / totalEdges) * 100),
    nodes,
    edges,
    uncovered,
    results,
  };
}

/** Variables and literals a condition depends on, including those inside a referenced rule. */
function conditionFacts(document: ScriptDocument, condition: Condition | undefined) {
  const variables = new Set<string>();
  const literals: JsonValue[] = [];
  const text = (source: string) => {
    for (const id of scanExpression(source).variables) variables.add(id);
    for (const match of source.matchAll(
      /-?\d+(?:\.\d+)?|'([^']*)'|"([^"]*)"|\btrue\b|\bfalse\b/g,
    )) {
      const [raw, single, double] = match;
      if (single !== undefined || double !== undefined) literals.push(single ?? double ?? '');
      else if (raw === 'true' || raw === 'false') literals.push(raw === 'true');
      else literals.push(Number(raw));
    }
  };
  const predicate = (input: Predicate): void => {
    if ('all' in input) input.all.forEach(predicate);
    else if ('any' in input) input.any.forEach(predicate);
    else if ('not' in input) predicate(input.not);
    else if ('fact' in input) {
      text(input.fact);
      if (input.value !== undefined) {
        if (Array.isArray(input.value)) literals.push(...input.value);
        else literals.push(input.value);
      }
    } else text(input.$expr);
  };
  if (condition) {
    if ('$rule' in condition) {
      const rule = document.rules.find((candidate) => candidate.id === condition.$rule);
      if (rule) predicate(rule.when);
    } else text(condition.$expr);
  }
  return { variables, literals };
}

/** Boundary candidates for one variable, from the literals its conditions mention. */
function candidates(
  variable: ScriptDocument['variables'][number],
  literals: readonly JsonValue[],
): JsonValue[] {
  const values: JsonValue[] = [];
  const add = (value: JsonValue) => {
    if (
      literalMatchesType(variable, value) &&
      !values.some((existing) => JSON.stringify(existing) === JSON.stringify(value))
    )
      values.push(value);
  };
  switch (variable.type) {
    case 'boolean':
      add(true);
      add(false);
      break;
    case 'number':
      for (const literal of literals)
        if (typeof literal === 'number') [literal, literal + 1, literal - 1].forEach(add);
      add(0);
      break;
    case 'enum':
      (variable.enumValues ?? []).forEach(add);
      break;
    case 'string':
      for (const literal of literals) if (typeof literal === 'string') add(literal);
      add('');
      add('x');
      break;
    default:
      break;
  }
  return values;
}

function* assignments(
  options: readonly { key: string; values: readonly JsonValue[] }[],
  index = 0,
  current: Record<string, JsonValue> = {},
): Generator<Record<string, JsonValue>> {
  const option = options[index];
  if (!option) {
    yield current;
    return;
  }
  for (const value of option.values)
    yield* assignments(options, index + 1, { ...current, [option.key]: value });
}

function defaultMocks(document: ScriptDocument): TestScenario['dataSources'] {
  return Object.fromEntries(
    document.dataSources.map((source) => [
      source.id,
      PreviewMockSchema.parse({
        outputs: Object.fromEntries(Object.keys(source.outputs).map((key) => [key, null])),
      }),
    ]),
  );
}

/**
 * Finds a scenario that takes `gap`: starting from runs that already reach the branch point, it
 * tries boundary values of the variables the branch conditions read (and a failing or succeeding
 * mock for data source ports) until a variant takes the branch. Sensitive (PII/PCI) and global
 * variables are never varied, so generated scenarios stay synthetic.
 */
export async function generateForBranch(
  document: ScriptDocument,
  registry: ComponentRegistry,
  gap: BranchGap,
  report: CoverageReport,
  name: string,
  budget = GENERATION_BUDGET,
): Promise<TestScenario | null> {
  const flow = flows(document).find((candidate) => candidate.id === gap.flowId);
  if (!flow) return null;
  const target = `${gap.flowId}:${gap.edgeId}`;
  const siblings = flow.edges.filter((edge) => edge.from === gap.from);
  const facts = siblings.map((edge) => conditionFacts(document, edge.when));
  const literals = facts.flatMap((fact) => fact.literals);
  const options = [...new Set(facts.flatMap((fact) => [...fact.variables]))]
    .map((key) => document.variables.find((variable) => variable.key === key))
    .filter(
      (variable): variable is ScriptDocument['variables'][number] =>
        variable !== undefined &&
        variable.scope !== 'global' &&
        !variable.pii &&
        variable.classification !== 'pii' &&
        variable.classification !== 'pci',
    )
    .map((variable) => ({ key: variable.key, values: candidates(variable, literals) }))
    .filter((option) => option.values.length > 0);

  const reaching = (document.testScenarios ?? []).filter((scenario) =>
    report.results
      .find((result) => result.id === scenario.id)
      ?.coverage.nodes.includes(`${gap.flowId}:${gap.from}`),
  );
  const bases: TestScenario[] = reaching.length
    ? reaching.slice(0, 3)
    : [
        TestScenarioSchema.parse({
          id: 'generatedBase',
          name,
          synthetic: true,
          context: {},
          dataSources: defaultMocks(document),
          steps: [],
          expected: { ended: false },
        }),
      ];
  const fromNode = flow.nodes.find((node) => node.id === gap.from);
  const portSource =
    fromNode?.type === 'dataSource' && (gap.kind === 'error' || gap.kind === 'success')
      ? fromNode.dataSource
      : undefined;

  let tries = 0;
  for (const base of bases)
    for (const assignment of assignments(options)) {
      if (tries++ >= budget) return null;
      const steps = base.steps.map((step) =>
        step.type === 'variable' && Object.hasOwn(assignment, step.variable)
          ? { ...step, value: assignment[step.variable] ?? null }
          : step,
      );
      const dataSources = structuredClone(base.dataSources);
      if (portSource) {
        const fallback = defaultMocks(document)[portSource];
        const mock = dataSources[portSource] ?? fallback;
        if (mock)
          dataSources[portSource] =
            gap.kind === 'error'
              ? { ...mock, kind: 'error' }
              : {
                  ...mock,
                  kind: 'success',
                  // A success needs every declared output, even when the base mocked a failure.
                  outputs: { ...fallback?.outputs, ...mock.outputs },
                };
      }
      const variant = TestScenarioSchema.parse({
        ...base,
        id: `generated${String(tries)}`,
        name,
        context: { ...base.context, variables: { ...base.context.variables, ...assignment } },
        dataSources,
        steps,
        expected: { ended: false },
      });
      const result = await runScenario(
        isolated(document, variant),
        registry,
        variant,
        SCENARIO_TIMEOUT_MS,
      ).catch(() => null);
      if (!result) continue;
      if (result.code !== undefined || !result.coverage.edges.includes(target)) continue;
      const { page, ended, outcome } = result.observed;
      return TestScenarioSchema.parse({
        ...variant,
        id: uniqueId(document),
        expected: {
          ...(ended ? { ended: true } : page ? { page } : { ended: false }),
          ...(outcome === undefined ? {} : { outcome }),
        },
      });
    }
  return null;
}

function uniqueId(document: ScriptDocument): string {
  const taken = new Set((document.testScenarios ?? []).map((scenario) => scenario.id));
  let index = taken.size + 1;
  while (taken.has(`generatedBranch${String(index)}`)) index += 1;
  return `generatedBranch${String(index)}`;
}
