import { Injectable } from '@nestjs/common';

import type { Predicate } from '@verbis/script-schema';

import { conditionsOf, variantsOf } from '../assignments/assignments.dto.js';

import { WorkingHoursSchema } from './domain/working-hours.js';

import type { CampaignSnapshot, CandidateAssignment, VersionRef } from './domain/resolver.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

export interface CampaignLookup {
  readonly campaignId?: string;
  readonly campaignCode?: string;
  readonly external?: {
    readonly platform: string;
    readonly kind: string;
    readonly externalId: string;
  };
}

/** Loads everything the resolver needs for one campaign in one consistent read (request tx). */
@Injectable()
export class SnapshotRepository {
  async findCampaignId(
    tx: TransactionClient,
    tenantId: string,
    lookup: CampaignLookup,
  ): Promise<string | undefined> {
    if (lookup.campaignId !== undefined) {
      const row = await tx.campaign.findFirst({
        where: { tenantId, id: lookup.campaignId, deletedAt: null },
        select: { id: true },
      });
      return row?.id;
    }
    if (lookup.campaignCode !== undefined) {
      const row = await tx.campaign.findFirst({
        where: { tenantId, code: lookup.campaignCode, deletedAt: null },
        select: { id: true },
      });
      return row?.id;
    }
    if (lookup.external !== undefined) {
      const row = await tx.campaignExternalMapping.findFirst({
        where: {
          tenantId,
          platform: lookup.external.platform,
          kind: lookup.external.kind,
          externalId: lookup.external.externalId,
          deletedAt: null,
          campaign: { deletedAt: null },
        },
        select: { campaignId: true },
      });
      return row?.campaignId;
    }
    return undefined;
  }

  async load(
    tx: TransactionClient,
    tenantId: string,
    campaignId: string,
  ): Promise<CampaignSnapshot | undefined> {
    const campaign = await tx.campaign.findFirst({
      where: { tenantId, id: campaignId, deletedAt: null },
      select: {
        id: true,
        code: true,
        status: true,
        channels: true,
        startsAt: true,
        endsAt: true,
        workingHours: true,
        queues: true,
        defaultLocale: true,
        locales: true,
      },
    });
    if (campaign === null) return undefined;
    const rows = await tx.assignment.findMany({
      where: { tenantId, campaignId, deletedAt: null, script: { deletedAt: null } },
      select: {
        id: true,
        scriptId: true,
        priority: true,
        validFrom: true,
        validTo: true,
        conditions: true,
        rule: true,
        versionPolicy: true,
        pinnedVersionId: true,
        abTest: true,
        createdAt: true,
        script: { select: { status: true, currentVersionId: true } },
      },
    });
    const assignments: CandidateAssignment[] = rows.map((r) => ({
      id: r.id,
      scriptId: r.scriptId,
      scriptStatus: r.script.status,
      priority: r.priority,
      effectiveFrom: r.validFrom,
      effectiveTo: r.validTo,
      conditions: conditionsOf(r.conditions),
      expression: (r.rule ?? null) as Predicate | null,
      versionPolicy: r.versionPolicy === 'pinned' ? 'pinned' : 'latestPublished',
      pinnedVersionId: r.pinnedVersionId,
      variants: variantsOf(r.abTest),
      createdAt: r.createdAt,
    }));
    const scriptIds = [...new Set(assignments.map((a) => a.scriptId))];
    const pinned = assignments
      .flatMap((a) => [
        a.pinnedVersionId,
        ...(a.variants ?? []).map((v) => v.pinnedVersionId ?? null),
      ])
      .filter((v): v is string => v !== null);
    const versions =
      scriptIds.length === 0
        ? []
        : await tx.scriptVersion.findMany({
            where: {
              tenantId,
              deletedAt: null,
              OR: [{ scriptId: { in: scriptIds }, state: 'published' }, { id: { in: pinned } }],
            },
            select: {
              id: true,
              scriptId: true,
              number: true,
              semver: true,
              checksum: true,
              state: true,
            },
          });
    const hours =
      campaign.workingHours === null ? null : WorkingHoursSchema.safeParse(campaign.workingHours);
    return {
      campaign: {
        id: campaign.id,
        code: campaign.code,
        status: campaign.status,
        channels: campaign.channels,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
        // Malformed hours are ignored (never block routing); validation happens on write.
        workingHours: !hours?.success ? null : hours.data,
        attributes: {
          queues: campaign.queues,
          defaultLocale: campaign.defaultLocale,
          locales: campaign.locales,
        },
      },
      assignments,
      versions: versions.map((v): VersionRef => ({
        ...v,
        state: v.state,
        current: rows.some((r) => r.scriptId === v.scriptId && r.script.currentVersionId === v.id),
      })),
    };
  }
}
