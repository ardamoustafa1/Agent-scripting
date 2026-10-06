import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { PageSchema } from '@verbis/script-schema';

import { currentActor } from '../../common/actor.js';
import { canonicalJson, sha256Hex } from '../../common/crypto/canonical-json.js';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-errors.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import { AuditService } from '../audit/audit.service.js';

import {
  ScreenFragmentSchema,
  type FragmentUse,
  type ScreenFragment,
} from './domain/screen-composition.js';
import { compareSemver, isSemver } from './domain/semver.js';

import type { Prisma } from '../../generated/prisma/client.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

const Semver = z.string().refine(isSemver, 'semantic version like 1.0.0');

export const CreateSharedScreenSchema = z
  .strictObject({
    key: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .max(64),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    semver: Semver.default('1.0.0'),
    changeNote: z.string().trim().max(4000).optional(),
    fragment: ScreenFragmentSchema,
  })
  .meta({ id: 'CreateSharedScreen' });
export type CreateSharedScreenInput = z.output<typeof CreateSharedScreenSchema>;

export const PublishSharedScreenVersionSchema = z
  .strictObject({
    semver: Semver,
    changeNote: z.string().trim().min(1).max(4000),
    fragment: ScreenFragmentSchema,
  })
  .meta({ id: 'PublishSharedScreenVersion' });
export type PublishSharedScreenVersionInput = z.output<typeof PublishSharedScreenVersionSchema>;

export function fragmentChecksum(fragment: unknown): string {
  return sha256Hex(canonicalJson(fragment));
}

/** Pages must be valid script pages (component types and bindings are checked again on use). */
function validateFragment(fragment: ScreenFragment): void {
  const errors = fragment.pages.flatMap((page, index) => {
    const parsed = PageSchema.safeParse(page);
    return parsed.success
      ? []
      : parsed.error.issues.slice(0, 20).map((i) => ({
          path: `/body/fragment/pages/${String(index)}/${i.path.join('/')}`,
          message: i.message,
        }));
  });
  const ids = fragment.pages.map((p) => p['id']);
  if (new Set(ids).size !== ids.length)
    errors.push({ path: '/body/fragment/pages', message: 'duplicate page id' });
  if (errors.length > 0)
    throw new DomainError('VERBIS_VALIDATION_FAILED', 'The screen fragment is invalid', errors);
}

/**
 * Shared screens: reusable page groups with immutable, semver'd versions. Scripts link (follow
 * the shared screen on every new version) or detach (copy once). `impact()` lists the script
 * versions affected by an update.
 */
@Injectable()
export class SharedScreensService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
  ) {}

  async list() {
    const rows = await this.db.current().sharedScreen.findMany({
      where: { tenantId: this.db.tenantId(), deletedAt: null },
      orderBy: { key: 'asc' },
      include: {
        versions: {
          orderBy: { number: 'desc' },
          take: 1,
          select: { number: true, semver: true, checksum: true, createdAt: true },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      tags: r.tags,
      latest:
        r.versions[0] === undefined
          ? null
          : { ...r.versions[0], createdAt: r.versions[0].createdAt.toISOString() },
      version: r.version,
    }));
  }

  async create(input: CreateSharedScreenInput) {
    validateFragment(input.fragment);
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    if (
      (await tx.sharedScreen.count({ where: { tenantId, key: input.key, deletedAt: null } })) > 0
    ) {
      throw new ConflictError('A shared screen with this key exists');
    }
    const actor = currentActor();
    const id = crypto.randomUUID();
    await tx.sharedScreen.create({
      data: {
        id,
        tenantId,
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        tags: input.tags,
        createdBy: actor,
        updatedBy: actor,
      },
    });
    const version = await this.#insertVersion(
      tx,
      id,
      1,
      input.semver,
      input.changeNote ?? null,
      input.fragment,
    );
    await this.audit.record(tx, {
      action: 'screen.sharedScreen.created',
      target: { type: 'SharedScreen', id, name: input.key },
      after: { key: input.key, name: input.name, semver: input.semver, checksum: version.checksum },
    });
    await this.outbox.record(tx, {
      type: 'verbis.screens.sharedScreen.created.v1',
      aggregateType: 'SharedScreen',
      aggregateId: id,
      payload: { id, key: input.key, versionNumber: 1, semver: input.semver },
    });
    return { id, key: input.key, version: version };
  }

  /** New immutable version; returns the impact (linked script versions that are now behind). */
  async publishVersion(sharedScreenId: string, input: PublishSharedScreenVersionInput) {
    validateFragment(input.fragment);
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM shared_screens WHERE id = ${sharedScreenId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundError('Shared screen');
    const latest = await tx.sharedScreenVersion.findFirst({
      where: { sharedScreenId, tenantId },
      orderBy: { number: 'desc' },
    });
    if (latest !== null && compareSemver(input.semver, latest.semver) <= 0) {
      throw new DomainError(
        'VERBIS_SCRIPT_SEMVER_NOT_INCREASING',
        `semver must be greater than ${latest.semver}`,
      );
    }
    const version = await this.#insertVersion(
      tx,
      sharedScreenId,
      (latest?.number ?? 0) + 1,
      input.semver,
      input.changeNote,
      input.fragment,
    );
    const impact = await this.impact(sharedScreenId);
    await this.audit.record(tx, {
      action: 'screen.sharedScreen.versionPublished',
      target: { type: 'SharedScreen', id: sharedScreenId },
      after: { number: version.number, semver: input.semver, checksum: version.checksum },
      metadata: { affectedScripts: impact.affected.length },
    });
    await this.outbox.record(tx, {
      type: 'verbis.screens.sharedScreen.versionPublished.v1',
      aggregateType: 'SharedScreen',
      aggregateId: sharedScreenId,
      payload: {
        sharedScreenId,
        number: version.number,
        semver: input.semver,
        affectedScriptIds: [...new Set(impact.affected.map((a) => a.scriptId))],
      },
    });
    return { version, impact };
  }

  /** Script versions that LINK this shared screen, and whether they use the latest version. */
  async impact(sharedScreenId: string) {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const latest = await tx.sharedScreenVersion.findFirst({
      where: { sharedScreenId, tenantId },
      orderBy: { number: 'desc' },
      select: { number: true, semver: true },
    });
    if (latest === null) throw new NotFoundError('Shared screen');
    const links = await tx.scriptScreenLink.findMany({
      where: {
        tenantId,
        sharedScreenId,
        mode: 'linked',
        scriptVersion: { deletedAt: null, state: { not: 'retired' } },
      },
      select: {
        sharedScreenVersion: { select: { number: true, semver: true } },
        scriptVersion: {
          select: {
            id: true,
            number: true,
            state: true,
            semver: true,
            script: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ scriptVersionId: 'asc' }],
    });
    const affected = links.map((l) => ({
      scriptId: l.scriptVersion.script.id,
      scriptName: l.scriptVersion.script.name,
      versionId: l.scriptVersion.id,
      versionNumber: l.scriptVersion.number,
      versionState: l.scriptVersion.state,
      versionSemver: l.scriptVersion.semver,
      usesScreenVersion: l.sharedScreenVersion.number,
      usesScreenSemver: l.sharedScreenVersion.semver,
      outdated: l.sharedScreenVersion.number < latest.number,
      /** Drafts pick the update up when re-saved; published versions need a new script version. */
      action: l.scriptVersion.state === 'draft' ? 'resave_draft' : 'new_script_version',
    }));
    return { sharedScreenId, latest, affected };
  }

  /** Resolves requested uses to fragments (pinned to a concrete shared-screen version). */
  async resolveUses(
    tx: TransactionClient,
    uses: readonly {
      sharedScreenId: string;
      versionNumber?: number | undefined;
      mode: 'linked' | 'detached';
    }[],
  ): Promise<(FragmentUse & { sharedScreenId: string; sharedScreenVersionId: string })[]> {
    const tenantId = this.db.tenantId();
    const out: (FragmentUse & { sharedScreenId: string; sharedScreenVersionId: string })[] = [];
    for (const use of uses) {
      const version = await tx.sharedScreenVersion.findFirst({
        where: {
          tenantId,
          sharedScreenId: use.sharedScreenId,
          ...(use.versionNumber === undefined ? {} : { number: use.versionNumber }),
          sharedScreen: { deletedAt: null },
        },
        orderBy: { number: 'desc' },
        include: { sharedScreen: { select: { key: true } } },
      });
      if (version === null) throw new NotFoundError('Shared screen version');
      out.push({
        sharedScreenId: use.sharedScreenId,
        sharedScreenVersionId: version.id,
        sharedScreenKey: version.sharedScreen.key,
        mode: use.mode,
        fragment: ScreenFragmentSchema.parse(version.fragment),
      });
    }
    return out;
  }

  async #insertVersion(
    tx: TransactionClient,
    sharedScreenId: string,
    number: number,
    semver: string,
    changeNote: string | null,
    fragment: ScreenFragment,
  ) {
    const checksum = fragmentChecksum(fragment);
    const row = await tx.sharedScreenVersion.create({
      data: {
        id: crypto.randomUUID(),
        tenantId: this.db.tenantId(),
        sharedScreenId,
        number,
        semver,
        changeNote,
        fragment: fragment as unknown as Prisma.InputJsonValue,
        checksum,
        createdBy: currentActor(),
      },
      select: { id: true, number: true, semver: true, checksum: true },
    });
    return row;
  }
}
