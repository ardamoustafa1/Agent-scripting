import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { asSubject } from '@verbis/authz';
import {
  mergeDocuments,
  ScriptDocumentSchema,
  type ConflictSide,
  type ScriptDocument,
} from '@verbis/script-schema';

import { requestContext } from '../../common/context/request-context.js';
import { DomainError, NotFoundError } from '../../common/errors/domain-errors.js';
import { actorRef } from '../../common/security/principal.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthzService } from '../authz/authz.service.js';

import { decodeDocument } from './document-storage.js';
import { ScriptsService } from './scripts.service.js';

import type { Prisma } from '../../generated/prisma/client.js';

export const BranchNameSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lower-case words separated by hyphens');

export interface BranchDto {
  name: string;
  /** The single working version of the branch. */
  versionNumber: number;
  /** The version the branch was created from. */
  parentNumber: number;
  state: string;
  createdAt: string;
  createdBy: string;
  /** Number of the mainline version the branch was merged into, once merged. */
  mergedInto: number | null;
}

/** A short, bounded JSON excerpt for the conflict list (null = absent). */
const excerpt = (value: unknown): string | null => {
  if (value === undefined) return null;
  const text = JSON.stringify(value);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
};

const Source = z.looseObject({ mergedIntoNumber: z.number().int().optional() });

/** Script branches (ADR-0051, DIFFERENTIATORS C3). */
@Injectable()
export class BranchesService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(ScriptsService) private readonly scripts: ScriptsService,
  ) {}

  private actor(): string {
    const principal = requestContext.require().principal;
    if (principal === undefined) throw new Error('No principal');
    return actorRef(principal);
  }

  private async subject(scriptId: string) {
    const tx = this.db.current();
    const script = await tx.script.findFirst({
      where: { id: scriptId, tenantId: this.db.tenantId(), deletedAt: null },
      select: { id: true },
    });
    if (!script) throw new NotFoundError('Script');
    const campaigns = await tx.assignment.findMany({
      where: { tenantId: this.db.tenantId(), scriptId, deletedAt: null },
      select: { campaignId: true },
    });
    return asSubject('Script', { id: scriptId, campaignIds: campaigns.map((c) => c.campaignId) });
  }

  private toDto(row: {
    branch: string | null;
    number: number;
    state: string;
    createdAt: Date;
    createdBy: string;
    source: Prisma.JsonValue;
    parent: { number: number } | null;
  }): BranchDto {
    const source = Source.safeParse(row.source ?? {});
    return {
      name: row.branch ?? '',
      versionNumber: row.number,
      parentNumber: row.parent?.number ?? 0,
      state: row.state,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
      mergedInto: source.success ? (source.data.mergedIntoNumber ?? null) : null,
    };
  }

  async list(scriptId: string): Promise<BranchDto[]> {
    this.authz.authorize('read', await this.subject(scriptId));
    const rows = await this.db.current().scriptVersion.findMany({
      where: {
        tenantId: this.db.tenantId(),
        scriptId,
        branch: { not: null },
        deletedAt: null,
      },
      select: {
        branch: true,
        number: true,
        state: true,
        createdAt: true,
        createdBy: true,
        source: true,
        parent: { select: { number: true } },
      },
      orderBy: { number: 'desc' },
      take: 200,
    });
    return rows.map((row) => this.toDto(row));
  }

  /** Creates the branch's working version as a copy of `fromNumber` (a mainline version). */
  async create(scriptId: string, name: string, fromNumber: number): Promise<BranchDto> {
    this.authz.authorize('update', await this.subject(scriptId));
    const tx = this.db.current(),
      tenantId = this.db.tenantId();
    const source = await tx.scriptVersion.findFirst({
      where: { tenantId, scriptId, number: fromNumber, deletedAt: null },
      select: { id: true, branch: true },
    });
    if (!source) throw new NotFoundError('Script version');
    if (source.branch !== null)
      throw new DomainError('VERBIS_VALIDATION_FAILED', 'Branch from a mainline version');
    const taken = await tx.scriptVersion.count({
      where: { tenantId, scriptId, branch: name, deletedAt: null },
    });
    if (taken > 0) throw new DomainError('VERBIS_BRANCH_EXISTS', `Branch "${name}" exists`);
    const from = await this.scripts.getVersion(scriptId, fromNumber);
    const created = await this.scripts.createVersion(
      scriptId,
      {
        document: from.document as Record<string, unknown>,
        screens: from.screens.map((s) => ({
          sharedScreenId: s.sharedScreenId,
          versionNumber: s.versionNumber,
          mode: s.mode as 'linked' | 'detached',
        })),
      },
      { changeNote: `Branch ${name} from version ${String(fromNumber)}` },
    );
    await tx.scriptVersion.updateMany({
      where: { id: created.id, tenantId },
      data: { branch: name, parentVersionId: source.id },
    });
    await this.audit.record(tx, {
      action: 'script.branch.created',
      target: { type: 'Script', id: scriptId },
      after: { branch: name, versionNumber: created.number, parentNumber: fromNumber },
    });
    const row = await tx.scriptVersion.findFirstOrThrow({
      where: { id: created.id, tenantId },
      select: {
        branch: true,
        number: true,
        state: true,
        createdAt: true,
        createdBy: true,
        source: true,
        parent: { select: { number: true } },
      },
    });
    return this.toDto(row);
  }

  private async documents(scriptId: string, name: string) {
    const tx = this.db.current(),
      tenantId = this.db.tenantId();
    const branch = await tx.scriptVersion.findFirst({
      where: { tenantId, scriptId, branch: name, deletedAt: null },
      select: {
        id: true,
        number: true,
        source: true,
        document: true,
        documentEncoding: true,
        documentCompressed: true,
        parent: {
          select: {
            number: true,
            document: true,
            documentEncoding: true,
            documentCompressed: true,
          },
        },
      },
    });
    if (!branch?.parent) throw new NotFoundError('Branch');
    const head = await tx.scriptVersion.findFirst({
      where: { tenantId, scriptId, branch: null, deletedAt: null },
      orderBy: { number: 'desc' },
      select: {
        number: true,
        document: true,
        documentEncoding: true,
        documentCompressed: true,
      },
    });
    if (!head) throw new NotFoundError('Script version');
    const parse = async (row: Parameters<typeof decodeDocument>[0]): Promise<ScriptDocument> => {
      const parsed = ScriptDocumentSchema.safeParse(await decodeDocument(row));
      if (!parsed.success) throw new DomainError('VERBIS_SCRIPT_DOCUMENT_INVALID');
      return parsed.data;
    };
    return {
      branch,
      head,
      base: await parse(branch.parent),
      ours: await parse(head),
      theirs: await parse(branch),
    };
  }

  /** What merging the branch into the current mainline head would do; stores nothing. */
  async mergePreview(scriptId: string, name: string) {
    this.authz.authorize('read', await this.subject(scriptId));
    const { branch, head, base, ours, theirs } = await this.documents(scriptId, name);
    const result = mergeDocuments(base, ours, theirs);
    return {
      branch: name,
      baseNumber: branch.parent?.number ?? 0,
      mainlineNumber: head.number,
      branchNumber: branch.number,
      conflicts: result.conflicts.map((c) => ({
        path: c.path,
        kind: c.kind,
        base: excerpt(c.base),
        ours: excerpt(c.ours),
        theirs: excerpt(c.theirs),
      })),
      issues: result.issues,
      canMerge: result.document !== null,
    };
  }

  /**
   * Merges the branch into a NEW mainline draft. Conflicts are never auto-resolved: the author
   * resolves them in the branch and merges again. The new draft goes through the normal review,
   * approval and publication gate.
   */
  async merge(
    scriptId: string,
    name: string,
    resolutions: Readonly<Record<string, ConflictSide>> = {},
  ) {
    this.authz.authorize('update', await this.subject(scriptId));
    const { branch, head, base, ours, theirs } = await this.documents(scriptId, name);
    if (Source.safeParse(branch.source ?? {}).data?.mergedIntoNumber !== undefined)
      throw new DomainError('VERBIS_BRANCH_MERGED', `Branch "${name}" was already merged`);
    const found = mergeDocuments(base, ours, theirs).conflicts.map((c) => c.path);
    const unknown = Object.keys(resolutions).filter((path) => !found.includes(path));
    if (unknown.length > 0)
      throw new DomainError(
        'VERBIS_VALIDATION_FAILED',
        'Resolutions refer to paths that are not conflicts',
        unknown.slice(0, 50).map((path) => ({ path, message: 'not a conflict' })),
      );
    const result = mergeDocuments(base, ours, theirs, resolutions);
    const open = result.conflicts.filter((c) => c.resolution === undefined);
    if (open.length > 0)
      throw new DomainError(
        'VERBIS_BRANCH_CONFLICT',
        `${String(open.length)} conflict(s) need a choice`,
        open.slice(0, 50).map((c) => ({ path: c.path, message: c.kind })),
      );
    if (result.document === null)
      throw new DomainError(
        'VERBIS_SCRIPT_DOCUMENT_INVALID',
        'The merged script is not valid',
        result.issues.slice(0, 50).map((message) => ({ path: '/document', message })),
      );
    const latest = await this.scripts.getVersion(scriptId, head.number);
    const created = await this.scripts.createVersion(
      scriptId,
      {
        document: result.document,
        screens: latest.screens.map((s) => ({
          sharedScreenId: s.sharedScreenId,
          versionNumber: s.versionNumber,
          mode: s.mode as 'linked' | 'detached',
        })),
      },
      {
        changeNote: `Merge branch ${name}`,
        source: {
          mergedBranch: name,
          mergedBranchVersion: branch.number,
          mainlineBase: head.number,
        },
      },
    );
    const tx = this.db.current();
    await tx.scriptVersion.updateMany({
      where: { id: branch.id, tenantId: this.db.tenantId() },
      data: {
        source: {
          ...(Source.safeParse(branch.source ?? {}).data ?? {}),
          mergedIntoNumber: created.number,
        },
      },
    });
    await this.audit.record(tx, {
      action: 'script.branch.merged',
      target: { type: 'Script', id: scriptId },
      after: {
        branch: name,
        branchVersion: branch.number,
        mainlineBase: head.number,
        newVersion: created.number,
        resolved: result.conflicts.map((c) => `${c.path}=${c.resolution ?? ''}`),
      },
      metadata: { actor: this.actor() },
    });
    return created;
  }
}
