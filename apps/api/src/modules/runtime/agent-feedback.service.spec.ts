import { describe, expect, it, vi } from 'vitest';

import { ScriptDocumentSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';
import { ThreadSchema } from '@verbis/shared-types';

import { requestContext } from '../../common/context/request-context.js';
import { NotFoundError, VersionMismatchError } from '../../common/errors/domain-errors.js';

import { AgentFeedbackService } from './agent-feedback.service.js';

import type { EngineSession } from './runtime-engine.service.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { AuditService } from '../audit/audit.service.js';

const tenant = '01928f3a-0000-7000-8000-000000000003',
  agent = '01928f3a-0000-7000-8000-000000000002',
  sessionId = '01928f3a-0000-7000-8000-000000000001',
  versionId = '01928f3a-0000-7000-8000-000000000009',
  existing = '01928f3a-0000-7000-8000-00000000000a';

function fixture(threads: unknown[] = [], updated = 1) {
  const tx = {
    authoringThread: {
      findMany: vi.fn().mockResolvedValue(threads),
      create: vi
        .fn<(args: { data: Record<string, unknown> }) => Promise<unknown>>()
        .mockResolvedValue({}),
      updateMany: vi
        .fn<
          (args: {
            where: Record<string, unknown>;
            data: { messages: unknown[] };
          }) => Promise<{ count: number }>
        >()
        .mockResolvedValue({ count: updated }),
    },
  };
  const audit = {
    record: vi
      .fn<
        (
          tx: unknown,
          event: { action: string; target?: unknown; metadata?: unknown },
        ) => Promise<void>
      >()
      .mockResolvedValue(undefined),
  };
  const service = new AgentFeedbackService(
    { current: () => tx, tenantId: () => tenant } as unknown as TenantDb,
    audit as unknown as AuditService,
  );
  const session = {
    id: sessionId,
    scriptVersionId: versionId,
    scriptVersion: { document: ScriptDocumentSchema.parse(minimalScript()) },
  } as unknown as EngineSession;
  const run = <T>(work: () => T) =>
    requestContext.run(
      {
        requestId: sessionId,
        correlationId: sessionId,
        ip: '',
        userAgent: 'synthetic',
        principal: { type: 'user', id: agent, tenantId: tenant, scopes: [] },
      },
      work,
    );
  return { service, tx, audit, session, run };
}
const thread = (first: Record<string, unknown>, messages = 1) => ({
  id: existing,
  nodeId: 'home-root',
  resolved: false,
  version: 3,
  messages: Array.from({ length: messages }, (_, i) => ({
    id: `01928f3a-0000-7000-8000-${String(100 + i).padStart(12, '0')}`,
    author: agent,
    text: '',
    mentions: [],
    createdAt: '2026-10-07T09:00:00.000Z',
    ...(i === 0 ? first : { feedback: { reason: 'confusing' } }),
  })),
});

describe('AgentFeedbackService', () => {
  it('opens a feedback thread on the page with a fixed reason, no text and no session reference', async () => {
    const f = fixture();
    const result = await f.run(() =>
      f.service.submit(f.session, { pageId: 'home', reason: 'confusing' }),
    );
    expect(result.recorded).toBe(true);
    const data = f.tx.authoringThread.create.mock.calls[0]?.[0].data;
    expect(data).toMatchObject({
      tenantId: tenant,
      scriptVersionId: versionId,
      nodeId: 'home-root',
    });
    const parsed = ThreadSchema.parse({ ...data, resolved: false, version: 1 });
    expect(parsed.messages[0]).toMatchObject({
      author: `user:${agent}`,
      text: '',
      feedback: { reason: 'confusing' },
    });
    expect(JSON.stringify(data)).not.toContain(sessionId);
    expect(f.audit.record.mock.calls.map((call) => call[1].action)).toEqual([
      'runtime.desktop.feedbackSubmitted',
      'script.comment.created',
    ]);
    expect(f.audit.record.mock.calls[1]?.[1]).toMatchObject({
      target: { type: 'ScriptVersion', id: versionId },
      metadata: { threadId: result.threadId, nodeId: 'home-root', source: 'agentFeedback' },
    });
    // Both events are written in the same transaction as the comment.
    expect(f.audit.record.mock.calls.every((call) => call[0] === f.tx)).toBe(true);
  });

  it('collects further feedback on the page into the open feedback thread', async () => {
    const f = fixture([thread({ feedback: { reason: 'tooLong' } })]);
    const result = await f.run(() =>
      f.service.submit(f.session, { pageId: 'home', reason: 'incorrect' }),
    );
    expect(result.threadId).toBe(existing);
    expect(f.tx.authoringThread.create).not.toHaveBeenCalled();
    const update = f.tx.authoringThread.updateMany.mock.calls[0]?.[0];
    expect(update?.where).toMatchObject({ id: existing, version: 3 });
    expect(update?.data.messages).toHaveLength(2);
  });

  it('never appends to a designer conversation or a full thread', async () => {
    const f = fixture([
      thread({ text: 'Designer note' }),
      thread({ feedback: { reason: 'tooLong' } }, 500),
    ]);
    await f.run(() => f.service.submit(f.session, { pageId: 'home', reason: 'missingStep' }));
    expect(f.tx.authoringThread.updateMany).not.toHaveBeenCalled();
    expect(f.tx.authoringThread.create).toHaveBeenCalledOnce();
  });

  it('fails on a concurrent update instead of losing feedback', async () => {
    const f = fixture([thread({ feedback: { reason: 'tooLong' } })], 0);
    await expect(
      f.run(() => f.service.submit(f.session, { pageId: 'home', reason: 'confusing' })),
    ).rejects.toBeInstanceOf(VersionMismatchError);
    expect(f.audit.record).not.toHaveBeenCalled();
  });

  it('rejects a page outside the session’s script version without writing anything', async () => {
    const f = fixture();
    await expect(
      f.run(() => f.service.submit(f.session, { pageId: 'not-a-page', reason: 'confusing' })),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(f.tx.authoringThread.create).not.toHaveBeenCalled();
    expect(f.audit.record).not.toHaveBeenCalled();
  });
});
