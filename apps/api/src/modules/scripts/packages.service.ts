import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { asSubject } from '@verbis/authz';
import { loadScriptDocument } from '@verbis/script-schema';
import {
  IntegrationDefinitionSchema,
  IntegrationPolicySchema,
  IntegrationSaveSchema,
  PackageImportRequestSchema,
} from '@verbis/shared-types';

import { currentActor } from '../../common/actor.js';
import { DomainError, NotFoundError } from '../../common/errors/domain-errors.js';
import { type ApiEnv, API_ENV } from '../../env.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthzService } from '../authz/authz.service.js';
import { IntegrationEngineService } from '../integrations/integration-engine.service.js';

import { checksumOf, decodeDocument } from './document-storage.js';
import {
  buildPackage,
  PackageKeys,
  PackageVerificationError,
  verifyPackage,
  type PackagePayload,
  type VerbisPackage,
} from './domain/package-format.js';
import { ScreenFragmentSchema } from './domain/screen-composition.js';
import { compareSemver } from './domain/semver.js';
import {
  regressionResults,
  requirePassingResults,
  validateDataSourceReferences,
  validateFragmentComponents,
} from './script-validation.js';
import { ScriptsService } from './scripts.service.js';
import { fragmentChecksum, SharedScreensService } from './shared-screens.service.js';
import { TeamService } from './team.service.js';

export const ExportPackageSchema = z
  .strictObject({
    items: z
      .array(z.strictObject({ scriptId: z.uuid(), versionNumber: z.number().int().positive() }))
      .min(1)
      .max(100),
    targetEnvironments: z
      .array(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/))
      .max(10)
      .default([]),
  })
  .meta({ id: 'ExportPackage' });
export type ExportPackageInput = z.output<typeof ExportPackageSchema>;

export const PACKAGE_KEYS = Symbol('PACKAGE_KEYS');

export function documentChecksum(document: Record<string, unknown>): string {
  const loaded = loadScriptDocument(document);
  if (!loaded.ok) return 'invalid';
  return checksumOf(loaded.document);
}

/**
 * `.verbis` packages: export published/approved versions (+ the shared screens they link) signed
 * with this environment's key; import verifies the signature against trusted environments, every
 * checksum and every document, then creates DRAFT versions (target-environment approval applies).
 */
@Injectable()
export class PackagesService {
  constructor(
    @Inject(TeamService) private readonly team: TeamService,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(IntegrationEngineService) private readonly integrations: IntegrationEngineService,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ScriptsService) private readonly scripts: ScriptsService,
    @Inject(SharedScreensService) private readonly sharedScreens: SharedScreensService,
    @Inject(PACKAGE_KEYS) private readonly keys: PackageKeys,
  ) {}

  async export(input: ExportPackageInput): Promise<VerbisPackage> {
    if (!this.keys.canSign())
      throw new DomainError('VERBIS_PACKAGE_INVALID', 'No package signing key is configured');
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const payload: PackagePayload = { scripts: [], sharedScreens: [] };
    const screensSeen = new Set<string>();
    const dependencies = new Map<string, NonNullable<PackagePayload['integrations']>[number]>();
    for (const item of input.items) {
      await this.team.authorize(item.scriptId, item.versionNumber);
      const version = await tx.scriptVersion.findFirst({
        where: { tenantId, scriptId: item.scriptId, number: item.versionNumber, deletedAt: null },
        include: {
          script: { select: { name: true, description: true, tags: true } },
          screenLinks: { include: { sharedScreen: true, sharedScreenVersion: true } },
        },
      });
      if (version === null) throw new NotFoundError('Script version');
      if (version.state !== 'published' && version.state !== 'approved') {
        throw new DomainError(
          'VERBIS_SCRIPT_INVALID_TRANSITION',
          `only approved or published versions can be exported (${version.state})`,
        );
      }
      if (version.semver === null)
        throw new DomainError('VERBIS_PACKAGE_INVALID', 'version has no semver');
      const document = (await decodeDocument(version)) as Record<string, unknown>;
      const loaded = loadScriptDocument(document);
      if (!loaded.ok) throw new DomainError('VERBIS_PACKAGE_INVALID', 'Invalid exported document');
      for (const ref of loaded.document.dataSources) {
        const key = ref.ref.slice('tenant-datasource:'.length),
          source = await tx.dataSource.findFirst({ where: { tenantId, key, deletedAt: null } });
        if (source?.version !== ref.version)
          throw new DomainError(
            'VERBIS_PACKAGE_INVALID',
            `Integration dependency ${key}@${ref.version} is unavailable`,
          );
        this.authz.authorize('read', asSubject('Integration', source));
        const definition = IntegrationDefinitionSchema.parse(source.definition);
        delete definition.pendingPromotion;
        delete definition.profiles.prod;
        const secretRefs = [
          ...new Set(
            [
              definition.auth,
              ...Object.values(definition.profiles).flatMap((p) => (p ? [p.auth] : [])),
            ].flatMap((a) => ('secretRef' in a ? [a.secretRef] : [])),
          ),
        ];
        dependencies.set(key, {
          key,
          version: source.version,
          protocol: source.protocol,
          definition,
          policy: IntegrationPolicySchema.parse(source.policy),
          secretRefs,
        });
      }
      for (const link of version.screenLinks) {
        const key = `${link.sharedScreen.key}@${link.sharedScreenVersion.semver}`;
        if (screensSeen.has(key)) continue;
        screensSeen.add(key);
        payload.sharedScreens.push({
          key: link.sharedScreen.key,
          name: link.sharedScreen.name,
          semver: link.sharedScreenVersion.semver,
          fragment: link.sharedScreenVersion.fragment as Record<string, unknown>,
          checksum: link.sharedScreenVersion.checksum,
        });
      }
      payload.scripts.push({
        name: version.script.name,
        description: version.script.description,
        tags: version.script.tags,
        semver: version.semver,
        changeNote: version.changeNote,
        document,
        checksum: version.checksum,
        sharedScreens: version.screenLinks.map((l) => ({
          key: l.sharedScreen.key,
          semver: l.sharedScreenVersion.semver,
          mode: l.mode as 'linked' | 'detached',
        })),
      });
    }
    payload.integrations = [...dependencies.values()];
    const pkg = buildPackage(
      {
        packageId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        createdBy: currentActor(),
        sourceEnvironment: this.env.VERBIS_ENVIRONMENT,
        targetEnvironments: input.targetEnvironments,
      },
      payload,
      this.keys,
    );
    await this.audit.record(tx, {
      action: 'script.package.exported',
      target: { type: 'Package', id: pkg.manifest.packageId },
      metadata: {
        items: pkg.manifest.items,
        targetEnvironments: input.targetEnvironments,
        payloadChecksum: pkg.checksums.payload,
        signatureKid: pkg.signature.kid,
      },
    });
    return pkg;
  }

  async import(input: unknown, options: { dryRun?: boolean } = {}) {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const wrapped = PackageImportRequestSchema.safeParse(input);
    const mappings = wrapped.success ? wrapped.data.integrationMappings : {};
    const secretMappings = wrapped.success ? wrapped.data.secretMappings : {};
    let pkg: VerbisPackage;
    try {
      pkg = verifyPackage(
        wrapped.success ? wrapped.data.package : input,
        this.keys,
        (kind, content) =>
          kind === 'script' ? documentChecksum(content) : fragmentChecksum(content),
        this.env.VERBIS_ENVIRONMENT,
      );
    } catch (error) {
      if (error instanceof PackageVerificationError) {
        // Rejected imports are security-relevant: recorded in their own transaction by the
        // failure interceptor; the reason is safe to show.
        throw new DomainError('VERBIS_PACKAGE_INVALID', error.message, [
          { path: '/body', message: error.reason },
        ]);
      }
      throw error;
    }
    for (const s of pkg.payload.scripts) {
      const loaded = loadScriptDocument(s.document);
      if (!loaded.ok)
        throw new DomainError('VERBIS_PACKAGE_INVALID', `document "${s.name}" is invalid`);
      requirePassingResults(await regressionResults(loaded.document));
    }
    for (const screen of pkg.payload.sharedScreens)
      validateFragmentComponents(ScreenFragmentSchema.parse(screen.fragment));
    const plan = await this.#plan(pkg);
    const dependencies = [];
    const required = new Map<string, number>();
    for (const script of pkg.payload.scripts) {
      const loaded = loadScriptDocument(script.document);
      if (loaded.ok)
        for (const ref of loaded.document.dataSources) {
          const key = ref.ref.slice('tenant-datasource:'.length);
          if (required.has(key) && required.get(key) !== ref.version)
            throw new DomainError('VERBIS_PACKAGE_INVALID', 'Conflicting integration pins');
          required.set(key, ref.version);
        }
    }
    for (const screen of pkg.payload.sharedScreens) {
      for (const ref of validateFragmentComponents(ScreenFragmentSchema.parse(screen.fragment))
        .dataSources) {
        const key = ref.ref.slice('tenant-datasource:'.length);
        if (required.has(key) && required.get(key) !== ref.version)
          throw new DomainError('VERBIS_PACKAGE_INVALID', 'Conflicting integration pins');
        required.set(key, ref.version);
      }
    }
    for (const [key, version] of required) {
      const mapping = mappings[key],
        target = await tx.dataSource.findFirst({
          where: { tenantId, key: mapping?.key ?? key, deletedAt: null },
          select: { id: true, key: true, version: true, secretRefs: true },
        });
      if (target) this.authz.authorize('read', asSubject('Integration', target));
      const packaged = pkg.payload.integrations?.find(
        (d) => d.key === key && d.version === version,
      );
      const matched = target?.version === (mapping?.version ?? version);
      const secrets = packaged?.secretRefs ?? [];
      const available =
        matched ||
        (target === null &&
          packaged !== undefined &&
          secrets.every((ref) => secretMappings[ref] !== undefined));
      dependencies.push({
        key,
        version,
        targetKey: mapping?.key ?? key,
        missing: !available,
        canCreate: !target && !!packaged,
        secretRefs: secrets,
      });
    }
    if (options.dryRun === true)
      return { packageId: pkg.manifest.packageId, dryRun: true, plan, dependencies };
    if (dependencies.some((d) => d.missing))
      throw new DomainError(
        'VERBIS_PACKAGE_INVALID',
        'Resolve integration and secret dependencies before import',
        dependencies
          .filter((d) => d.missing)
          .map((d) => ({ path: `/integrations/${d.key}`, message: 'missing dependency' })),
      );
    for (const d of dependencies.filter((d) => d.canCreate)) {
      const packaged = pkg.payload.integrations?.find((v) => v.key === d.key);
      if (!packaged)
        throw new DomainError('VERBIS_PACKAGE_INVALID', 'Missing integration descriptor');
      const definition = structuredClone(packaged.definition);
      delete definition.profiles.prod;
      delete definition.pendingPromotion;
      for (const auth of [
        definition.auth,
        ...Object.values(definition.profiles).flatMap((p) => (p ? [p.auth] : [])),
      ])
        if ('secretRef' in auth) {
          const ref = secretMappings[auth.secretRef];
          if (!ref) throw new DomainError('VERBIS_PACKAGE_INVALID', 'Secret mapping required');
          auth.secretRef = ref;
        }
      const created = await this.integrations.save({
        key: d.targetKey,
        protocol: packaged.protocol,
        definition: IntegrationSaveSchema.shape.definition.parse(definition),
        policy: packaged.policy,
      });
      mappings[d.key] = { key: d.targetKey, version: created.version };
    }
    const remap = (content: Record<string, unknown>) => {
      const sources = content['dataSources'];
      if (!Array.isArray(sources)) return content;
      return {
        ...content,
        dataSources: sources.map((value: unknown) => {
          const source = z.record(z.string(), z.unknown()).parse(value),
            ref = source['ref'];
          if (typeof ref !== 'string') return source;
          const mapping = mappings[ref.slice('tenant-datasource:'.length)];
          return mapping
            ? { ...source, ref: `tenant-datasource:${mapping.key}`, version: mapping.version }
            : source;
        }),
      };
    };
    // Imported integrations remain drafts; exact tenant pins are mandatory now, approved prod
    // profiles are mandatory at submit/publish. Signature validation used the original payload.
    for (const script of pkg.payload.scripts) {
      const loaded = loadScriptDocument(remap(script.document));
      if (!loaded.ok) throw new DomainError('VERBIS_SCRIPT_DOCUMENT_INVALID');
      await validateDataSourceReferences(tx, tenantId, loaded.document, false);
    }
    // Signature verification happens on the ORIGINAL payload; mappings create derived draft content.
    const mappedScreens = pkg.payload.sharedScreens.map((screen) => {
      const fragment = remap(screen.fragment);
      return { ...screen, fragment, checksum: fragmentChecksum(fragment) };
    });
    for (const screen of mappedScreens)
      await validateDataSourceReferences(
        tx,
        tenantId,
        validateFragmentComponents(ScreenFragmentSchema.parse(screen.fragment)),
        false,
      );

    const screenIds = new Map<string, string>();
    for (const screen of mappedScreens) {
      const fragment = ScreenFragmentSchema.parse(screen.fragment);
      const existing = await tx.sharedScreen.findFirst({
        where: { tenantId, key: screen.key, deletedAt: null },
        include: { versions: true },
      });
      if (existing === null) {
        const created = await this.sharedScreens.create({
          key: screen.key,
          name: screen.name,
          tags: [],
          semver: screen.semver,
          fragment,
        });
        screenIds.set(screen.key, created.id);
        continue;
      }
      screenIds.set(screen.key, existing.id);
      const same = existing.versions.find((v) => v.semver === screen.semver);
      if (same !== undefined) {
        if (same.checksum !== screen.checksum)
          throw new DomainError(
            'VERBIS_PACKAGE_INVALID',
            `shared screen ${screen.key}@${screen.semver} differs from the existing one`,
          );
        continue;
      }
      const latest = existing.versions.reduce<string | undefined>(
        (m, v) => (m === undefined || compareSemver(v.semver, m) > 0 ? v.semver : m),
        undefined,
      );
      if (latest !== undefined && compareSemver(screen.semver, latest) <= 0) {
        throw new DomainError(
          'VERBIS_SCRIPT_SEMVER_NOT_INCREASING',
          `shared screen ${screen.key}: ${screen.semver} is not newer than ${latest}`,
        );
      }
      await this.sharedScreens.publishVersion(existing.id, {
        semver: screen.semver,
        changeNote: `imported from ${pkg.manifest.sourceEnvironment}`,
        fragment,
      });
    }

    const created: { scriptId: string; versionId: string; number: number; name: string }[] = [];
    for (const s of pkg.payload.scripts) {
      const existing = await tx.script.findFirst({
        where: { tenantId, name: s.name, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        const campaigns = await tx.assignment.findMany({
          where: { tenantId, scriptId: existing.id, deletedAt: null },
          select: { campaignId: true },
        });
        this.authz.authorize(
          'update',
          asSubject('Script', { id: existing.id, campaignIds: campaigns.map((c) => c.campaignId) }),
        );
      }
      const scriptId =
        existing?.id ??
        (
          await this.scripts.create({
            name: s.name,
            tags: s.tags,
            ...(s.description === null ? {} : { description: s.description }),
          })
        ).id;
      const used = await tx.scriptVersion.findMany({
        where: { tenantId, scriptId, semver: { not: null } },
        select: { semver: true },
      });
      if (used.some((u) => u.semver !== null && compareSemver(s.semver, u.semver) <= 0)) {
        throw new DomainError(
          'VERBIS_SCRIPT_SEMVER_NOT_INCREASING',
          `${s.name}: ${s.semver} is not newer than the target's versions`,
        );
      }
      const screens = await Promise.all(
        s.sharedScreens.map(async (ref) => {
          const id = screenIds.get(ref.key);
          if (id === undefined)
            throw new DomainError('VERBIS_PACKAGE_INVALID', `missing shared screen ${ref.key}`);
          const version = await tx.sharedScreenVersion.findFirst({
            where: { tenantId, sharedScreenId: id, semver: ref.semver },
            select: { number: true },
          });
          return {
            sharedScreenId: id,
            mode: ref.mode,
            ...(version === null ? {} : { versionNumber: version.number }),
          };
        }),
      );
      // Linked pages are already materialized in the exported document; re-composing must agree.
      const version = await this.scripts.createVersion(
        scriptId,
        { document: remap(s.document), screens },
        {
          semver: s.semver,
          changeNote: s.changeNote,
          source: {
            packageId: pkg.manifest.packageId,
            sourceEnvironment: pkg.manifest.sourceEnvironment,
            sourceChecksum: s.checksum,
            integrationMappings: mappings,
            signatureKid: pkg.signature.kid,
          },
        },
      );
      if (Object.keys(mappings).length === 0 && version.checksum !== s.checksum)
        throw new DomainError(
          'VERBIS_PACKAGE_INVALID',
          `${s.name}: imported content differs after composition`,
        );
      created.push({ scriptId, versionId: version.id, number: version.number, name: s.name });
    }
    await this.audit.record(tx, {
      action: 'script.package.imported',
      target: { type: 'Package', id: pkg.manifest.packageId },
      metadata: {
        sourceEnvironment: pkg.manifest.sourceEnvironment,
        signatureKid: pkg.signature.kid,
        payloadChecksum: pkg.checksums.payload,
        created,
      },
    });
    return { packageId: pkg.manifest.packageId, dryRun: false, plan, dependencies, created };
  }

  async #plan(pkg: VerbisPackage) {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    return Promise.all(
      pkg.payload.scripts.map(async (s) => {
        const existing = await tx.script.findFirst({
          where: { tenantId, name: s.name, deletedAt: null },
          select: { id: true },
        });
        return {
          name: s.name,
          semver: s.semver,
          action: existing === null ? 'create_script' : 'new_version',
          scriptId: existing?.id ?? null,
        };
      }),
    );
  }
}
