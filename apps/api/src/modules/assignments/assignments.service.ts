import { Inject, Injectable } from '@nestjs/common';

import { asSubject } from '@verbis/authz';

import { currentActor } from '../../common/actor.js';
import {
  NotFoundError,
  ValidationError,
  VersionMismatchError,
} from '../../common/errors/domain-errors.js';
import { toPage, type Page } from '../../common/pagination/pagination.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthzService } from '../authz/authz.service.js';
import { detectConflicts, type AssignmentConflict } from '../routing/domain/conflicts.js';
import { SnapshotRepository } from '../routing/snapshot.repository.js';

import {
  type AssignmentDto,
  type AssignmentListQuery,
  type CreateAssignmentInput,
  toAssignmentDto,
  type UpdateAssignmentInput,
} from './assignments.dto.js';
import { AssignmentsRepository, type AssignmentRow } from './assignments.repository.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';

export type AssignmentWithWarnings = AssignmentDto & { warnings: AssignmentConflict[] };

/** Script ↔ campaign bindings (many-to-many) with conflict warnings on every write. */
@Injectable()
export class AssignmentsService {
  constructor(
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AssignmentsRepository) private readonly repository: AssignmentsRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Inject(SnapshotRepository) private readonly snapshots: SnapshotRepository,
  ) {}

  async batch(input: {
    creates: CreateAssignmentInput[];
    updates: { id: string; version: number; patch: UpdateAssignmentInput }[];
  }) {
    const creates: AssignmentWithWarnings[] = [],
      updates: AssignmentWithWarnings[] = [];
    // All operations share the request tenant transaction: any conflict rolls back the batch.
    for (const item of input.creates) creates.push(await this.create(item));
    for (const item of [...input.updates].sort((a, b) => a.id.localeCompare(b.id)))
      updates.push(await this.update(item.id, item.version, item.patch));
    return { creates, updates };
  }

  async list(query: AssignmentListQuery): Promise<Page<AssignmentDto>> {
    const tx = this.db.current(),
      tenantId = this.db.tenantId();
    if (query.filters.campaignId)
      this.authz.authorize('read', asSubject('Campaign', { id: query.filters.campaignId }));
    const campaigns = await tx.campaign.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true },
    });
    const readable = campaigns
      .filter((c) => this.authz.can('read', asSubject('Campaign', { id: c.id })))
      .map((c) => c.id);
    const rows = await this.repository.list(tx, tenantId, query, readable);
    return toPage(rows, query, toAssignmentDto, (row, field) => row[field]);
  }

  async get(id: string): Promise<AssignmentDto> {
    const row = await this.repository.find(this.db.current(), this.db.tenantId(), id);
    if (row === null) throw new NotFoundError('Assignment');
    this.authz.authorize('read', asSubject('Campaign', { id: row.campaignId }));
    return toAssignmentDto(row);
  }

  async create(input: CreateAssignmentInput): Promise<AssignmentWithWarnings> {
    const tx = this.db.current();
    await this.#checkReferences(tx, input.scriptId, input.campaignId, [
      ...(input.pinnedVersionId === undefined || input.pinnedVersionId === null
        ? []
        : [input.pinnedVersionId]),
      ...(input.variants ?? []).flatMap((v) =>
        v.pinnedVersionId === undefined ? [] : [v.pinnedVersionId],
      ),
    ]);
    const dto = toAssignmentDto(
      await this.repository.create(tx, this.db.tenantId(), input, currentActor()),
    );
    await this.audit.record(tx, {
      action: 'assignment.assignment.created',
      target: { type: 'Assignment', id: dto.id },
      after: dto,
    });
    await this.#event(tx, 'created', dto);
    return { ...dto, warnings: await this.#warnings(tx, dto) };
  }

  async update(
    id: string,
    expectedVersion: number,
    input: UpdateAssignmentInput,
  ): Promise<AssignmentWithWarnings> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const before = await this.repository.find(tx, tenantId, id);
    if (before === null) throw new NotFoundError('Assignment');
    if (before.version !== expectedVersion) throw new VersionMismatchError(before.version);
    const merged = {
      versionPolicy: input.versionPolicy ?? before.versionPolicy,
      pinnedVersionId:
        input.pinnedVersionId === undefined ? before.pinnedVersionId : input.pinnedVersionId,
    };
    if ((merged.versionPolicy === 'pinned') !== (merged.pinnedVersionId !== null)) {
      throw new ValidationError([
        {
          path: '/body/pinnedVersionId',
          message: 'pinnedVersionId is required exactly when versionPolicy is pinned',
          code: 'invalid',
        },
      ]);
    }
    await this.#checkReferences(tx, before.scriptId, before.campaignId, [
      ...(merged.pinnedVersionId === null ? [] : [merged.pinnedVersionId]),
      ...(input.variants ?? []).flatMap((v) =>
        v.pinnedVersionId === undefined ? [] : [v.pinnedVersionId],
      ),
    ]);
    const row = await this.repository.update(
      tx,
      tenantId,
      id,
      expectedVersion,
      input,
      currentActor(),
    );
    if (row === null) throw new VersionMismatchError();
    const dto = toAssignmentDto(row);
    await this.audit.record(tx, {
      action: 'assignment.assignment.updated',
      target: { type: 'Assignment', id },
      before: toAssignmentDto(before),
      after: dto,
    });
    await this.#event(tx, 'updated', dto);
    return { ...dto, warnings: await this.#warnings(tx, dto) };
  }

  async remove(id: string, expectedVersion: number): Promise<void> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const before = await this.repository.find(tx, tenantId, id);
    if (before === null) throw new NotFoundError('Assignment');
    this.authz.authorize('delete', asSubject('Campaign', { id: before.campaignId }));
    if (!(await this.repository.softDelete(tx, tenantId, id, expectedVersion, currentActor())))
      throw new VersionMismatchError(before.version);
    const dto = toAssignmentDto(before);
    await this.audit.record(tx, {
      action: 'assignment.assignment.deleted',
      target: { type: 'Assignment', id },
      before: dto,
      after: null,
    });
    await this.#event(tx, 'deleted', dto);
  }

  async #checkReferences(
    tx: TransactionClient,
    scriptId: string,
    campaignId: string,
    versionIds: string[],
  ): Promise<void> {
    this.authz.authorize(
      'update',
      asSubject('Campaign', { id: campaignId, campaignIds: [campaignId] }),
    );
    const campaigns = await tx.assignment.findMany({
      where: { tenantId: this.db.tenantId(), scriptId, deletedAt: null },
      select: { campaignId: true },
    });
    this.authz.authorize(
      'read',
      asSubject('Script', {
        id: scriptId,
        campaignIds: [...new Set(campaigns.map((c) => c.campaignId))],
      }),
    );
    const exists = await this.repository.referencesExist(tx, this.db.tenantId(), {
      scriptId,
      campaignId,
      versionIds,
    });
    const errors = [
      ...(exists.script
        ? []
        : [{ path: '/body/scriptId', message: 'script not found', code: 'not_found' }]),
      ...(exists.campaign
        ? []
        : [{ path: '/body/campaignId', message: 'campaign not found', code: 'not_found' }]),
      ...(exists.version
        ? []
        : [
            {
              path: '/body/pinnedVersionId',
              message: 'version not found for this script',
              code: 'not_found',
            },
          ]),
    ];
    if (errors.length > 0) throw new ValidationError(errors);
  }

  /** Conflicts that involve this assignment (equal priority, overlapping context). */
  async #warnings(tx: TransactionClient, dto: AssignmentDto): Promise<AssignmentConflict[]> {
    const snapshot = await this.snapshots.load(tx, this.db.tenantId(), dto.campaignId);
    if (snapshot === undefined) return [];
    return detectConflicts(snapshot.assignments).filter((c) => c.assignmentIds.includes(dto.id));
  }

  async #event(
    tx: TransactionClient,
    verb: 'created' | 'updated' | 'deleted',
    dto: AssignmentDto,
  ): Promise<void> {
    await this.outbox.record(tx, {
      type: `verbis.assignments.assignment.${verb}.v1`,
      aggregateType: 'Assignment',
      aggregateId: dto.id,
      payload: { assignment: dto },
    });
  }
}

export type { AssignmentRow };
