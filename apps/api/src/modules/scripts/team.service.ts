import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { asSubject, authorIdsOf } from '@verbis/authz';
import { findNode } from '@verbis/script-schema';
import type { ScriptDocument } from '@verbis/script-schema';
import { CommentInputSchema, ThreadSchema, type CommentReplySchema } from '@verbis/shared-types';

import { currentActor } from '../../common/actor.js';
import { requestContext } from '../../common/context/request-context.js';
import { uuidv7 } from '../../common/crypto/uuid.js';
import {
  DomainError,
  NotFoundError,
  VersionMismatchError,
} from '../../common/errors/domain-errors.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { AbilityFactory } from '../authz/ability.factory.js';
import { AuthzService } from '../authz/authz.service.js';

import { decodeDocument } from './document-storage.js';
import { ApprovalPolicySchema, DEFAULT_APPROVAL_POLICY, eligibility } from './domain/lifecycle.js';

import type { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class TeamService {
  constructor(
    @Inject(AbilityFactory) private readonly abilities: AbilityFactory,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}
  private contributors(source: unknown): string[] {
    const value = z
      .object({ collaborationAuthors: z.array(z.string()).default([]) })
      .safeParse(source ?? {});
    return value.success ? value.data.collaborationAuthors : [];
  }
  async authorize(scriptId: string, number: number, action: 'read' | 'update' = 'read') {
    const tx = this.db.current(),
      tenantId = this.db.tenantId();
    const version = await tx.scriptVersion.findFirst({
      where: { tenantId, scriptId, number, deletedAt: null },
      select: {
        id: true,
        scriptId: true,
        number: true,
        checksum: true,
        reviewRound: true,
        submittedAt: true,
        createdAt: true,
        state: true,
        version: true,
        createdBy: true,
        updatedBy: true,
        source: true,
        script: { select: { deletedAt: true, approvalPolicy: true } },
      },
    });
    if (!version || version.script.deletedAt) throw new NotFoundError('Script version');
    const campaigns = await tx.assignment.findMany({
      where: { tenantId, scriptId, deletedAt: null },
      select: { campaignId: true },
    });
    this.authz.authorize(
      action,
      asSubject('Script', {
        id: scriptId,
        campaignIds: campaigns.map((c) => c.campaignId),
        authorIds: authorIdsOf({ ...version, contributors: this.contributors(version.source) }),
      }),
    );
    return version;
  }
  async members(scriptId: string, number: number) {
    const version = await this.authorize(scriptId, number),
      tx = this.db.current(),
      tenantId = this.db.tenantId();
    const tenant = await tx.tenant.findFirst({
      where: { id: tenantId },
      select: { settings: true },
    });
    const campaigns = await tx.assignment.findMany({
      where: { tenantId, scriptId, deletedAt: null },
      select: { campaignId: true },
    });
    const subject = asSubject('Script', {
      id: scriptId,
      campaignIds: campaigns.map((c) => c.campaignId),
    });
    const users = await tx.user.findMany({
      where: { tenantId, status: 'active', deletedAt: null },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
      take: 100,
    });
    const result: { id: string; name: string }[] = [];
    for (const user of users) {
      const resolved = await this.abilities.forPrincipal(
        tx,
        { type: 'user', id: user.id, tenantId, scopes: [] },
        tenant?.settings,
      );
      if (resolved?.ability.can('read', subject))
        result.push({ id: user.id, name: user.displayName });
    }
    await this.audit.record(tx, {
      action: 'script.team.membersRead',
      target: { type: 'ScriptVersion', id: version.id },
      metadata: { count: result.length },
    });
    return result;
  }
  async threads(scriptId: string, number: number) {
    const v = await this.authorize(scriptId, number);
    const rows = await this.db.current().authoringThread.findMany({
      where: { tenantId: this.db.tenantId(), scriptVersionId: v.id },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return rows.map((row) => ThreadSchema.parse(row));
  }
  async comment(
    scriptId: string,
    number: number,
    input: z.infer<typeof CommentInputSchema>,
    threadId?: string,
  ) {
    const version = await this.authorize(scriptId, number),
      tx = this.db.current(),
      tenantId = this.db.tenantId();
    const stored = await tx.scriptVersion.findFirstOrThrow({
      where: { id: version.id, tenantId },
      select: { document: true, documentEncoding: true, documentCompressed: true },
    });
    const document = (await decodeDocument(stored)) as ScriptDocument;
    if (input.nodeId !== 'script' && !findNode(document, input.nodeId))
      throw new NotFoundError('Node');
    const mentions = [...new Set(input.mentions)];
    if (
      (await tx.user.count({
        where: { tenantId, id: { in: mentions }, status: 'active', deletedAt: null },
      })) !== mentions.length
    )
      throw new DomainError('VERBIS_VALIDATION_FAILED', 'Invalid mention recipient');
    const campaigns = await tx.assignment.findMany({
      where: { tenantId, scriptId, deletedAt: null },
      select: { campaignId: true },
    });
    const tenant = await tx.tenant.findFirst({
      where: { id: tenantId },
      select: { settings: true },
    });
    for (const id of mentions) {
      const recipient = await this.abilities.forPrincipal(
        tx,
        { type: 'user', id, tenantId, scopes: [] },
        tenant?.settings,
      );
      if (
        !recipient?.ability.can(
          'read',
          asSubject('Script', { id: scriptId, campaignIds: campaigns.map((c) => c.campaignId) }),
        )
      )
        throw new DomainError(
          'VERBIS_VALIDATION_FAILED',
          'Mention recipient cannot read this script',
        );
    }
    const message = {
      id: uuidv7(),
      author: currentActor(),
      text: input.text,
      mentions,
      createdAt: new Date().toISOString(),
    };
    let row;
    if (threadId) {
      const current = await tx.authoringThread.findFirst({
        where: { id: threadId, tenantId, scriptVersionId: version.id },
      });
      if (!current) throw new NotFoundError('Comment thread');
      const parsed = ThreadSchema.parse(current);
      if (parsed.messages.length >= 500)
        throw new DomainError('VERBIS_VALIDATION_FAILED', 'Comment thread is full');
      if (parsed.nodeId !== input.nodeId)
        throw new DomainError('VERBIS_VALIDATION_FAILED', 'Comment node mismatch');
      const updated = await tx.authoringThread.updateMany({
        where: { id: threadId, tenantId, version: current.version },
        data: {
          messages: [...parsed.messages, message] as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new VersionMismatchError();
      row = await tx.authoringThread.findFirstOrThrow({ where: { id: threadId, tenantId } });
    } else
      row = await tx.authoringThread.create({
        data: {
          id: uuidv7(),
          tenantId,
          scriptVersionId: version.id,
          nodeId: input.nodeId,
          messages: [message] as Prisma.InputJsonValue,
        },
      });
    await this.audit.record(tx, {
      action: 'script.comment.created',
      target: { type: 'ScriptVersion', id: version.id },
      metadata: { threadId: row.id, nodeId: input.nodeId, mentionCount: mentions.length },
    });
    return ThreadSchema.parse(row);
  }
  async reply(
    scriptId: string,
    number: number,
    id: string,
    input: z.infer<typeof CommentReplySchema>,
  ) {
    const version = await this.authorize(scriptId, number);
    const row = await this.db.current().authoringThread.findFirst({
      where: { id, tenantId: this.db.tenantId(), scriptVersionId: version.id },
    });
    if (!row) throw new NotFoundError('Comment thread');
    return this.comment(scriptId, number, { ...input, nodeId: row.nodeId }, id);
  }
  async resolve(
    scriptId: string,
    number: number,
    id: string,
    input: { version: number; resolved: boolean },
  ) {
    const v = await this.authorize(scriptId, number),
      tx = this.db.current(),
      tenantId = this.db.tenantId();
    const updated = await tx.authoringThread.updateMany({
      where: { id, tenantId, scriptVersionId: v.id, version: input.version },
      data: { resolved: input.resolved, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new VersionMismatchError();
    await this.audit.record(tx, {
      action: 'script.comment.resolved',
      target: { type: 'ScriptVersion', id: v.id },
      metadata: { threadId: id, resolved: input.resolved },
    });
    return ThreadSchema.parse(
      await tx.authoringThread.findFirstOrThrow({ where: { id, tenantId } }),
    );
  }
  async notifications() {
    const tx = this.db.current(),
      tenantId = this.db.tenantId(),
      ctx = requestContext.require();
    const userId = ctx.principal?.id ?? '',
      authz = ctx.authz;
    if (!authz) return [];
    const rows = await tx.scriptVersion.findMany({
      where: { tenantId, state: 'in_review', deletedAt: null, script: { deletedAt: null } },
      select: {
        id: true,
        scriptId: true,
        number: true,
        checksum: true,
        reviewRound: true,
        submittedAt: true,
        createdAt: true,
        state: true,
        version: true,
        createdBy: true,
        updatedBy: true,
        source: true,
        script: { select: { deletedAt: true, approvalPolicy: true } },
      },
      take: 100,
      orderBy: { submittedAt: 'desc' },
    });
    const tenant = await tx.tenant.findFirst({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = tenant?.settings as { authoring?: { approval?: unknown } } | null;
    const notifications: {
      id: string;
      scriptId: string;
      number: number;
      kind: 'review' | 'mention' | 'suggestion';
      createdAt: string;
      threadId?: string;
    }[] = [];
    const threads = await tx.authoringThread.findMany({
      where: { tenantId, updatedAt: { gte: new Date(Date.now() - 7 * 86400000) } },
      take: 200,
      orderBy: { updatedAt: 'desc' },
    });
    const mentioned = threads.filter((thread) =>
      ThreadSchema.parse(thread).messages.some((message) => message.mentions.includes(userId)),
    );
    const versions = mentioned.length
      ? await tx.scriptVersion.findMany({
          where: {
            tenantId,
            id: { in: [...new Set(mentioned.map((thread) => thread.scriptVersionId))] },
            deletedAt: null,
            script: { deletedAt: null },
          },
          select: {
            id: true,
            scriptId: true,
            number: true,
            checksum: true,
            reviewRound: true,
            submittedAt: true,
            createdAt: true,
            state: true,
            version: true,
            createdBy: true,
            updatedBy: true,
            source: true,
            script: { select: { deletedAt: true, approvalPolicy: true } },
          },
        })
      : [];
    const campaigns = await tx.assignment.findMany({
      where: {
        tenantId,
        scriptId: { in: [...new Set([...rows, ...versions].map((v) => v.scriptId))] },
        deletedAt: null,
      },
      select: { scriptId: true, campaignId: true },
    });
    const reviews = await tx.scriptVersionReview.findMany({
      where: { tenantId, scriptVersionId: { in: rows.map((v) => v.id) } },
      select: { scriptVersionId: true, reviewer: true, round: true, decision: true },
    });
    const subjectOf = (v: (typeof rows)[number]) =>
      asSubject('Script', {
        id: v.scriptId,
        campaignIds: campaigns.filter((c) => c.scriptId === v.scriptId).map((c) => c.campaignId),
        authorIds: authorIdsOf({ ...v, contributors: this.contributors(v.source) }),
      });
    for (const v of rows) {
      const authors = authorIdsOf({ ...v, contributors: this.contributors(v.source) }),
        subject = subjectOf(v);
      const parsed = ApprovalPolicySchema.safeParse(
        v.script.approvalPolicy ?? settings?.authoring?.approval,
      );
      if (
        authz.ability.can('approve', subject) &&
        eligibility(
          parsed.success ? parsed.data : DEFAULT_APPROVAL_POLICY,
          { id: `user:${userId}`, roles: authz.roles },
          authors,
          reviews
            .filter((r) => r.scriptVersionId === v.id)
            .map((r) => ({
              ...r,
              decision: r.decision as 'approved' | 'rejected' | 'commented',
            })),
          v.reviewRound,
          authz.separationOfDuties,
        ).length === 0
      )
        notifications.push({
          id: `review-${v.id}-${v.reviewRound}`,
          scriptId: v.scriptId,
          number: v.number,
          kind: 'review',
          createdAt: (v.submittedAt ?? v.createdAt).toISOString(),
        });
    }
    for (const thread of threads) {
      const parsed = ThreadSchema.parse(thread);
      if (!parsed.messages.some((m) => m.mentions.includes(userId))) continue;
      const v = versions.find((version) => version.id === thread.scriptVersionId);
      if (!v) continue;
      try {
        this.authz.authorize('read', subjectOf(v));
      } catch {
        continue;
      }
      notifications.push({
        id: `mention-${thread.id}`,
        scriptId: v.scriptId,
        number: v.number,
        kind: 'mention',
        threadId: thread.id,
        createdAt: thread.updatedAt.toISOString(),
      });
    }
    // Open suggestions on drafts the user can change (never one's own).
    const open = await tx.scriptSuggestion.findMany({
      where: {
        tenantId,
        state: 'open',
        createdBy: { not: `user:${userId}` },
        createdAt: { gte: new Date(Date.now() - 14 * 86400000) },
        scriptVersion: { state: 'draft', deletedAt: null, script: { deletedAt: null } },
      },
      select: {
        id: true,
        createdAt: true,
        scriptVersion: {
          select: {
            id: true,
            scriptId: true,
            number: true,
            createdBy: true,
            updatedBy: true,
            source: true,
          },
        },
      },
      take: 100,
      orderBy: { createdAt: 'desc' },
    });
    const suggestionCampaigns = open.length
      ? await tx.assignment.findMany({
          where: {
            tenantId,
            scriptId: { in: [...new Set(open.map((s) => s.scriptVersion.scriptId))] },
            deletedAt: null,
          },
          select: { scriptId: true, campaignId: true },
        })
      : [];
    for (const suggestion of open) {
      const v = suggestion.scriptVersion;
      const subject = asSubject('Script', {
        id: v.scriptId,
        campaignIds: suggestionCampaigns
          .filter((c) => c.scriptId === v.scriptId)
          .map((c) => c.campaignId),
        authorIds: authorIdsOf({ ...v, contributors: this.contributors(v.source) }),
      });
      if (!authz.ability.can('update', subject)) continue;
      notifications.push({
        id: `suggestion-${suggestion.id}`,
        scriptId: v.scriptId,
        number: v.number,
        kind: 'suggestion',
        createdAt: suggestion.createdAt.toISOString(),
      });
    }
    return notifications.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
