/* Vitest asymmetric matchers are intentionally assigned to expected query fields. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, expect, it, vi } from 'vitest';

import { DataSourceRefSchema, TestScenarioSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { PreviewService } from './preview.service.js';

import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthzService } from '../authz/authz.service.js';
import type { IntegrationEngineService } from '../integrations/integration-engine.service.js';

function fixture(passing = true) {
  const document = minimalScript();
  document.testScenarios = [
    TestScenarioSchema.parse({
      id: 'synthetic',
      name: 'Synthetic journey',
      synthetic: true,
      context: {},
      steps: [{ type: 'event', node: 'btn-next', event: 'onPress' }],
      expected: { ended: passing },
    }),
  ];
  const row = {
    id: 'version',
    version: 2,
    checksum: 'checksum',
    documentEncoding: 'json',
    documentCompressed: null,
    document,
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    scriptVersion: { findFirst: vi.fn(() => Promise.resolve(row)) },
    assignment: { findMany: vi.fn(() => Promise.resolve([])) },
    dataSourceVersion: { findFirst: vi.fn().mockResolvedValue(null) },
    dataSource: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const authorize = vi.fn(),
    audit = vi.fn(() => Promise.resolve({}));
  const live = vi.fn(() => Promise.resolve({ value: {}, durationMs: 1 }));
  const service = new PreviewService(
    { current: () => tx, tenantId: () => 'tenant' } as unknown as TenantDb,
    { authorize } as unknown as AuthzService,
    { record: audit } as unknown as AuditService,
    { previewRuntimeCall: live } as unknown as IntegrationEngineService,
  );
  return { service, document, authorize, audit, live, tx };
}
describe('server-authoritative preview regression', () => {
  it('does not pass an empty scenario suite and blocks release', async () => {
    const f = fixture();
    f.document.testScenarios = [];
    expect(await f.service.regression('script', 1)).toMatchObject({ passed: false, results: [] });
    await expect(f.service.requirePassing('script', 1)).rejects.toMatchObject({
      code: 'VERBIS_VALIDATION_FAILED',
      errors: [{ path: '/testScenarios', message: 'at least one regression scenario is required' }],
    });
  });
  it('validates components even when no scenario renders them', async () => {
    const f = fixture();
    f.document.testScenarios = [];
    Object.assign(f.document.pages[0]!.layout.children![0]!, {
      props: {
        labelKey: 'common.next',
        contentKey: 'common.next',
      },
    });
    await expect(f.service.requirePassing('script', 1)).rejects.toMatchObject({
      code: 'VERBIS_SCRIPT_DOCUMENT_INVALID',
    });
  });
  it.each(['missing', 'stale', 'unpromoted'] as const)(
    'blocks a %s data-source pin without making live calls',
    async (reason) => {
      const f = fixture();
      f.document.dataSources = [
        DataSourceRefSchema.parse({ id: 'lookup', ref: 'tenant-datasource:customer', version: 2 }),
      ];
      f.tx.dataSource.findFirst.mockResolvedValue(
        reason === 'missing'
          ? null
          : {
              id: 'source',
              version: reason === 'stale' ? 3 : 2,
              definition: {
                baseUrl: 'https://example.test',
                endpoint: '/lookup',
                auth: { type: 'none' },
                profiles: {},
              },
            },
      );
      await expect(f.service.requirePassing('script', 1)).rejects.toMatchObject({
        code: 'VERBIS_SCRIPT_DOCUMENT_INVALID',
        errors: expect.arrayContaining([expect.objectContaining({ path: '/dataSources/0' })]),
      });
      expect(f.live).not.toHaveBeenCalled();
      expect(f.tx.dataSource.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant', key: 'customer', deletedAt: null },
        }),
      );
    },
  );
  it('allows an exact approved production pin with a passing mock-only scenario', async () => {
    const f = fixture();
    f.document.dataSources = [
      DataSourceRefSchema.parse({ id: 'lookup', ref: 'tenant-datasource:customer', version: 2 }),
    ];
    f.tx.dataSource.findFirst.mockResolvedValue({
      id: 'source',
      version: 2,
      definition: {
        baseUrl: 'https://example.test',
        endpoint: '/lookup',
        auth: { type: 'none' },
        profiles: { prod: { baseUrl: 'https://prod.example.test', auth: { type: 'none' } } },
      },
    });
    expect(await f.service.requirePassing('script', 1)).toMatchObject({ passed: true });
    expect(f.live).not.toHaveBeenCalled();
    expect(f.tx.$queryRaw).toHaveBeenCalled();
  });
  it('returns checksum-bound redacted assertions and audits the check', async () => {
    const f = fixture();
    const report = await f.service.regression('script', 1);
    expect(report).toMatchObject({ checksum: 'checksum', version: 2, passed: true });
    expect(f.authorize).toHaveBeenCalledWith('read', expect.objectContaining({ id: 'script' }));
    expect(f.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'script.version.regressionChecked' }),
    );
    expect(f.live).not.toHaveBeenCalled();
  });
  it('rejects failing assertions before the lifecycle can approve or publish', async () => {
    const f = fixture(false);
    await expect(f.service.requirePassing('script', 1)).rejects.toMatchObject({
      code: 'VERBIS_VALIDATION_FAILED',
    });
    expect(f.live).not.toHaveBeenCalled();
  });
  it('requires a data source declared in the saved script before live execution', async () => {
    const f = fixture();
    await expect(
      f.service.live('script', 1, 'unknown', { input: {}, environment: 'test' }),
    ).rejects.toMatchObject({ code: 'VERBIS_RESOURCE_NOT_FOUND' });
    expect(f.live).not.toHaveBeenCalled();
  });
  it('fails closed when the saved script is not visible to the caller', async () => {
    const f = fixture();
    f.authorize.mockImplementation(() => {
      throw new Error('denied');
    });
    await expect(f.service.regression('script', 1)).rejects.toThrow('denied');
    expect(f.audit).not.toHaveBeenCalled();
  });
});
