import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { ScriptDocumentSchema } from '@verbis/script-schema';
import { AgentFeedbackInputSchema, ThreadSchema } from '@verbis/shared-types';

import { currentActor } from '../../common/actor.js';
import { uuidv7 } from '../../common/crypto/uuid.js';
import { NotFoundError, VersionMismatchError } from '../../common/errors/domain-errors.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';

import type { EngineSession } from './runtime-engine.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

const THREAD_LIMIT = 500;

/**
 * Agent → designer feedback (DIFFERENTIATORS C5). An agent flags a script page with a fixed reason;
 * it lands as a comment on that page in the session's script version. No free text and no session
 * reference is stored, so a comment can never carry or lead back to customer data. Feedback on a
 * page collects in one open thread instead of flooding designers.
 */
@Injectable()
export class AgentFeedbackService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async submit(session: EngineSession, input: z.infer<typeof AgentFeedbackInputSchema>) {
    const document = ScriptDocumentSchema.parse(session.scriptVersion.document);
    const page = document.pages.find((candidate) => candidate.id === input.pageId);
    if (!page) throw new NotFoundError('Page');
    const nodeId = page.layout.id,
      tx = this.db.current(),
      tenantId = this.db.tenantId();
    const message = {
      id: uuidv7(),
      author: currentActor(),
      text: '',
      mentions: [],
      createdAt: new Date().toISOString(),
      feedback: { reason: input.reason },
    };
    const open = await tx.authoringThread.findMany({
      where: { tenantId, scriptVersionId: session.scriptVersionId, nodeId, resolved: false },
      orderBy: { createdAt: 'asc' },
    });
    const collecting = open
      .map((row) => ThreadSchema.parse(row))
      .find(
        (thread) =>
          thread.messages[0]?.feedback !== undefined && thread.messages.length < THREAD_LIMIT,
      );
    let threadId: string;
    if (collecting) {
      const updated = await tx.authoringThread.updateMany({
        where: { id: collecting.id, tenantId, version: collecting.version },
        data: {
          messages: [...collecting.messages, message] as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new VersionMismatchError();
      threadId = collecting.id;
    } else {
      threadId = uuidv7();
      await tx.authoringThread.create({
        data: {
          id: threadId,
          tenantId,
          scriptVersionId: session.scriptVersionId,
          nodeId,
          messages: [message] as Prisma.InputJsonValue,
        },
      });
    }
    await this.audit.record(tx, {
      action: 'runtime.desktop.feedbackSubmitted',
      target: { type: 'Session', id: session.id },
      metadata: { reason: input.reason, pageId: input.pageId },
    });
    await this.audit.record(tx, {
      action: 'script.comment.created',
      target: { type: 'ScriptVersion', id: session.scriptVersionId },
      metadata: { threadId, nodeId, mentionCount: 0, source: 'agentFeedback' },
    });
    return { recorded: true as const, threadId };
  }
}
