import { Inject, Injectable } from '@nestjs/common';

import { asSubject } from '@verbis/authz';
import { loadScriptDocument, type ValidationIssue } from '@verbis/script-schema';

import { requestContext } from '../../common/context/request-context.js';
import {
  DomainError,
  NotFoundError,
  VersionMismatchError,
} from '../../common/errors/domain-errors.js';
import { toPage, type Page } from '../../common/pagination/pagination.js';
import { actorRef } from '../../common/security/principal.js';
import { type ApiEnv, API_ENV } from '../../env.js';
import { Prisma } from '../../generated/prisma/client.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import { toAssignmentDto } from '../assignments/assignments.dto.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthzService } from '../authz/authz.service.js';

import { decodeDocument, encodeDocument } from './document-storage.js';
import { composeDocument } from './domain/screen-composition.js';
import { summarizeDiff } from './domain/version-diff.js';
import { DraftLeaseService } from './draft-lease.service.js';
import { projectDocument } from './projection.js';
import {
  type CreateScriptInput,
  type CreateVersionInput,
  type ScriptDto,
  type ScriptListQuery,
  type ScriptVersionSummaryDto,
  toScriptDto,
  toVersionSummaryDto,
  type UpdateScriptInput,
  type VersionListQuery,
} from './scripts.dto.js';
import { ScriptsRepository } from './scripts.repository.js';
import { SharedScreensService } from './shared-screens.service.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';

export interface CreatedVersion extends ScriptVersionSummaryDto {
  migratedFrom: readonly string[];
  warnings: readonly ValidationIssue[];
}

@Injectable()
export class ScriptsService {
  constructor(
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(DraftLeaseService) private readonly leases: DraftLeaseService,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(ScriptsRepository) private readonly repository: ScriptsRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Inject(SharedScreensService) private readonly sharedScreens: SharedScreensService,
  ) {}

  async list(query: ScriptListQuery): Promise<Page<ScriptDto>> {
    const rows = await this.repository.list(this.db.current(), this.db.tenantId(), query);
    return toPage(rows, query, toScriptDto, (row, field) => row[field]);
  }

  async get(id: string): Promise<ScriptDto> {
    const row = await this.repository.find(this.db.current(), this.db.tenantId(), id);
    if (row === null) throw new NotFoundError('Script');
    return toScriptDto(row);
  }

  async create(input: CreateScriptInput): Promise<ScriptDto> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    if (input.campaignId) {
      await tx.$queryRaw`SELECT id FROM campaigns WHERE tenant_id = ${tenantId}::uuid AND id = ${input.campaignId}::uuid AND deleted_at IS NULL FOR SHARE`;
      const campaign = await tx.campaign.findFirst({
        where: { tenantId, id: input.campaignId, deletedAt: null },
        select: { id: true },
      });
      if (!campaign) throw new NotFoundError('Campaign');
      this.authz.authorize('read', asSubject('Campaign', { id: campaign.id }));
    }
    this.authz.authorize(
      'create',
      asSubject('Script', { campaignIds: input.campaignId ? [input.campaignId] : [] }),
    );
    const dto = toScriptDto(
      await this.repository.create(tx, this.db.tenantId(), input, this.actor()),
    );
    if (input.campaignId) {
      const assignment = await tx.assignment.create({
        data: {
          tenantId,
          scriptId: dto.id,
          campaignId: input.campaignId,
          priority: 100,
          versionPolicy: 'latestPublished',
          createdBy: this.actor(),
          updatedBy: this.actor(),
        },
      });
      const binding = toAssignmentDto(assignment);
      await this.audit.record(tx, {
        action: 'assignment.assignment.created',
        target: { type: 'Assignment', id: assignment.id },
        after: binding,
      });
      await this.outbox.record(tx, {
        type: 'verbis.assignments.assignment.created.v1',
        aggregateType: 'Assignment',
        aggregateId: assignment.id,
        payload: { assignment: binding },
      });
    }
    await this.audit.record(tx, {
      action: 'script.script.created',
      target: { type: 'Script', id: dto.id, name: dto.name },
      after: dto,
    });
    await this.outbox.record(tx, {
      type: 'verbis.scripts.script.created.v1',
      aggregateType: 'Script',
      aggregateId: dto.id,
      payload: { script: dto },
    });
    return dto;
  }

  async update(id: string, expectedVersion: number, input: UpdateScriptInput): Promise<ScriptDto> {
    const tx = this.db.current();
    const before = await this.repository.find(tx, this.db.tenantId(), id);
    if (before === null) throw new NotFoundError('Script');
    if (before.version !== expectedVersion) throw new VersionMismatchError(before.version);
    const row = await this.repository.update(
      tx,
      this.db.tenantId(),
      id,
      expectedVersion,
      input,
      this.actor(),
    );
    if (row === null) throw new VersionMismatchError();
    const dto = toScriptDto(row);
    await this.audit.record(tx, {
      action: 'script.script.updated',
      target: { type: 'Script', id, name: dto.name },
      before: toScriptDto(before),
      after: dto,
    });
    await this.outbox.record(tx, {
      type: 'verbis.scripts.script.updated.v1',
      aggregateType: 'Script',
      aggregateId: id,
      payload: { script: dto, changed: Object.keys(input) },
    });
    return dto;
  }

  /**
   * Composes shared screens into the document (linked pages re-materialized from their pinned
   * shared-screen version, detached pages copied once), then validates (migrating older schema
   * versions). Conflicts and validation errors are 422 problems.
   */
  async #prepare(tx: TransactionClient, input: Pick<CreateVersionInput, 'document' | 'screens'>) {
    const uses = await this.sharedScreens.resolveUses(tx, input.screens);
    const composed = composeDocument(input.document, uses);
    if (composed.conflicts.length > 0) {
      throw new DomainError(
        'VERBIS_SCREEN_COMPOSITION_CONFLICT',
        'Shared screens conflict with the document; see `errors`',
        composed.conflicts.map((c) => ({
          path: `/screens/${c.sharedScreenKey}/${c.kind}/${c.id}`,
          message: `${c.kind} "${c.id}" differs`,
        })),
      );
    }
    const result = loadScriptDocument(composed.document);
    if (!result.ok) {
      throw new DomainError(
        'VERBIS_SCRIPT_DOCUMENT_INVALID',
        'The script document has errors; see `errors`',
        result.issues
          .filter((issue) => issue.severity === 'error')
          .slice(0, 200)
          .map((issue) => ({ path: issue.path, message: issue.messageKey, code: issue.code })),
      );
    }
    const stored = await encodeDocument(
      result.document,
      this.env.SCRIPT_DOCUMENT_COMPRESSION_THRESHOLD_BYTES,
    );
    return { result, document: result.document, stored, uses, pageIds: composed.pageIds };
  }

  async #writeLinks(
    tx: TransactionClient,
    versionId: string,
    prepared: Awaited<ReturnType<ScriptsService['prepareDocument']>>,
  ): Promise<void> {
    await tx.scriptScreenLink.deleteMany({
      where: { tenantId: this.db.tenantId(), scriptVersionId: versionId },
    });
    for (const use of prepared.uses) {
      await tx.scriptScreenLink.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: this.db.tenantId(),
          scriptVersionId: versionId,
          sharedScreenId: use.sharedScreenId,
          sharedScreenVersionId: use.sharedScreenVersionId,
          mode: use.mode,
          pageIds: prepared.pageIds.get(use.sharedScreenKey) ?? [],
          createdBy: this.actor(),
        },
      });
    }
  }

  /** Composition + validation without persisting (dry run for editors and imports). */
  /** CRDT updates may be temporarily semantically invalid; linked content remains immutable. */
  async composeForCollaboration(
    tx: TransactionClient,
    input: Pick<CreateVersionInput, 'document' | 'screens'>,
  ) {
    const uses = await this.sharedScreens.resolveUses(tx, input.screens);
    const composed = composeDocument(input.document, uses);
    if (composed.conflicts.length)
      throw new DomainError(
        'VERBIS_SCREEN_COMPOSITION_CONFLICT',
        'Linked fields cannot be modified',
      );
    return composed.document;
  }

  prepareDocument(tx: TransactionClient, input: Pick<CreateVersionInput, 'document' | 'screens'>) {
    return this.#prepare(tx, input);
  }

  /** Validates (migrating older schema versions), stores, projects and audits a new draft version. */
  async createVersion(
    scriptId: string,
    input: CreateVersionInput,
    provenance?: { semver?: string; changeNote?: string | null; source?: Record<string, unknown> },
  ): Promise<CreatedVersion> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    if (!(await this.repository.lockForVersioning(tx, tenantId, scriptId)))
      throw new NotFoundError('Script');
    const prepared = await this.#prepare(tx, input);
    const { result, document, stored } = prepared;
    const number = await this.repository.nextVersionNumber(tx, tenantId, scriptId);
    const actor = this.actor();
    const row = await this.repository.createVersion(
      tx,
      { tenantId, scriptId, number, schemaVersion: document.schemaVersion, actor },
      stored,
    );
    if (provenance !== undefined) {
      await tx.scriptVersion.updateMany({
        where: { id: row.id, tenantId },
        data: {
          ...(provenance.semver === undefined ? {} : { semver: provenance.semver }),
          ...(provenance.changeNote === undefined ? {} : { changeNote: provenance.changeNote }),
          ...(provenance.source === undefined
            ? {}
            : { source: provenance.source as Prisma.InputJsonValue }),
        },
      });
    }
    await this.#writeLinks(tx, row.id, prepared);
    const projected = await projectDocument(
      tx,
      { tenantId, scriptVersionId: row.id, actor },
      document,
    );

    const summary = toVersionSummaryDto(row);
    await this.audit.record(tx, {
      action: 'script.version.created',
      target: { type: 'ScriptVersion', id: row.id, name: `${scriptId}#${number}` },
      after: { ...summary, projected },
    });
    await this.outbox.record(tx, {
      type: 'verbis.scripts.version.created.v1',
      aggregateType: 'ScriptVersion',
      aggregateId: row.id,
      payload: {
        scriptId,
        versionId: row.id,
        number,
        checksum: stored.checksum,
        schemaVersion: document.schemaVersion,
      },
    });
    return {
      ...summary,
      migratedFrom: result.migrated ?? [],
      warnings: result.issues.filter((issue) => issue.severity !== 'error'),
    };
  }

  /** Replaces the content of a DRAFT version (approved/published content is immutable). */
  async updateDraft(
    scriptId: string,
    number: number,
    expectedVersion: number,
    input: CreateVersionInput,
    collaborationOwner?: string,
  ): Promise<CreatedVersion> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    await this.leases.assertWritable(tenantId, scriptId, number, collaborationOwner);
    const current = await this.repository.findVersion(tx, tenantId, scriptId, number);
    if (current === null) throw new NotFoundError('Script version');
    if (current.state !== 'draft') {
      throw new DomainError(
        'VERBIS_SCRIPT_VERSION_IMMUTABLE',
        `version is ${current.state}; create a new version or reopen it`,
      );
    }
    if (current.version !== expectedVersion) throw new VersionMismatchError(current.version);
    const before = await decodeDocument(current);
    const prepared = await this.#prepare(tx, input);
    const { stored, document, result } = prepared;
    const updated = await tx.scriptVersion.updateMany({
      where: { id: current.id, tenantId, state: 'draft', version: expectedVersion },
      data: {
        schemaVersion: document.schemaVersion,
        documentEncoding: stored.encoding,
        document:
          stored.encoding === 'json'
            ? (stored.document as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
        documentCompressed: stored.encoding === 'gzip' ? stored.compressed : null,
        documentSize: stored.size,
        checksum: stored.checksum,
        updatedBy: this.actor(),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new VersionMismatchError();
    // Rebuild read models and links for the new content.
    await tx.flow.deleteMany({ where: { tenantId, scriptVersionId: current.id } });
    await tx.variable.deleteMany({ where: { tenantId, scriptVersionId: current.id } });
    await tx.screen.deleteMany({ where: { tenantId, scriptVersionId: current.id } });
    const projected = await projectDocument(
      tx,
      { tenantId, scriptVersionId: current.id, actor: this.actor() },
      document,
    );
    await this.#writeLinks(tx, current.id, prepared);
    const row = await this.repository.findVersion(tx, tenantId, scriptId, number);
    if (row === null) throw new NotFoundError('Script version');
    const summary = toVersionSummaryDto(row);
    const diff = summarizeDiff(before, document);
    await this.audit.record(tx, {
      action: 'script.version.updated',
      target: { type: 'ScriptVersion', id: current.id, name: `${scriptId}#${String(number)}` },
      before: { checksum: current.checksum },
      after: { checksum: stored.checksum, projected },
      metadata: { changes: diff.lines.slice(0, 50), totalChanges: diff.totalChanges },
    });
    await this.outbox.record(tx, {
      type: 'verbis.scripts.version.updated.v1',
      aggregateType: 'ScriptVersion',
      aggregateId: current.id,
      payload: { scriptId, versionId: current.id, number, checksum: stored.checksum },
    });
    return {
      ...summary,
      migratedFrom: result.migrated ?? [],
      warnings: result.issues.filter((i) => i.severity !== 'error'),
    };
  }

  async authorizeRead(scriptId: string) {
    const tx = this.db.current(),
      tenantId = this.db.tenantId();
    if (
      !(await tx.script.findFirst({
        where: { tenantId, id: scriptId, deletedAt: null },
        select: { id: true },
      }))
    )
      throw new NotFoundError('Script');
    const campaigns = await tx.assignment.findMany({
      where: { tenantId, scriptId, deletedAt: null },
      select: { campaignId: true },
    });
    this.authz.authorize(
      'read',
      asSubject('Script', { id: scriptId, campaignIds: campaigns.map((c) => c.campaignId) }),
    );
  }
  async listVersions(
    scriptId: string,
    query: VersionListQuery,
  ): Promise<Page<ScriptVersionSummaryDto>> {
    const tx = this.db.current();
    if ((await this.repository.find(tx, this.db.tenantId(), scriptId)) === null)
      throw new NotFoundError('Script');
    await this.authorizeRead(scriptId);
    const rows = await this.repository.listVersions(tx, this.db.tenantId(), scriptId, query);
    return toPage(rows, query, toVersionSummaryDto, (row, field) => row[field]);
  }

  async getVersion(
    scriptId: string,
    number: number,
  ): Promise<
    ScriptVersionSummaryDto & {
      document: unknown;
      screens: { sharedScreenId: string; versionNumber: number; mode: string; pageIds: string[] }[];
    }
  > {
    const row = await this.repository.findVersion(
      this.db.current(),
      this.db.tenantId(),
      scriptId,
      number,
    );
    if (row === null) throw new NotFoundError('Script version');
    await this.authorizeRead(scriptId);
    const links = await this.db.current().scriptScreenLink.findMany({
      where: { tenantId: this.db.tenantId(), scriptVersionId: row.id },
      include: { sharedScreenVersion: { select: { number: true } } },
    });
    return {
      ...toVersionSummaryDto(row),
      document: await decodeDocument(row),
      screens: links.map((link) => ({
        sharedScreenId: link.sharedScreenId,
        versionNumber: link.sharedScreenVersion.number,
        mode: link.mode,
        pageIds: link.pageIds,
      })),
    };
  }

  private actor(): string {
    const principal = requestContext.require().principal;
    if (principal === undefined) throw new Error('No principal');
    return actorRef(principal);
  }
}
