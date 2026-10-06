import { Injectable } from '@nestjs/common';

import { keysetOrderBy, keysetWhere } from '../../common/pagination/pagination.js';
import { Prisma } from '../../generated/prisma/client.js';

import type {
  CampaignListQuery,
  CreateCampaignInput,
  UpdateCampaignInput,
} from './campaigns.dto.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

const SELECT = {
  id: true,
  code: true,
  locales: true,
  workingHours: true,
  outcomeSet: true,
  mappings: {
    where: { deletedAt: null },
    select: { platform: true, kind: true, externalId: true },
    orderBy: [{ platform: 'asc' }, { kind: 'asc' }, { externalId: 'asc' }],
  },
  name: true,
  description: true,
  status: true,
  defaultLocale: true,
  channels: true,
  queues: true,
  startsAt: true,
  endsAt: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.CampaignSelect;

export type CampaignRow = Prisma.CampaignGetPayload<{ select: typeof SELECT }>;

/** `Kart Satış Q4` → `KART_SATIS_Q4` (ASCII, A-Z0-9_). */
export function deriveCode(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return ascii === '' ? 'CAMPAIGN' : ascii;
}

const toDate = (value: string | null | undefined): Date | null | undefined =>
  value === undefined ? undefined : value === null ? null : new Date(value);

/**
 * Every query filters by tenant explicitly (application layer) and runs inside the request's
 * tenant transaction (RLS layer). Soft-deleted rows are invisible.
 */
@Injectable()
export class CampaignsRepository {
  async list(
    tx: TransactionClient,
    tenantId: string,
    query: CampaignListQuery,
  ): Promise<CampaignRow[]> {
    const { status, channel, q } = query.filters;
    const where: Prisma.CampaignWhereInput = {
      tenantId,
      deletedAt: null,
      ...(status === undefined ? {} : { status }),
      ...(channel === undefined ? {} : { channels: { has: channel } }),
      ...(q === undefined ? {} : { name: { contains: q, mode: 'insensitive' } }),
    };
    const after = keysetWhere(query) as Prisma.CampaignWhereInput | undefined;
    return tx.campaign.findMany({
      where: after === undefined ? where : { AND: [where, after] },
      orderBy: keysetOrderBy(query),
      take: query.limit + 1,
      select: SELECT,
    });
  }

  find(tx: TransactionClient, tenantId: string, id: string): Promise<CampaignRow | null> {
    return tx.campaign.findFirst({ where: { id, tenantId, deletedAt: null }, select: SELECT });
  }

  create(
    tx: TransactionClient,
    tenantId: string,
    input: CreateCampaignInput,
    actor: string,
  ): Promise<CampaignRow> {
    return tx.campaign.create({
      data: {
        tenantId,
        name: input.name,
        code: input.code ?? deriveCode(input.name),
        locales: input.locales,
        workingHours:
          input.workingHours === undefined || input.workingHours === null
            ? Prisma.DbNull
            : (input.workingHours as Prisma.InputJsonObject),
        outcomeSet: input.outcomeSet,
        description: input.description ?? null,
        status: input.status,
        defaultLocale: input.defaultLocale,
        channels: input.channels,
        queues: input.queues,
        startsAt: toDate(input.startsAt) ?? null,
        endsAt: toDate(input.endsAt) ?? null,
        createdBy: actor,
        updatedBy: actor,
      },
      select: SELECT,
    });
  }

  /** Optimistic update: affects nothing when the version moved on. */
  async update(
    tx: TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    input: UpdateCampaignInput,
    actor: string,
  ): Promise<CampaignRow | null> {
    const { startsAt, endsAt, workingHours, outcomeSet, ...withMappings } = input;
    const rest = Object.fromEntries(
      Object.entries(withMappings).filter(([key]) => key !== 'externalMappings'),
    );
    const data: Prisma.CampaignUpdateManyMutationInput = {
      ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)),
      ...(workingHours === undefined
        ? {}
        : {
            workingHours: workingHours ?? Prisma.DbNull,
          }),
      ...(outcomeSet === undefined ? {} : { outcomeSet: outcomeSet }),
      ...(startsAt === undefined
        ? {}
        : { startsAt: startsAt === null ? null : new Date(startsAt) }),
      ...(endsAt === undefined ? {} : { endsAt: endsAt === null ? null : new Date(endsAt) }),
      updatedBy: actor,
      version: { increment: 1 },
    };
    const result = await tx.campaign.updateMany({
      where: { id, tenantId, deletedAt: null, version: expectedVersion },
      data,
    });
    return result.count === 0 ? null : this.find(tx, tenantId, id);
  }

  /** Replaces the external mapping set (soft-deletes removed ones). Unique per tenant + object. */
  async replaceMappings(
    tx: TransactionClient,
    tenantId: string,
    campaignId: string,
    mappings: readonly { platform: string; kind: string; externalId: string }[],
    actor: string,
  ): Promise<void> {
    const key = (m: { platform: string; kind: string; externalId: string }) =>
      `${m.platform}\u0000${m.kind}\u0000${m.externalId}`;
    const current = await tx.campaignExternalMapping.findMany({
      where: { tenantId, campaignId, deletedAt: null },
    });
    const wanted = new Set(mappings.map(key));
    const removed = current.filter((m) => !wanted.has(key(m))).map((m) => m.id);
    if (removed.length > 0) {
      await tx.campaignExternalMapping.updateMany({
        where: { id: { in: removed }, tenantId },
        data: { deletedAt: new Date() },
      });
    }
    const have = new Set(current.map(key));
    for (const m of mappings.filter((x) => !have.has(key(x)))) {
      await tx.campaignExternalMapping.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          campaignId,
          platform: m.platform,
          kind: m.kind,
          externalId: m.externalId,
          createdBy: actor,
        },
      });
    }
  }

  async softDelete(
    tx: TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actor: string,
  ): Promise<boolean> {
    const result = await tx.campaign.updateMany({
      where: { id, tenantId, deletedAt: null, version: expectedVersion },
      data: { deletedAt: new Date(), updatedBy: actor, version: { increment: 1 } },
    });
    return result.count === 1;
  }
}
