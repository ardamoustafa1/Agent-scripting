import { afterEach, expect, it, vi } from 'vitest';

import { runScenario } from '@verbis/core-runtime';
import type * as CoreRuntime from '@verbis/core-runtime';
import {
  DataSourceRefSchema,
  NodeSchema,
  TestScenarioSchema,
  ScriptDocumentSchema,
} from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';
import { IntegrationDefinitionSchema, RegressionReportSchema } from '@verbis/shared-types';

import {
  regressionResults,
  requirePassingResults,
  validateComponents,
  validateDataSourceReferences,
  validateFragmentComponents,
} from './script-validation.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';

vi.mock('@verbis/core-runtime', async (importOriginal) => {
  const original = await importOriginal<typeof CoreRuntime>();
  return { ...original, runScenario: vi.fn(original.runScenario) };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(runScenario).mockReset();
});

it('reports paths for malformed shared fragments and static component props', () => {
  expect(() => validateFragmentComponents({ pages: [{}], dataSources: [] })).toThrow();
  const document = ScriptDocumentSchema.parse(minimalScript());
  expect(validateFragmentComponents({ pages: document.pages, dataSources: [] }).pages).toHaveLength(
    1,
  );
  const component = NodeSchema.parse(document.pages[0]!.layout.children![0]);
  document.pages[0]!.layout.children![0] = component;
  component.props['unexpected'] = true;
  expect(() => {
    validateComponents(document);
  }).toThrow(
    expect.objectContaining({
      code: 'VERBIS_SCRIPT_DOCUMENT_INVALID',
      errors: [
        {
          path: '/pages/0/layout/children/0/props',
          code: 'unrecognized_keys',
          message: 'Unrecognized key: "unexpected"',
        },
      ],
    }),
  );
  component.type = 'uninstalled';
  expect(() => {
    validateComponents(document);
  }).toThrow(
    expect.objectContaining({
      errors: [{ path: '/pages', message: 'VERBIS_COMPONENT_UNKNOWN' }],
    }),
  );
});

it.each(['missing', 'stale', 'invalid', 'unpromoted', 'draft', 'production'] as const)(
  'checks exact tenant references for %s before allowing release',
  async (kind) => {
    const definition = IntegrationDefinitionSchema.parse({
      baseUrl: 'https://example.test',
      endpoint: '/lookup',
      ...(kind === 'production'
        ? { profiles: { prod: { baseUrl: 'https://example.test', auth: { type: 'none' } } } }
        : {}),
    });
    const row =
      kind === 'missing'
        ? null
        : {
            id: 'source',
            version: kind === 'stale' ? 2 : 1,
            definition: kind === 'invalid' ? {} : definition,
          };
    const findFirst = vi
        .fn<(query: { where: { key: string } }) => Promise<typeof row>>()
        .mockResolvedValue(row),
      lock = vi.fn().mockResolvedValue([]);
    const tx = {
      $queryRaw: lock,
      dataSourceVersion: { findFirst: vi.fn().mockResolvedValue(null) },
      dataSource: { findFirst },
    } as unknown as TransactionClient;
    const document = {
      dataSources: [
        DataSourceRefSchema.parse({ id: 'z', ref: 'tenant-datasource:z', version: 1 }),
        DataSourceRefSchema.parse({ id: 'a', ref: 'tenant-datasource:a', version: 1 }),
      ],
    };
    const result = validateDataSourceReferences(tx, 'tenant', document, kind !== 'draft');
    if (kind === 'draft' || kind === 'production') await expect(result).resolves.toBeUndefined();
    else
      await expect(result).rejects.toMatchObject({
        code: 'VERBIS_SCRIPT_DOCUMENT_INVALID',
        errors: [{ path: '/dataSources/1' }, { path: '/dataSources/0' }],
      });
    expect(findFirst.mock.calls.map(([query]) => query.where.key)).toEqual(['a', 'z']);
    expect(lock).toHaveBeenCalledTimes(2);
  },
);
it('marks the remaining suite timed out and blocks release without running it', async () => {
  const document = ScriptDocumentSchema.parse(minimalScript());
  document.testScenarios = [
    TestScenarioSchema.parse({
      id: 'budget',
      name: 'Budget',
      synthetic: true,
      context: {},
      steps: [],
      expected: { ended: true },
    }),
  ];
  vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(10000);
  const results = await regressionResults(document);
  expect(results).toMatchObject([{ passed: false, code: 'VERBIS_PREVIEW_SUITE_TIMEOUT' }]);
  expect(runScenario).not.toHaveBeenCalled();
  expect(() => {
    requirePassingResults(results);
  }).toThrow(expect.objectContaining({ code: 'VERBIS_VALIDATION_FAILED' }));
});
it('turns a scenario exception into a failed server result and never approves an empty suite', async () => {
  const document = ScriptDocumentSchema.parse(minimalScript());
  document.testScenarios = [
    TestScenarioSchema.parse({
      id: 'invalid',
      name: 'Invalid',
      synthetic: true,
      context: {},
      steps: [],
      expected: { ended: true },
    }),
  ];
  vi.mocked(runScenario).mockRejectedValueOnce(new Error('Untrusted scenario failure'));
  expect(await regressionResults(document)).toMatchObject([
    { passed: false, code: 'VERBIS_PREVIEW_SCENARIO_INVALID' },
  ]);
  expect(() => {
    requirePassingResults([]);
  }).toThrow();
  expect(() => {
    requirePassingResults([{ id: 'failed', passed: false, durationMs: 0, assertions: [] }]);
  }).toThrow(
    expect.objectContaining({
      errors: [{ path: '/testScenarios/failed', message: 'assertion failed' }],
    }),
  );
});

it('releases historical pinned definitions after a live edit, retaining production approval of the pin', async () => {
  const snapshot = {
    version: 1,
    definition: IntegrationDefinitionSchema.parse({
      baseUrl: 'https://old.test',
      endpoint: '/x',
      profiles: { prod: { baseUrl: 'https://old.test', auth: { type: 'none' } } },
    }),
  };
  const tx = {
    $queryRaw: vi.fn(),
    dataSource: {
      findFirst: vi.fn().mockResolvedValue({ id: 'source', version: 2, definition: {} }),
    },
    dataSourceVersion: { findFirst: vi.fn().mockResolvedValue(snapshot) },
  } as unknown as TransactionClient;
  const doc = {
    dataSources: [
      DataSourceRefSchema.parse({ id: 'customer', ref: 'tenant-datasource:customer', version: 1 }),
    ],
  };
  await expect(validateDataSourceReferences(tx, 'tenant', doc, true)).resolves.toBeUndefined();
});
it('reports only the regression contract fields, never designer coverage or observations', async () => {
  const document = ScriptDocumentSchema.parse(minimalScript());
  document.testScenarios = [
    TestScenarioSchema.parse({
      id: 'reachesHome',
      name: 'Reaches home',
      synthetic: true,
      context: {},
      steps: [],
      expected: { page: 'home' },
    }),
  ];
  const [result] = await regressionResults(document);
  expect(result).toMatchObject({ id: 'reachesHome', passed: true });
  expect(Object.keys(result ?? {}).sort()).toEqual(['assertions', 'durationMs', 'id', 'passed']);
  expect(RegressionReportSchema.shape.results.element.safeParse(result).success).toBe(true);
});
