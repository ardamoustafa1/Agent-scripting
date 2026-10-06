import { Injectable } from '@nestjs/common';

import { keysetOrderBy, keysetWhere } from '../../common/pagination/pagination.js';
import { reserveTenantCapacity } from '../tenancy/quota.js';

import type { StoredDocument } from './document-storage.js';
import type {
  CreateScriptInput,
  ScriptListQuery,
  UpdateScriptInput,
  VersionListQuery,
} from './scripts.dto.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

const SCRIPT_SELECT = {
  id: true,
  name: true,
  description: true,
  status: true,
  tags: true,
  currentVersionId: true,
  approvalPolicy: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.ScriptSelect;
export type ScriptRow = Prisma.ScriptGetPayload<{ select: typeof SCRIPT_SELECT }>;

const VERSION_SUMMARY_SELECT = {
  id: true,
  scriptId: true,
  number: true,
  state: true,
  schemaVersion: true,
  documentEncoding: true,
  documentSize: true,
  checksum: true,
  publishedAt: true,
  publishedBy: true,
  semver: true,
  changeNote: true,
  submittedAt: true,
  submittedBy: true,
  approvedAt: true,
  retiredAt: true,
  reviewRound: true,
  createdBy: true,
  updatedBy: true,
  source: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.ScriptVersionSelect;
export type VersionSummaryRow = Prisma.ScriptVersionGetPayload<{
  select: typeof VERSION_SUMMARY_SELECT;
}>;

const VERSION_SELECT = {
  ...VERSION_SUMMARY_SELECT,
  document: true,
  documentCompressed: true,
} satisfies Prisma.ScriptVersionSelect;
export type VersionRow = Prisma.ScriptVersionGetPayload<{ select: typeof VERSION_SELECT }>;

@Injectable()
export class ScriptsRepository {
  readonly summarySelect = VERSION_SUMMARY_SELECT;

  async list(
    tx: TransactionClient,
    tenantId: string,
    query: ScriptListQuery,
  ): Promise<ScriptRow[]> {
    const { status, tag, q } = query.filters;
    const where: Prisma.ScriptWhereInput = {
      tenantId,
      deletedAt: null,
      ...(status === undefined ? {} : { status }),
      ...(tag === undefined ? {} : { tags: { has: tag } }),
      ...(q === undefined ? {} : { name: { contains: q, mode: 'insensitive' } }),
    };
    const after = keysetWhere(query) as Prisma.ScriptWhereInput | undefined;
    return tx.script.findMany({
      where: after === undefined ? where : { AND: [where, after] },
      orderBy: keysetOrderBy(query),
      take: query.limit + 1,
      select: SCRIPT_SELECT,
    });
  }

  find(tx: TransactionClient, tenantId: string, id: string): Promise<ScriptRow | null> {
    return tx.script.findFirst({ where: { id, tenantId, deletedAt: null }, select: SCRIPT_SELECT });
  }

  async create(
    tx: TransactionClient,
    tenantId: string,
    input: CreateScriptInput,
    actor: string,
  ): Promise<ScriptRow> {
    await reserveTenantCapacity(tx, tenantId, 'scripts');
    return tx.script.create({
      data: {
        tenantId,
        name: input.name,
        description: input.description ?? null,
        tags: input.tags,
        createdBy: actor,
        updatedBy: actor,
      },
      select: SCRIPT_SELECT,
    });
  }

  async update(
    tx: TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    input: UpdateScriptInput,
    actor: string,
  ): Promise<ScriptRow | null> {
    const data: Prisma.ScriptUpdateManyMutationInput = {
      ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
      updatedBy: actor,
      version: { increment: 1 },
    };
    const result = await tx.script.updateMany({
      where: { id, tenantId, deletedAt: null, version: expectedVersion },
      data,
    });
    return result.count === 0 ? null : this.find(tx, tenantId, id);
  }

  /** Locks the script row so concurrent version creation gets consecutive numbers. */
  async lockForVersioning(
    tx: TransactionClient,
    tenantId: string,
    scriptId: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM scripts WHERE id = ${scriptId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL FOR UPDATE`;
    return rows.length === 1;
  }

  async nextVersionNumber(
    tx: TransactionClient,
    tenantId: string,
    scriptId: string,
  ): Promise<number> {
    const result = await tx.scriptVersion.aggregate({
      where: { tenantId, scriptId },
      _max: { number: true },
    });
    return (result._max.number ?? 0) + 1;
  }

  createVersion(
    tx: TransactionClient,
    scope: {
      tenantId: string;
      scriptId: string;
      number: number;
      schemaVersion: string;
      actor: string;
    },
    stored: StoredDocument,
  ): Promise<VersionSummaryRow> {
    return tx.scriptVersion.create({
      data: {
        tenantId: scope.tenantId,
        scriptId: scope.scriptId,
        number: scope.number,
        schemaVersion: scope.schemaVersion,
        documentEncoding: stored.encoding,
        ...(stored.encoding === 'json'
          ? { document: stored.document as unknown as Prisma.InputJsonValue }
          : { documentCompressed: stored.compressed }),
        documentSize: stored.size,
        checksum: stored.checksum,
        createdBy: scope.actor,
        updatedBy: scope.actor,
      },
      select: VERSION_SUMMARY_SELECT,
    });
  }

  async listVersions(
    tx: TransactionClient,
    tenantId: string,
    scriptId: string,
    query: VersionListQuery,
  ): Promise<VersionSummaryRow[]> {
    const where: Prisma.ScriptVersionWhereInput = { tenantId, scriptId, deletedAt: null };
    const after = keysetWhere(query) as Prisma.ScriptVersionWhereInput | undefined;
    return tx.scriptVersion.findMany({
      where: after === undefined ? where : { AND: [where, after] },
      orderBy: keysetOrderBy(query),
      take: query.limit + 1,
      select: VERSION_SUMMARY_SELECT,
    });
  }

  findVersion(
    tx: TransactionClient,
    tenantId: string,
    scriptId: string,
    number: number,
  ): Promise<VersionRow | null> {
    return tx.scriptVersion.findFirst({
      where: { tenantId, scriptId, number, deletedAt: null },
      select: VERSION_SELECT,
    });
  }
}
