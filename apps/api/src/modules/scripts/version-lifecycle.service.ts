import { Inject, Injectable } from '@nestjs/common';

import { asSubject, authorIdsOf } from '@verbis/authz';
import { mergeDocuments, ScriptDocumentSchema, type ScriptDocument } from '@verbis/script-schema';

import { requestContext } from '../../common/context/request-context.js';
import { DomainError, NotFoundError } from '../../common/errors/domain-errors.js';
import { actorRef } from '../../common/security/principal.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import { AuditService } from '../audit/audit.service.js';
import { toInt } from '../audit/core/scalars.js';
import { AuthzService } from '../authz/authz.service.js';

import { decodeDocument } from './document-storage.js';
import {
  ApprovalPolicySchema,
  approvalReached,
  DEFAULT_APPROVAL_POLICY,
  eligibility,
  nextState,
  type ApprovalPolicy,
  type LifecycleAction,
  type Review,
  type VersionState,
} from './domain/lifecycle.js';
import { compareSemver } from './domain/semver.js';
import { jsonPatch, summarizeDiff } from './domain/version-diff.js';
import { DraftLeaseService } from './draft-lease.service.js';
import { PreviewService } from './preview.service.js';
import {
  toVersionSummaryDto,
  type ReviewVersionInput,
  type SubmitVersionInput,
} from './scripts.dto.js';
import { ScriptsRepository } from './scripts.repository.js';

import type { Prisma } from '../../generated/prisma/client.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

interface LockedVersion {
  id: string;
  number: number;
  state: VersionState;
  semver: string | null;
  checksum: string;
  reviewRound: number;
  createdBy: string;
  updatedBy: string;
  submittedBy: string | null;
  contributors: string[];
  branch: string | null;
}

const VERSION_EVENT: Record<LifecycleAction, string> = {
  submit: 'submitted',
  withdraw: 'withdrawn',
  approve: 'approved',
  reject: 'rejected',
  reopen: 'reopened',
  publish: 'published',
  retire: 'retired',
};

/**
 * Version lifecycle: draft → in_review → approved → published → retired (ADR-0015). Every
 * transition is optimistic (`WHERE state = <from>`) under a row lock, audited and published.
 * Content immutability outside draft is also enforced by the `script_versions_guard` trigger.
 */
@Injectable()
export class VersionLifecycleService {
  constructor(
    @Inject(DraftLeaseService) private readonly leases: DraftLeaseService,
    @Inject(PreviewService) private readonly preview: PreviewService,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(ScriptsRepository) private readonly repository: ScriptsRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}

  async submit(scriptId: string, number: number, input: Partial<SubmitVersionInput>) {
    const tx = this.db.current();
    const version = await this.#lock(tx, scriptId, number);
    if (typeof version.branch === 'string')
      throw new DomainError(
        'VERBIS_BRANCH_NOT_PUBLISHABLE',
        `version ${String(number)} belongs to branch "${version.branch}"`,
      );
    const semver = input.semver ?? version.semver;
    const changeNote = input.changeNote?.trim();
    if (!changeNote || changeNote.length > 4000)
      throw new DomainError('VERBIS_VALIDATION_FAILED', 'A change note is required', [
        { path: '/body/changeNote', message: 'required' },
      ]);
    if (semver === null) {
      throw new DomainError('VERBIS_VALIDATION_FAILED', 'semver is required', [
        { path: '/body/semver', message: 'required' },
      ]);
    }
    await this.#authorizeScript(tx, scriptId, 'update', version);
    // Strictly greater than every semver already used by this script (any state).
    const others = await tx.scriptVersion.findMany({
      where: {
        tenantId: this.db.tenantId(),
        scriptId,
        semver: { not: null },
        id: { not: version.id },
      },
      select: { semver: true },
    });
    const clash = others.map((o) => o.semver ?? '').find((s) => compareSemver(semver, s) <= 0);
    if (clash !== undefined) {
      throw new DomainError(
        'VERBIS_SCRIPT_SEMVER_NOT_INCREASING',
        `semver must be greater than ${clash}`,
      );
    }
    await this.preview.requirePassing(scriptId, number);
    return this.#transition(tx, scriptId, version, 'submit', {
      semver,
      changeNote,
      submittedAt: new Date(),
      submittedBy: this.#actor(),
      reviewRound: { increment: 1 },
    });
  }

  async withdraw(scriptId: string, number: number) {
    const tx = this.db.current();
    const version = await this.#lock(tx, scriptId, number);
    await this.#authorizeScript(tx, scriptId, 'update', version);
    return this.#transition(tx, scriptId, version, 'withdraw', {});
  }

  /** approved → draft: needed to change an approved version (its approval is discarded). */
  async reopen(scriptId: string, number: number) {
    const tx = this.db.current();
    const version = await this.#lock(tx, scriptId, number);
    await this.#authorizeScript(tx, scriptId, 'update', version);
    return this.#transition(tx, scriptId, version, 'reopen', { approvedAt: null });
  }

  async review(scriptId: string, number: number, input: ReviewVersionInput) {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const version = await this.#lock(tx, scriptId, number);
    if (version.state !== 'in_review') {
      throw new DomainError(
        'VERBIS_SCRIPT_INVALID_TRANSITION',
        `cannot review a ${version.state} version`,
      );
    }
    const ctx = requestContext.require();
    const reviewer = this.#actor();
    const reviews = await this.#reviews(tx, version.id);
    if (input.decision !== 'commented') {
      // CASL (scope + SoD rule) first, then the approval policy.
      await this.#authorizeScript(tx, scriptId, 'approve', version);
      const policy = await this.#policy(tx, scriptId);
      const problems = eligibility(
        policy,
        { id: reviewer, roles: ctx.authz?.roles ?? [] },
        this.#authors(version),
        reviews,
        version.reviewRound,
        ctx.authz?.separationOfDuties ?? true,
      );
      if (problems.includes('author')) {
        throw new DomainError(
          'VERBIS_AUTHZ_SOD_VIOLATION',
          'The author of a version cannot approve or reject it',
        );
      }
      if (problems.length > 0) {
        throw new DomainError(
          'VERBIS_SCRIPT_APPROVER_NOT_ELIGIBLE',
          `not eligible: ${problems.join(', ')}`,
        );
      }
    } else {
      await this.#authorizeScript(tx, scriptId, 'read', version);
    }
    if (input.decision === 'approved') await this.preview.requirePassing(scriptId, number);
    const review = await tx.scriptVersionReview.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        scriptVersionId: version.id,
        round: version.reviewRound,
        reviewer,
        decision: input.decision,
        comment: input.comment ?? null,
        reason: input.decision === 'rejected' ? input.reason : null,
      },
    });
    await this.audit.record(tx, {
      action: `script.version.reviewed`,
      target: { type: 'ScriptVersion', id: version.id, name: `${scriptId}#${String(number)}` },
      outcome: 'success',
      ...(input.decision === 'rejected' ? { reason: input.reason } : {}),
      metadata: { decision: input.decision, round: version.reviewRound, reviewId: review.id },
    });
    const policy = await this.#policy(tx, scriptId);
    const all: Review[] = [
      ...reviews,
      { reviewer, round: version.reviewRound, decision: input.decision },
    ];
    if (input.decision === 'approved' && approvalReached(policy, all, version.reviewRound)) {
      return this.#transition(tx, scriptId, version, 'approve', { approvedAt: new Date() });
    }
    if (input.decision === 'rejected' && policy.rejectionReturnsToDraft) {
      return this.#transition(tx, scriptId, version, 'reject', {}, input.reason);
    }
    return toVersionSummaryDto(await this.#summary(tx, version.id));
  }

  async publish(scriptId: string, number: number) {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const version = await this.#lock(tx, scriptId, number);
    await this.#authorizeScript(tx, scriptId, 'publish', version);
    await this.preview.requirePassing(scriptId, number);
    const dto = await this.#transition(tx, scriptId, version, 'publish', {
      publishedAt: new Date(),
      publishedBy: this.#actor(),
    });
    await this.#refreshCurrentVersion(tx, tenantId, scriptId);
    await tx.script.updateMany({
      where: { id: scriptId, tenantId, status: 'draft' },
      data: { status: 'active', updatedBy: this.#actor() },
    });
    return dto;
  }

  /** Move the release head back without rewriting approved content or explicit pins. */
  async rollback(scriptId: string, targetNumber: number, expectedCurrentVersionId: string) {
    const tx = this.db.current(),
      tenantId = this.db.tenantId();
    const target = await this.#lock(tx, scriptId, targetNumber);
    await this.#authorizeScript(tx, scriptId, 'publish', target);
    if (target.state !== 'published')
      throw new DomainError(
        'VERBIS_SCRIPT_INVALID_TRANSITION',
        'Rollback target must be published',
      );
    const head = await tx.scriptVersion.findFirst({
      where: {
        id: expectedCurrentVersionId,
        tenantId,
        scriptId,
        state: 'published',
        deletedAt: null,
      },
      select: { number: true },
    });
    if (!head || head.number <= targetNumber)
      throw new DomainError(
        'VERBIS_SCRIPT_INVALID_TRANSITION',
        'Rollback must select an earlier release',
      );
    await this.preview.requirePassing(scriptId, targetNumber);
    const changed = await tx.script.updateMany({
      where: {
        id: scriptId,
        tenantId,
        currentVersionId: expectedCurrentVersionId,
        deletedAt: null,
      },
      data: { currentVersionId: target.id, updatedBy: this.#actor(), version: { increment: 1 } },
    });
    if (changed.count !== 1)
      throw new DomainError(
        'VERBIS_SCRIPT_INVALID_TRANSITION',
        'Release head changed concurrently',
      );
    await this.audit.record(tx, {
      action: 'script.version.rolledBack',
      target: { type: 'Script', id: scriptId },
      before: { currentVersionId: expectedCurrentVersionId },
      after: { currentVersionId: target.id },
    });
    await this.outbox.record(tx, {
      type: 'verbis.scripts.version.rolledBack.v1',
      aggregateType: 'Script',
      aggregateId: scriptId,
      payload: { scriptId, versionId: target.id, number: targetNumber },
    });
    return { currentVersionId: target.id, number: targetNumber };
  }

  async retire(scriptId: string, number: number) {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const version = await this.#lock(tx, scriptId, number);
    await this.#authorizeScript(tx, scriptId, 'publish', version);
    const pins = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM assignments
       WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
         AND (pinned_version_id = ${version.id}::uuid OR coalesce(ab_test::text, '') LIKE ${`%${version.id}%`})
       ORDER BY id`;
    if (pins.length > 0) {
      throw new DomainError(
        'VERBIS_SCRIPT_VERSION_IN_USE',
        'Unpin the version from these assignments first',
        pins.map((p) => ({ path: `/assignments/${p.id}`, message: 'pins this version' })),
      );
    }
    const dto = await this.#transition(tx, scriptId, version, 'retire', {
      retiredAt: new Date(),
      retiredBy: this.#actor(),
    });
    await this.#refreshCurrentVersion(tx, tenantId, scriptId);
    return dto;
  }

  async listReviews(scriptId: string, number: number) {
    const tx = this.db.current();
    await this.#authorizeRead(tx, scriptId);
    const row = await this.repository.findVersion(tx, this.db.tenantId(), scriptId, number);
    if (row === null) throw new NotFoundError('Script version');
    const rows = await tx.scriptVersionReview.findMany({
      where: { tenantId: this.db.tenantId(), scriptVersionId: row.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      round: r.round,
      reviewer: r.reviewer,
      decision: r.decision as Review['decision'],
      comment: r.comment,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** JSON Patch (machine) + semantic summary (human) between two versions of one script. */
  async diff(scriptId: string, fromNumber: number, toNumber: number) {
    const tx = this.db.current();
    await this.#authorizeRead(tx, scriptId);
    const tenantId = this.db.tenantId();
    const [from, to] = await Promise.all([
      this.repository.findVersion(tx, tenantId, scriptId, fromNumber),
      this.repository.findVersion(tx, tenantId, scriptId, toNumber),
    ]);
    if (from === null || to === null) throw new NotFoundError('Script version');
    const [a, b] = await Promise.all([decodeDocument(from), decodeDocument(to)]);
    const summary = summarizeDiff(a, b);
    return {
      from: { number: from.number, semver: from.semver, checksum: from.checksum },
      to: { number: to.number, semver: to.semver, checksum: to.checksum },
      patch: jsonPatch(a, b),
      summary,
    };
  }

  /**
   * Three-way structural merge preview (DIFFERENTIATORS C3) of three existing versions of one
   * script. Nothing is stored: the designer resolves conflicts and saves the result as a normal new
   * version, which goes through the usual validation, review and audit.
   */
  async mergePreview(scriptId: string, input: { base: number; ours: number; theirs: number }) {
    const tx = this.db.current();
    await this.#authorizeRead(tx, scriptId);
    const tenantId = this.db.tenantId();
    const rows = await Promise.all(
      [input.base, input.ours, input.theirs].map((n) =>
        this.repository.findVersion(tx, tenantId, scriptId, n),
      ),
    );
    const docs: ScriptDocument[] = [];
    for (const row of rows) {
      if (row === null) throw new NotFoundError('Script version');
      const parsed = ScriptDocumentSchema.safeParse(await decodeDocument(row));
      if (!parsed.success) throw new DomainError('VERBIS_SCRIPT_DOCUMENT_INVALID');
      docs.push(parsed.data);
    }
    const [base, ours, theirs] = docs;
    if (!base || !ours || !theirs) throw new NotFoundError('Script version');
    const result = mergeDocuments(base, ours, theirs);
    return {
      base: input.base,
      ours: input.ours,
      theirs: input.theirs,
      conflicts: result.conflicts,
      issues: result.issues,
      document: result.document,
    };
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  async #authorizeRead(tx: TransactionClient, scriptId: string) {
    const campaigns = await tx.assignment.findMany({
      where: { tenantId: this.db.tenantId(), scriptId, deletedAt: null },
      select: { campaignId: true },
    });
    this.authz.authorize(
      'read',
      asSubject('Script', { id: scriptId, campaignIds: campaigns.map((c) => c.campaignId) }),
    );
  }
  async #lock(tx: TransactionClient, scriptId: string, number: number): Promise<LockedVersion> {
    await this.leases.assertWritable(this.db.tenantId(), scriptId, number);
    const rows = await tx.$queryRaw<LockedVersion[]>`
      SELECT id, number, state::text AS state, semver, checksum, review_round AS "reviewRound",
             created_by AS "createdBy", updated_by AS "updatedBy", submitted_by AS "submittedBy", branch, coalesce(source->'collaborationAuthors','[]'::jsonb) AS contributors
        FROM script_versions
       WHERE tenant_id = ${this.db.tenantId()}::uuid AND script_id = ${scriptId}::uuid
         AND number = ${number} AND deleted_at IS NULL
       FOR UPDATE`;
    const row = rows[0];
    if (row === undefined) throw new NotFoundError('Script version');
    return { ...row, reviewRound: toInt(row.reviewRound) };
  }

  #authors(version: LockedVersion): string[] {
    return authorIdsOf({
      createdBy: version.createdBy,
      updatedBy: version.updatedBy,
      contributors: [
        ...version.contributors,
        ...(version.submittedBy === null ? [] : [version.submittedBy]),
      ],
    });
  }

  async #authorizeScript(
    tx: TransactionClient,
    scriptId: string,
    action: 'read' | 'update' | 'approve' | 'publish',
    version: LockedVersion,
  ) {
    const campaigns = await tx.assignment.findMany({
      where: { tenantId: this.db.tenantId(), scriptId, deletedAt: null },
      select: { campaignId: true },
      distinct: ['campaignId'],
    });
    this.authz.authorize(
      action,
      asSubject('Script', {
        id: scriptId,
        campaignIds: campaigns.map((c) => c.campaignId),
        authorIds: this.#authors(version),
      }),
    );
  }

  async #policy(tx: TransactionClient, scriptId: string): Promise<ApprovalPolicy> {
    const script = await tx.script.findFirst({
      where: { id: scriptId, tenantId: this.db.tenantId() },
      select: { approvalPolicy: true },
    });
    const tenant = await tx.tenant.findFirst({
      where: { id: this.db.tenantId() },
      select: { settings: true },
    });
    const tenantPolicy = ((tenant?.settings ?? {}) as { authoring?: { approval?: unknown } })
      .authoring?.approval;
    for (const candidate of [script?.approvalPolicy, tenantPolicy]) {
      if (candidate === null || candidate === undefined) continue;
      const parsed = ApprovalPolicySchema.safeParse(candidate);
      // A malformed policy must not weaken approval: fall back to the strict default.
      return parsed.success ? parsed.data : DEFAULT_APPROVAL_POLICY;
    }
    return DEFAULT_APPROVAL_POLICY;
  }

  async #reviews(tx: TransactionClient, versionId: string): Promise<Review[]> {
    const rows = await tx.scriptVersionReview.findMany({
      where: { tenantId: this.db.tenantId(), scriptVersionId: versionId },
      select: { reviewer: true, round: true, decision: true },
    });
    return rows.map((r) => ({
      reviewer: r.reviewer,
      round: r.round,
      decision: r.decision as Review['decision'],
    }));
  }

  async #transition(
    tx: TransactionClient,
    scriptId: string,
    version: LockedVersion,
    action: LifecycleAction,
    data: Prisma.ScriptVersionUpdateManyMutationInput,
    reason?: string,
  ) {
    const to = nextState(version.state, action);
    if (to === undefined) {
      throw new DomainError(
        'VERBIS_SCRIPT_INVALID_TRANSITION',
        `cannot ${action} a ${version.state} version`,
      );
    }
    const tenantId = this.db.tenantId();
    const updated = await tx.scriptVersion.updateMany({
      where: { id: version.id, tenantId, state: version.state },
      // Lifecycle actors are recorded in reviews/audit; updatedBy tracks content authorship for SoD.
      data: { ...data, state: to, version: { increment: 1 } },
    });
    if (updated.count !== 1)
      throw new DomainError('VERBIS_SCRIPT_INVALID_TRANSITION', 'the version changed concurrently');
    const row = await this.#summary(tx, version.id);
    const dto = toVersionSummaryDto(row);
    const campaigns = await tx.assignment.findMany({
      where: { tenantId, scriptId, deletedAt: null },
      select: { campaignId: true },
      distinct: ['campaignId'],
    });
    await this.audit.record(tx, {
      action: `script.version.${VERSION_EVENT[action]}`,
      target: {
        type: 'ScriptVersion',
        id: version.id,
        name: `${scriptId}#${String(version.number)}`,
      },
      ...(reason === undefined ? {} : { reason }),
      before: { state: version.state },
      after: { state: to, semver: dto.semver, checksum: dto.checksum },
    });
    await this.outbox.record(tx, {
      type: `verbis.scripts.version.${VERSION_EVENT[action]}.v1`,
      aggregateType: 'ScriptVersion',
      aggregateId: version.id,
      payload: {
        scriptId,
        versionId: version.id,
        number: version.number,
        from: version.state,
        to,
        semver: dto.semver,
        checksum: dto.checksum,
        campaignIds: campaigns.map((c) => c.campaignId),
      },
    });
    return dto;
  }

  async #summary(tx: TransactionClient, versionId: string) {
    const row = await tx.scriptVersion.findFirst({
      where: { id: versionId, tenantId: this.db.tenantId() },
      select: this.repository.summarySelect,
    });
    if (row === null) throw new NotFoundError('Script version');
    return row;
  }

  /** `scripts.current_version_id` = highest published version number (or null). */
  async #refreshCurrentVersion(tx: TransactionClient, tenantId: string, scriptId: string) {
    const latest = await tx.scriptVersion.findFirst({
      where: { tenantId, scriptId, state: 'published', deletedAt: null },
      orderBy: { number: 'desc' },
      select: { id: true },
    });
    await tx.script.updateMany({
      where: { id: scriptId, tenantId },
      data: { currentVersionId: latest?.id ?? null, updatedBy: this.#actor() },
    });
  }

  #actor(): string {
    const principal = requestContext.require().principal;
    if (principal === undefined) throw new Error('No principal');
    return actorRef(principal);
  }
}
