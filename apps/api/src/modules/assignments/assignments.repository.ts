import { Injectable } from '@nestjs/common';

import { keysetOrderBy, keysetWhere } from '../../common/pagination/pagination.js';
import { Prisma } from '../../generated/prisma/client.js';

import type {
  AssignmentListQuery,
  CreateAssignmentInput,
  UpdateAssignmentInput,
} from './assignments.dto.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

const SELECT = {
  id: true,
  scriptId: true,
  campaignId: true,
  priority: true,
  validFrom: true,
  validTo: true,
  rule: true,
  pinnedVersionId: true,
  versionPolicy: true,
  conditions: true,
  abTest: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.AssignmentSelect;
export type AssignmentRow = Prisma.AssignmentGetPayload<{ select: typeof SELECT }>;

const json = (value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  (value as Prisma.InputJsonValue | null | undefined) ?? Prisma.DbNull;
const date = (value: string | null | undefined): Date | null =>
  value === undefined || value === null ? null : new Date(value);

@Injectable()
export class AssignmentsRepository {
  list(
    tx: TransactionClient,
    tenantId: string,
    query: AssignmentListQuery,
    readableCampaignIds?: string[],
  ): Promise<AssignmentRow[]> {
    const { campaignId, scriptId } = query.filters;
    const where: Prisma.AssignmentWhereInput = {
      tenantId,
      deletedAt: null,
      ...(readableCampaignIds ? { campaignId: { in: readableCampaignIds } } : {}),
      ...(campaignId === undefined ? {} : { campaignId }),
      ...(scriptId === undefined ? {} : { scriptId }),
    };
    const after = keysetWhere(query) as Prisma.AssignmentWhereInput | undefined;
    return tx.assignment.findMany({
      where: after === undefined ? where : { AND: [where, after] },
      orderBy: keysetOrderBy(query),
      take: query.limit + 1,
      select: SELECT,
    });
  }

  find(tx: TransactionClient, tenantId: string, id: string): Promise<AssignmentRow | null> {
    return tx.assignment.findFirst({ where: { id, tenantId, deletedAt: null }, select: SELECT });
  }

  forCampaign(
    tx: TransactionClient,
    tenantId: string,
    campaignId: string,
  ): Promise<AssignmentRow[]> {
    return tx.assignment.findMany({
      where: { tenantId, campaignId, deletedAt: null },
      select: SELECT,
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });
  }

  /** References must exist in the same tenant; every pinned version must belong to the script. */
  async referencesExist(
    tx: TransactionClient,
    tenantId: string,
    input: { scriptId: string; campaignId: string; versionIds: readonly string[] },
  ): Promise<{ script: boolean; campaign: boolean; version: boolean }> {
    const [script, campaign, versions] = await Promise.all([
      tx.script.count({ where: { id: input.scriptId, tenantId, deletedAt: null } }),
      tx.campaign.count({ where: { id: input.campaignId, tenantId, deletedAt: null } }),
      input.versionIds.length === 0
        ? Promise.resolve(0)
        : tx.scriptVersion.count({
            where: {
              id: { in: [...input.versionIds] },
              scriptId: input.scriptId,
              tenantId,
              deletedAt: null,
            },
          }),
    ]);
    return {
      script: script === 1,
      campaign: campaign === 1,
      version: versions === new Set(input.versionIds).size,
    };
  }

  create(
    tx: TransactionClient,
    tenantId: string,
    input: CreateAssignmentInput,
    actor: string,
  ): Promise<AssignmentRow> {
    return tx.assignment.create({
      data: {
        tenantId,
        scriptId: input.scriptId,
        campaignId: input.campaignId,
        priority: input.priority,
        versionPolicy: input.versionPolicy,
        pinnedVersionId: input.versionPolicy === 'pinned' ? (input.pinnedVersionId ?? null) : null,
        validFrom: date(input.effectiveFrom),
        validTo: date(input.effectiveTo),
        conditions: input.conditions,
        rule: json(input.expression),
        abTest: json(input.variants),
        createdBy: actor,
        updatedBy: actor,
      },
      select: SELECT,
    });
  }

  async update(
    tx: TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    input: UpdateAssignmentInput,
    actor: string,
  ): Promise<AssignmentRow | null> {
    const data: Prisma.AssignmentUpdateManyMutationInput = {
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.versionPolicy === undefined ? {} : { versionPolicy: input.versionPolicy }),
      ...(input.pinnedVersionId === undefined ? {} : { pinnedVersionId: input.pinnedVersionId }),
      ...(input.effectiveFrom === undefined ? {} : { validFrom: date(input.effectiveFrom) }),
      ...(input.effectiveTo === undefined ? {} : { validTo: date(input.effectiveTo) }),
      ...(input.conditions === undefined ? {} : { conditions: input.conditions }),
      ...(input.expression === undefined ? {} : { rule: json(input.expression) }),
      ...(input.variants === undefined ? {} : { abTest: json(input.variants) }),
      updatedBy: actor,
      version: { increment: 1 },
    };
    const result = await tx.assignment.updateMany({
      where: { id, tenantId, deletedAt: null, version: expectedVersion },
      data,
    });
    return result.count === 0 ? null : this.find(tx, tenantId, id);
  }

  async softDelete(
    tx: TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actor: string,
  ): Promise<boolean> {
    const result = await tx.assignment.updateMany({
      where: { id, tenantId, deletedAt: null, version: expectedVersion },
      data: { deletedAt: new Date(), updatedBy: actor, version: { increment: 1 } },
    });
    return result.count === 1;
  }
}
