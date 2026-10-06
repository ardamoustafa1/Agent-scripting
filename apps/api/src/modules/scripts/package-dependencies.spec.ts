/* Test doubles use asynchronous signatures and Vitest asymmetric matchers. */
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment */
import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import { type z } from 'zod';

import { ScriptDocumentSchema, TestScenarioSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';
import {
  IntegrationDefinitionSchema,
  IntegrationPolicySchema,
  type IntegrationSaveSchema,
} from '@verbis/shared-types';

import { canonicalJson } from '../../common/crypto/canonical-json.js';

import { PackageKeys, buildPackage, verifyPackage } from './domain/package-format.js';
import { PackagesService, documentChecksum } from './packages.service.js';

import type { ScriptsService } from './scripts.service.js';
import type { SharedScreensService } from './shared-screens.service.js';
import type { TeamService } from './team.service.js';
import type { ApiEnv } from '../../env.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthzService } from '../authz/authz.service.js';
import type { IntegrationEngineService } from '../integrations/integration-engine.service.js';

const sourceSecret = '01928f3a-0000-7000-8000-000000000001',
  targetSecret = '01928f3a-0000-7000-8000-000000000002';
function fixture() {
  const { privateKey } = generateKeyPairSync('ed25519'),
    keys = PackageKeys.from(
      JSON.stringify({ ...privateKey.export({ format: 'jwk' }), kid: 'synthetic-test' }),
      undefined,
    );
  const document = ScriptDocumentSchema.parse(minimalScript());
  document.testScenarios = [
    TestScenarioSchema.parse({
      id: 'end',
      name: 'Synthetic end',
      synthetic: true,
      context: {},
      steps: [{ type: 'event', node: 'btn-next', event: 'onPress' }],
      expected: { ended: true },
    }),
  ];
  document.dataSources = [
    {
      id: 'crm',
      ref: 'tenant-datasource:crm',
      version: 7,
      inputs: {},
      outputs: {},
      policy: { trigger: 'manual', timeoutMs: 5000, cacheTtlSec: 0 },
    },
  ];
  const pkg = buildPackage(
    {
      packageId: 'synthetic',
      createdAt: '2026-10-02T00:00:00Z',
      createdBy: 'user:fixture',
      sourceEnvironment: 'dev',
      targetEnvironments: ['test'],
    },
    {
      scripts: [
        {
          name: 'Synthetic',
          description: null,
          tags: [],
          semver: '1.0.0',
          changeNote: 'Synthetic transport',
          document: document,
          checksum: documentChecksum(document),
          sharedScreens: [],
        },
      ],
      sharedScreens: [],
      integrations: [
        {
          key: 'crm',
          version: 7,
          protocol: 'rest',
          definition: IntegrationDefinitionSchema.parse({
            baseUrl: 'https://example.test',
            endpoint: '/crm',
            auth: { type: 'bearer', secretRef: sourceSecret },
          }),
          policy: IntegrationPolicySchema.parse({}),
          secretRefs: [sourceSecret],
        },
      ],
    },
    keys,
  );
  const createVersion = vi.fn(async (_id: string, body: { document: Record<string, unknown> }) => ({
    id: 'derived-version',
    number: 1,
    checksum: documentChecksum(body.document),
  }));
  const save = vi.fn(async (body: z.infer<typeof IntegrationSaveSchema>) => {
    tx.dataSource.findFirst.mockResolvedValue({
      id: 'integration',
      version: 1,
      definition: body.definition,
    });
    return { id: 'integration', version: 1 };
  });
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    script: { findFirst: vi.fn(async () => null) },
    scriptVersion: { findMany: vi.fn(async () => []) },
    dataSource: {
      findFirst: vi
        .fn<
          (
            ...args: unknown[]
          ) => Promise<{ id: string; version: number; definition: unknown } | null>
        >()
        .mockResolvedValue(null),
    },
  };
  const audit = vi.fn(async () => undefined);
  const service = new PackagesService(
    { authorize: vi.fn() } as unknown as TeamService,
    { authorize: vi.fn() } as unknown as AuthzService,
    { save } as unknown as IntegrationEngineService,
    { VERBIS_ENVIRONMENT: 'test' } as ApiEnv,
    { current: () => tx, tenantId: () => 'target-tenant' } as unknown as TenantDb,
    { record: audit } as unknown as AuditService,
    {
      create: vi.fn(async () => ({ id: 'target-script' })),
      createVersion,
    } as unknown as ScriptsService,
    {} as SharedScreensService,
    keys,
  );
  return { pkg, keys, service, save, createVersion, audit, tx };
}
describe('signed dependency transport', () => {
  it('reports unmapped secret dependencies without creating resources', async () => {
    const f = fixture();
    const result = await f.service.import(f.pkg, { dryRun: true });
    expect(result.dependencies[0]).toMatchObject({
      key: 'crm',
      missing: true,
      canCreate: true,
      secretRefs: [sourceSecret],
    });
    expect(f.save).not.toHaveBeenCalled();
    expect(f.createVersion).not.toHaveBeenCalled();
  });
  it('verifies the original signature, maps credentials server-side and derives an audited draft checksum', async () => {
    const f = fixture();
    await f.service.import({ package: f.pkg, secretMappings: { [sourceSecret]: targetSecret } });
    expect(f.save).toHaveBeenCalledWith(
      expect.objectContaining({
        definition: expect.objectContaining({ auth: { type: 'bearer', secretRef: targetSecret } }),
      }),
    );
    expect(f.createVersion).toHaveBeenCalledWith(
      'target-script',
      expect.objectContaining({
        document: expect.objectContaining({
          dataSources: expect.arrayContaining([
            expect.objectContaining({ ref: 'tenant-datasource:crm', version: 1 }),
          ]),
        }),
      }),
      expect.objectContaining({
        source: expect.objectContaining({ sourceChecksum: f.pkg.payload.scripts[0]?.checksum }),
      }),
    );
    expect(f.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'script.package.imported' }),
    );
    expect(f.pkg.payload.scripts[0]?.document['dataSources']).toEqual(
      expect.arrayContaining([expect.objectContaining({ version: 7 })]),
    );
  });
  it('rejects a tampered integration descriptor before any secret mapping or draft creation', async () => {
    const f = fixture(),
      pkg = structuredClone(f.pkg);
    const dep = pkg.payload.integrations?.[0];
    if (!dep) throw Error('fixture');
    dep.definition.baseUrl = 'https://changed.example.test';
    await expect(
      f.service.import({ package: pkg, secretMappings: { [sourceSecret]: targetSecret } }),
    ).rejects.toMatchObject({ code: 'VERBIS_PACKAGE_INVALID' });
    expect(f.save).not.toHaveBeenCalled();
  });
  it('verifies legacy v1 signatures using their original format header', () => {
    const f = fixture(),
      legacy = structuredClone(f.pkg);
    legacy.formatVersion = 1;
    legacy.signature = {
      alg: 'EdDSA',
      ...f.keys.sign(
        Buffer.from(
          canonicalJson({
            format: legacy.format,
            formatVersion: 1,
            manifest: legacy.manifest,
            checksums: legacy.checksums,
          }),
        ),
      ),
    };
    expect(
      verifyPackage(legacy, f.keys, (_kind, document) => documentChecksum(document), 'test')
        .formatVersion,
    ).toBe(1);
    legacy.formatVersion = 2;
    expect(() =>
      verifyPackage(legacy, f.keys, (_kind, document) => documentChecksum(document), 'test'),
    ).toThrow(/signature/);
  });
});
