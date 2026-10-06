import { z } from 'zod';

import { createComponentRegistry } from '@verbis/components';
import { runScenario } from '@verbis/core-runtime';
import { PageSchema, DataSourceRefSchema, type ScriptDocument } from '@verbis/script-schema';
import { IntegrationDefinitionSchema } from '@verbis/shared-types';

import { DomainError } from '../../common/errors/domain-errors.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';

const registry = createComponentRegistry();

/** Same trusted host component contracts as the Agent, including unvisited pages. */
export function validateComponents(
  document: Pick<ScriptDocument, 'pages' | 'componentRegistry'>,
): void {
  try {
    registry.validate(document);
  } catch (error) {
    throw new DomainError(
      'VERBIS_SCRIPT_DOCUMENT_INVALID',
      'Component contracts are invalid',
      error instanceof z.ZodError
        ? error.issues.map((issue) => ({
            path: `/${issue.path.map(String).join('/')}`,
            message: issue.message,
            code: issue.code,
          }))
        : [
            {
              path: '/pages',
              message: error instanceof Error ? error.message : 'invalid component',
            },
          ],
    );
  }
}

export function validateFragmentComponents(fragment: unknown) {
  const parsed = z
    .object({ pages: z.array(PageSchema), dataSources: z.array(DataSourceRefSchema) })
    .safeParse(fragment);
  if (!parsed.success)
    throw new DomainError(
      'VERBIS_SCRIPT_DOCUMENT_INVALID',
      'The shared screen fragment is invalid',
      parsed.error.issues.map((issue) => ({
        path: `/sharedScreens/${issue.path.map(String).join('/')}`,
        message: issue.message,
        code: issue.code,
      })),
    );
  validateComponents({ pages: parsed.data.pages, componentRegistry: [] });
  return parsed.data;
}

export async function validateDataSourceReferences(
  tx: TransactionClient,
  tenantId: string,
  document: Pick<ScriptDocument, 'dataSources'>,
  requireProduction: boolean,
): Promise<void> {
  const errors = [];
  // Locks last until the caller's tenant transaction commits; promotion/edit/delete cannot race release.
  for (const { source, index } of document.dataSources
    .map((source, index) => ({ source, index }))
    .sort((a, b) => a.source.ref.localeCompare(b.source.ref))) {
    const key = source.ref.slice('tenant-datasource:'.length);
    await tx.$queryRaw`SELECT id FROM data_sources WHERE tenant_id = ${tenantId}::uuid AND key = ${key} AND deleted_at IS NULL FOR SHARE`;
    const row = await tx.dataSource.findFirst({
      where: { tenantId, key, deletedAt: null },
      select: { id: true, version: true, definition: true },
    });
    const snapshot = row
      ? await tx.dataSourceVersion.findFirst({
          where: { tenantId, dataSourceId: row.id, version: source.version },
        })
      : null;
    const revision = snapshot ?? row;
    const definition = IntegrationDefinitionSchema.safeParse(revision?.definition);
    const message = !row
      ? 'data source is missing in this tenant'
      : revision?.version !== source.version
        ? 'data source version does not match the pinned version'
        : !definition.success
          ? 'data source definition is invalid'
          : requireProduction && !definition.data.profiles.prod
            ? 'an approved production profile is required'
            : undefined;
    if (message) errors.push({ path: `/dataSources/${index}`, message });
  }
  if (errors.length)
    throw new DomainError(
      'VERBIS_SCRIPT_DOCUMENT_INVALID',
      'Resolve data source dependencies before release or import',
      errors,
    );
}

export async function regressionResults(document: ScriptDocument) {
  validateComponents(document);
  const results = [];
  const deadline = Date.now() + 10_000;
  for (const scenario of document.testScenarios ?? []) {
    if (Date.now() >= deadline) {
      results.push({
        id: scenario.id,
        passed: false,
        durationMs: 0,
        assertions: [],
        code: 'VERBIS_PREVIEW_SUITE_TIMEOUT',
      });
      continue;
    }
    try {
      results.push(
        await runScenario(document, registry, scenario, Math.min(2000, deadline - Date.now())),
      );
    } catch {
      results.push({
        id: scenario.id,
        passed: false,
        durationMs: 0,
        assertions: [],
        code: 'VERBIS_PREVIEW_SCENARIO_INVALID',
      });
    }
  }
  return results;
}

export function requirePassingResults(
  results: Awaited<ReturnType<typeof regressionResults>>,
): void {
  if (!results.length || results.some((r) => !r.passed))
    throw new DomainError(
      'VERBIS_VALIDATION_FAILED',
      'At least one saved regression scenario must pass before submission, approval, publication or import',
      !results.length
        ? [{ path: '/testScenarios', message: 'at least one regression scenario is required' }]
        : results
            .filter((r) => !r.passed)
            .map((r) => ({
              path: `/testScenarios/${r.id}`,
              message: r.code ?? 'assertion failed',
            })),
    );
}
