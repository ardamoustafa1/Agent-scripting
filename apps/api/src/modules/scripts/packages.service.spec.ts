import { generateKeyPairSync } from 'node:crypto';

import { expect, it, vi } from 'vitest';

import {
  ScriptDocumentSchema,
  DataSourceRefSchema,
  TestScenarioSchema,
} from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';
import { IntegrationDefinitionSchema, IntegrationPolicySchema } from '@verbis/shared-types';

import { requestContext } from '../../common/context/request-context.js';

import { checksumOf } from './document-storage.js';
import { PackageKeys, buildPackage } from './domain/package-format.js';
import { PackagesService } from './packages.service.js';
import { fragmentChecksum, type SharedScreensService } from './shared-screens.service.js';

import type { ScriptsService } from './scripts.service.js';
import type { TeamService } from './team.service.js';
import type { ApiEnv } from '../../env.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthzService } from '../authz/authz.service.js';
import type { IntegrationEngineService } from '../integrations/integration-engine.service.js';

const tenant = '01990000-0000-7000-8000-000000000001',
  id = '01990000-0000-7000-8000-000000000002';
const pair = generateKeyPairSync('ed25519');
const keys = PackageKeys.from(
  JSON.stringify({ ...pair.privateKey.export({ format: 'jwk' }), kid: 'synthetic' }),
  undefined,
);
const run = <T>(fn: () => T) =>
  requestContext.run(
    {
      requestId: 'synthetic',
      correlationId: 'synthetic',
      ip: '',
      userAgent: 'test',
      principal: { type: 'user', id, tenantId: tenant, scopes: [] },
    },
    fn,
  );
function fixture(signing = keys) {
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
  const version = {
    state: 'published',
    semver: '1.0.0' as string | null,
    documentEncoding: 'json',
    document,
    documentCompressed: null,
    script: { name: 'Synthetic package', description: null, tags: [] },
    screenLinks: [] as {
      sharedScreen: { key: string; name: string };
      sharedScreenVersion: { semver: string; fragment: Record<string, unknown>; checksum: string };
      mode: string;
    }[],
    checksum: checksumOf(document),
    changeNote: 'Synthetic change',
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    scriptVersion: {
      findFirst: vi.fn().mockResolvedValue(version),
      findMany: vi.fn().mockResolvedValue([]),
    },
    script: { findFirst: vi.fn().mockResolvedValue(null) },
    assignment: { findMany: vi.fn().mockResolvedValue([{ campaignId: tenant }]) },
    sharedScreen: { findFirst: vi.fn().mockResolvedValue(null) },
    sharedScreenVersion: { findFirst: vi.fn().mockResolvedValue({ number: 1 }) },
    dataSource: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const scripts = {
      create: vi.fn().mockResolvedValue({ id }),
      createVersion: vi.fn().mockResolvedValue({ id, number: 1, checksum: version.checksum }),
    },
    sharedScreens = {
      create: vi.fn().mockResolvedValue({ id }),
      publishVersion: vi.fn().mockResolvedValue({ id }),
    };
  const audit = { record: vi.fn().mockResolvedValue(undefined) },
    team = { authorize: vi.fn().mockResolvedValue(undefined) },
    authz = { authorize: vi.fn() },
    integrations = { save: vi.fn().mockResolvedValue({ id, version: 1 }) };
  const service = new PackagesService(
    team as unknown as TeamService,
    authz as unknown as AuthzService,
    integrations as unknown as IntegrationEngineService,
    { VERBIS_ENVIRONMENT: 'test' } as ApiEnv,
    { current: () => tx, tenantId: () => tenant } as unknown as TenantDb,
    audit as unknown as AuditService,
    scripts as unknown as ScriptsService,
    sharedScreens as unknown as SharedScreensService,
    signing,
  );
  return { service, tx, version, scripts, audit, team, authz, integrations, sharedScreens };
}
const input = { items: [{ scriptId: id, versionNumber: 1 }], targetEnvironments: ['test'] };

it('validates component contracts in every signed shared-screen fragment before importing', async () => {
  const f = fixture();
  const page = structuredClone(f.version.document.pages[0]!);
  Object.assign(page.layout.children![0]!, {
    props: { labelKey: 'common.next', contentKey: 'common.next' },
  });
  const fragment = {
    pages: [page],
    variables: [],
    dataSources: [],
    messages: f.version.document.i18n.messages,
  };
  f.version.screenLinks.push({
    sharedScreen: { key: 'invalid-screen', name: 'Invalid screen' },
    sharedScreenVersion: { semver: '1.0.0', fragment, checksum: fragmentChecksum(fragment) },
    mode: 'linked',
  });
  const pkg = await run(() => f.service.export(input));
  await expect(f.service.import(pkg)).rejects.toMatchObject({
    code: 'VERBIS_SCRIPT_DOCUMENT_INVALID',
  });
  expect(f.sharedScreens.create).not.toHaveBeenCalled();
  expect(f.scripts.create).not.toHaveBeenCalled();
});

it.each(['invalid component', 'empty scenarios'] as const)(
  'rejects a trusted signed import with %s before writes or dry-run approval',
  async (reason) => {
    const f = fixture();
    if (reason === 'invalid component')
      Object.assign(f.version.document.pages[0]!.layout.children![0]!, {
        props: {
          labelKey: 'common.next',
          contentKey: 'common.next',
        },
      });
    else f.version.document.testScenarios = [];
    f.version.checksum = checksumOf(f.version.document);
    const pkg = await run(() => f.service.export(input));
    for (const dryRun of [true, false]) {
      await expect(run(() => f.service.import(pkg, { dryRun }))).rejects.toMatchObject({
        code:
          reason === 'invalid component'
            ? 'VERBIS_SCRIPT_DOCUMENT_INVALID'
            : 'VERBIS_VALIDATION_FAILED',
      });
    }
    expect(f.scripts.create).not.toHaveBeenCalled();
    expect(f.scripts.createVersion).not.toHaveBeenCalled();
    expect(f.integrations.save).not.toHaveBeenCalled();
  },
);

function dependencyFixture() {
  const f = fixture();
  f.version.document.dataSources.push(
    DataSourceRefSchema.parse({ id: 'lookup', ref: 'tenant-datasource:synthetic', version: 1 }),
  );
  f.version.checksum = checksumOf(f.version.document);
  const definition = IntegrationDefinitionSchema.parse({
    baseUrl: 'https://synthetic.example.invalid',
    endpoint: '/lookup',
    auth: { type: 'bearer', secretRef: id },
    profiles: {
      dev: {
        baseUrl: 'https://synthetic-dev.example.invalid',
        auth: { type: 'bearer', secretRef: id },
      },
      prod: {
        baseUrl: 'https://synthetic-prod.example.invalid',
        auth: { type: 'bearer', secretRef: tenant },
      },
    },
    pendingPromotion: {
      requestedBy: 'synthetic',
      from: 'dev',
      requestedAt: '2026-10-04T00:00:00Z',
      reason: 'Synthetic pending promotion',
      profile: {
        baseUrl: 'https://synthetic-prod.example.invalid',
        auth: { type: 'bearer', secretRef: tenant },
      },
    },
  });
  const source = {
    id,
    key: 'synthetic',
    version: 1,
    protocol: 'rest',
    definition,
    policy: IntegrationPolicySchema.parse({}),
  };
  f.tx.dataSource.findFirst.mockResolvedValue(source);
  return { ...f, source };
}

it('exports pinned integration dependencies without production profiles, pending approvals or duplicate secret references', async () => {
  const f = dependencyFixture();
  const pkg = await run(() => f.service.export(input));
  expect(pkg.payload.integrations).toHaveLength(1);
  expect(pkg.payload.integrations![0]).toMatchObject({
    key: 'synthetic',
    version: 1,
    secretRefs: [id],
  });
  expect(pkg.payload.integrations![0]!.definition.profiles.prod).toBeUndefined();
  expect(pkg.payload.integrations![0]!.definition.pendingPromotion).toBeUndefined();
  expect(f.source.definition.profiles.prod).toBeDefined();
  expect(f.source.definition.pendingPromotion).toBeDefined();
});

it.each([null, 2])(
  'refuses export when the integration pin is unavailable: %s',
  async (version) => {
    const f = dependencyFixture();
    f.tx.dataSource.findFirst.mockResolvedValue(version === null ? null : { ...f.source, version });
    await expect(run(() => f.service.export(input))).rejects.toThrow(
      'Integration dependency synthetic@1 is unavailable',
    );
    expect(f.audit.record).not.toHaveBeenCalled();
  },
);

it('dry-runs missing integration secrets without writes and blocks unresolved imports', async () => {
  const f = dependencyFixture();
  const pkg = await run(() => f.service.export(input));
  f.tx.dataSource.findFirst.mockResolvedValue(null);
  expect(await f.service.import(pkg, { dryRun: true })).toMatchObject({
    dependencies: [{ key: 'synthetic', missing: true, canCreate: true, secretRefs: [id] }],
  });
  await expect(f.service.import(pkg)).rejects.toThrow(
    'Resolve integration and secret dependencies',
  );
  expect(f.integrations.save).not.toHaveBeenCalled();
  expect(f.scripts.create).not.toHaveBeenCalled();
});

it('creates a dependency with explicit target secret mappings and remaps the derived draft', async () => {
  const f = dependencyFixture();
  const pkg = await run(() => f.service.export(input));
  f.tx.dataSource.findFirst.mockResolvedValue(null);
  f.integrations.save.mockImplementation((body: unknown) => {
    const source = IntegrationDefinitionSchema.parse((body as { definition: unknown }).definition);
    f.tx.dataSource.findFirst.mockResolvedValue({ ...f.source, version: 1, definition: source });
    return Promise.resolve({ id, version: 1 });
  });
  await f.service.import({
    package: pkg,
    integrationMappings: { synthetic: { key: 'target-source', version: 1 } },
    secretMappings: { [id]: tenant },
  });
  expect(f.integrations.save.mock.calls[0]![0]).toMatchObject({
    key: 'target-source',
    definition: {
      auth: { type: 'bearer', secretRef: tenant },
      profiles: { dev: { auth: { type: 'bearer', secretRef: tenant } } },
    },
  });
  const created = f.scripts.createVersion.mock.calls[0]![1] as {
    document: { dataSources: { ref: string; version: number }[] };
  };
  expect(created.document.dataSources[0]).toMatchObject({
    ref: 'tenant-datasource:target-source',
    version: 1,
  });
  expect(pkg.payload.scripts[0]!.document['dataSources']).toEqual(f.version.document.dataSources);
});

it.each([true, false])(
  'uses a target integration only if its mapped version matches: %s',
  async (matched) => {
    const f = dependencyFixture();
    const pkg = await run(() => f.service.export(input));
    f.tx.dataSource.findFirst.mockResolvedValue({
      ...f.source,
      key: 'target-source',
      version: matched ? 7 : 6,
    });
    const wrapped = {
      package: pkg,
      integrationMappings: { synthetic: { key: 'target-source', version: 7 } },
    };
    expect(await f.service.import(wrapped, { dryRun: true })).toMatchObject({
      dependencies: [{ targetKey: 'target-source', missing: !matched, canCreate: false }],
    });
    if (matched) {
      await f.service.import(wrapped);
      expect(f.integrations.save).not.toHaveBeenCalled();
    } else
      await expect(f.service.import(wrapped)).rejects.toThrow(
        'Resolve integration and secret dependencies',
      );
  },
);

it('rejects a verified package whose integration descriptor is missing and detects conflicting pins', async () => {
  const f = dependencyFixture();
  const pkg = await run(() => f.service.export(input));
  const payload = structuredClone(pkg.payload);
  payload.integrations = [];
  const withoutDescriptor = buildPackage(pkg.manifest, payload, keys);
  f.tx.dataSource.findFirst.mockResolvedValue(null);
  expect(await f.service.import(withoutDescriptor, { dryRun: true })).toMatchObject({
    dependencies: [{ missing: true, canCreate: false, secretRefs: [] }],
  });
  const second = structuredClone(payload.scripts[0]!);
  const document = ScriptDocumentSchema.parse(second.document);
  document.dataSources[0]!.version = 2;
  second.name = 'Conflicting';
  second.document = document;
  second.checksum = checksumOf(document);
  payload.scripts.push(second);
  await expect(
    f.service.import(buildPackage(pkg.manifest, payload, keys), { dryRun: true }),
  ).rejects.toThrow('Conflicting integration pins');
});
it('exports a real signed package, dry-runs it without writes and imports a derived draft', async () => {
  const f = fixture();
  const pkg = await run(() => f.service.export(input));
  expect(pkg.signature.kid).toBe('synthetic');
  expect(pkg.payload.scripts[0]!.checksum).toBe(f.version.checksum);
  expect(await f.service.import(pkg, { dryRun: true })).toMatchObject({
    dryRun: true,
    plan: [{ action: 'create_script' }],
    dependencies: [],
  });
  expect(f.scripts.create).not.toHaveBeenCalled();
  const imported = await f.service.import(pkg);
  expect(imported).toMatchObject({
    dryRun: false,
    created: [{ scriptId: id, versionId: id, number: 1 }],
  });
  expect(f.scripts.createVersion).toHaveBeenCalledWith(
    id,
    expect.objectContaining({ document: f.version.document }),
    expect.objectContaining({
      semver: '1.0.0',
      source: expect.objectContaining({ signatureKid: 'synthetic' }) as unknown,
    }),
  );
  expect(f.audit.record).toHaveBeenCalledWith(
    f.tx,
    expect.objectContaining({ action: 'script.package.imported' }),
  );
});
it.each(['missingVersion', 'draftVersion', 'missingSemver', 'missingSigningKey'] as const)(
  'rejects unsafe package export: %s',
  async (reason) => {
    const f = fixture(
      reason === 'missingSigningKey' ? PackageKeys.from(undefined, undefined) : keys,
    );
    if (reason === 'missingVersion') f.tx.scriptVersion.findFirst.mockResolvedValue(null);
    if (reason === 'draftVersion') f.version.state = 'draft';
    if (reason === 'missingSemver') f.version.semver = null;
    await expect(run(() => f.service.export(input))).rejects.toThrow();
    expect(f.audit.record).not.toHaveBeenCalled();
  },
);
it('verifies checksums and signatures before any package import writes', async () => {
  const f = fixture();
  const pkg = await run(() => f.service.export(input));
  const changed = structuredClone(pkg);
  changed.payload.scripts[0]!.name = 'Tampered';
  await expect(f.service.import(changed)).rejects.toMatchObject({ code: 'VERBIS_PACKAGE_INVALID' });
  const unsigned = structuredClone(pkg);
  unsigned.signature.value = 'invalid';
  await expect(f.service.import(unsigned)).rejects.toMatchObject({
    code: 'VERBIS_PACKAGE_INVALID',
  });
  expect(f.scripts.createVersion).not.toHaveBeenCalled();
});
it('updates an existing script only with permission and an increasing semantic version', async () => {
  const f = fixture();
  const pkg = await run(() => f.service.export(input));
  f.tx.script.findFirst.mockResolvedValue({ id });
  const result = await f.service.import({
    package: pkg,
    integrationMappings: {},
    secretMappings: {},
  });
  expect(result.plan[0]!.action).toBe('new_version');
  expect(f.scripts.create).not.toHaveBeenCalled();
  expect(f.authz.authorize).toHaveBeenCalledWith(
    'update',
    expect.objectContaining({ id, campaignIds: [tenant] }),
  );
  f.tx.scriptVersion.findMany.mockResolvedValue([{ semver: '1.0.0' }]);
  await expect(f.service.import(pkg)).rejects.toMatchObject({
    code: 'VERBIS_SCRIPT_SEMVER_NOT_INCREASING',
  });
});
it('rejects content that changes after draft composition', async () => {
  const f = fixture();
  const pkg = await run(() => f.service.export(input));
  f.scripts.createVersion.mockResolvedValue({ id, number: 1, checksum: 'different' });
  await expect(f.service.import(pkg)).rejects.toThrow('imported content differs after composition');
  expect(
    f.audit.record.mock.calls.filter(
      ([, entry]) => (entry as { action: string }).action === 'script.package.imported',
    ),
  ).toHaveLength(0);
});

it.each(['newScreen', 'sameVersion', 'changedChecksum', 'olderVersion', 'newerVersion'] as const)(
  'imports shared screen dependencies safely: %s',
  async (scenario) => {
    const f = fixture();
    const fragment = {
      pages: f.version.document.pages,
      variables: [],
      dataSources: [],
      messages: f.version.document.i18n.messages,
    };
    const screen = {
      sharedScreen: { key: 'synthetic-screen', name: 'Synthetic screen' },
      sharedScreenVersion: { semver: '1.0.0', fragment, checksum: fragmentChecksum(fragment) },
      mode: 'linked',
    };
    f.version.screenLinks = [screen, screen];
    const pkg = await run(() => f.service.export(input));
    expect(pkg.payload.sharedScreens).toHaveLength(1);
    if (scenario !== 'newScreen')
      f.tx.sharedScreen.findFirst.mockResolvedValue({
        id,
        versions: [
          {
            semver:
              scenario === 'olderVersion'
                ? '2.0.0'
                : scenario === 'newerVersion'
                  ? '0.5.0'
                  : '1.0.0',
            checksum:
              scenario === 'changedChecksum' ? 'different' : screen.sharedScreenVersion.checksum,
          },
        ],
      });
    if (scenario === 'changedChecksum' || scenario === 'olderVersion') {
      await expect(f.service.import(pkg)).rejects.toThrow();
      expect(f.scripts.createVersion).not.toHaveBeenCalled();
    } else {
      await f.service.import(pkg);
      expect(f.sharedScreens.create).toHaveBeenCalledTimes(scenario === 'newScreen' ? 1 : 0);
      expect(f.sharedScreens.publishVersion).toHaveBeenCalledTimes(
        scenario === 'newerVersion' ? 1 : 0,
      );
      expect(f.scripts.createVersion).toHaveBeenCalledWith(
        id,
        expect.objectContaining({
          screens: [
            { sharedScreenId: id, mode: 'linked', versionNumber: 1 },
            { sharedScreenId: id, mode: 'linked', versionNumber: 1 },
          ],
        }),
        expect.anything(),
      );
    }
  },
);
