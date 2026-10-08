import { expect, it, vi } from 'vitest';

import { createAbility } from '@verbis/authz';
import { ScriptDocumentSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { requestContext } from '../../common/context/request-context.js';

import { TeamService } from './team.service.js';

import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AbilityFactory } from '../authz/ability.factory.js';
import type { AuthzService } from '../authz/authz.service.js';

const tenant = '01990000-0000-7000-8000-000000000001',
  id = '01990000-0000-7000-8000-000000000002',
  script = '01990000-0000-7000-8000-000000000003',
  versionId = '01990000-0000-7000-8000-000000000004';
const run = <T>(fn: () => T, authz = true) =>
  requestContext.run(
    {
      requestId: 'synthetic',
      correlationId: 'synthetic',
      ip: '',
      userAgent: 'test',
      principal: { type: 'user', id, tenantId: tenant, scopes: [] },
      ...(authz
        ? {
            authz: {
              ability: createAbility([{ action: 'manage', subject: 'all' }]),
              roles: [],
              rules: [],
              separationOfDuties: true,
            },
          }
        : {}),
    },
    fn,
  );
function fixture() {
  const version = {
    id: versionId,
    scriptId: script,
    number: 1,
    deletedAt: null,
    script: { deletedAt: null as Date | null, approvalPolicy: {} },
    source: { collaborationAuthors: ['user:synthetic-other'] },
    createdBy: 'user:synthetic-other',
    updatedBy: 'user:synthetic-other',
    documentEncoding: 'json',
    document: ScriptDocumentSchema.parse(minimalScript()),
    documentCompressed: null,
    reviewRound: 1,
    submittedAt: null,
    createdAt: new Date('2026-10-03T12:00:00Z'),
  };
  const thread = {
    id: versionId,
    scriptVersionId: versionId,
    nodeId: 'script',
    resolved: false,
    messages: [
      {
        id,
        author: `user:${id}`,
        text: 'Synthetic mention',
        mentions: [id],
        createdAt: '2026-10-03T12:00:00Z',
      },
    ],
    version: 1,
    updatedAt: new Date('2026-10-03T13:00:00Z'),
  };
  const tx = {
    scriptVersion: {
      findFirstOrThrow: vi.fn().mockResolvedValue(version),
      findFirst: vi.fn().mockResolvedValue(version),
      findMany: vi.fn().mockResolvedValue([version]),
    },
    assignment: { findMany: vi.fn().mockResolvedValue([{ scriptId: script, campaignId: tenant }]) },
    tenant: { findFirst: vi.fn().mockResolvedValue({ settings: {} }) },
    user: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([{ id, displayName: 'Synthetic member' }]),
    },
    scriptSuggestion: { findMany: vi.fn().mockResolvedValue([]) },
    authoringThread: {
      findFirst: vi.fn().mockResolvedValue(thread),
      findFirstOrThrow: vi.fn().mockResolvedValue(thread),
      findMany: vi.fn().mockResolvedValue([thread]),
      create: vi
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ ...thread, ...data }),
        ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    scriptVersionReview: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const abilities = {
      forPrincipal: vi
        .fn()
        .mockResolvedValue({ ability: createAbility([{ action: 'manage', subject: 'all' }]) }),
    },
    audit = { record: vi.fn().mockResolvedValue(undefined) },
    authz = { authorize: vi.fn() };
  const service = new TeamService(
    abilities as unknown as AbilityFactory,
    { tenantId: () => tenant, current: () => tx } as unknown as TenantDb,
    audit as unknown as AuditService,
    authz as unknown as AuthzService,
  );
  return { service, tx, version, thread, abilities, audit, authz };
}
it('returns only members who can read the script and exposes validated threads', async () => {
  const f = fixture();
  expect(await f.service.members(script, 1)).toEqual([{ id, name: 'Synthetic member' }]);
  f.abilities.forPrincipal.mockResolvedValue({ ability: createAbility([]) });
  expect(await f.service.members(script, 1)).toEqual([]);
  expect(await f.service.threads(script, 1)).toHaveLength(1);
  expect(f.authz.authorize).toHaveBeenCalledWith(
    'read',
    expect.objectContaining({ campaignIds: [tenant], authorIds: ['synthetic-other'] }),
  );
});
it('rejects missing or deleted script versions before exposing team data', async () => {
  const f = fixture();
  f.tx.scriptVersion.findFirst.mockResolvedValueOnce(null);
  await expect(f.service.members(script, 1)).rejects.toThrow();
  f.version.script.deletedAt = new Date();
  await expect(f.service.threads(script, 1)).rejects.toThrow();
  expect(f.tx.user.findMany).not.toHaveBeenCalled();
});
it('creates a node comment with deduplicated, authorized mentions and an actor reference', async () => {
  const f = fixture();
  const result = await run(() =>
    f.service.comment(script, 1, {
      nodeId: 'btn-next',
      text: 'Synthetic comment',
      mentions: [id, id],
    }),
  );
  expect(result.messages[0]).toMatchObject({
    author: `user:${id}`,
    text: 'Synthetic comment',
    mentions: [id],
  });
  expect(f.audit.record).toHaveBeenCalledWith(
    f.tx,
    expect.objectContaining({
      action: 'script.comment.created',
      metadata: expect.objectContaining({ mentionCount: 1, nodeId: 'btn-next' }) as unknown,
    }),
  );
});
it.each([
  'missingNode',
  'inactiveMention',
  'deniedMention',
  'missingThread',
  'fullThread',
  'wrongNode',
  'staleThread',
] as const)('rejects unsafe comment %s before appending a message', async (reason) => {
  const f = fixture();
  let nodeId = 'script';
  if (reason === 'missingNode') nodeId = 'missing';
  if (reason === 'inactiveMention') f.tx.user.count.mockResolvedValue(0);
  if (reason === 'deniedMention')
    f.abilities.forPrincipal.mockResolvedValue({ ability: createAbility([]) });
  if (reason === 'missingThread') f.tx.authoringThread.findFirst.mockResolvedValue(null);
  if (reason === 'fullThread')
    f.thread.messages = Array.from({ length: 500 }, () => f.thread.messages[0]!);
  if (reason === 'wrongNode') nodeId = 'btn-next';
  if (reason === 'staleThread') f.tx.authoringThread.updateMany.mockResolvedValue({ count: 0 });
  await expect(
    run(() =>
      f.service.comment(script, 1, { nodeId, text: 'Synthetic', mentions: [id] }, versionId),
    ),
  ).rejects.toThrow();
  expect(f.tx.authoringThread.create).not.toHaveBeenCalled();
  expect(f.audit.record).not.toHaveBeenCalled();
});
it('replies on the existing node, enforces resolution versions and refuses missing reply threads', async () => {
  const f = fixture();
  await run(() =>
    f.service.reply(script, 1, versionId, { text: 'Synthetic reply', mentions: [id] }),
  );
  expect(f.tx.authoringThread.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: versionId, tenantId: tenant, version: 1 },
      data: expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ text: 'Synthetic reply' }) as unknown,
        ]) as unknown,
      }) as unknown,
    }),
  );
  await f.service.resolve(script, 1, versionId, { version: 1, resolved: true });
  expect(f.audit.record).toHaveBeenCalledWith(
    f.tx,
    expect.objectContaining({ action: 'script.comment.resolved' }),
  );
  f.tx.authoringThread.updateMany.mockResolvedValue({ count: 0 });
  await expect(
    f.service.resolve(script, 1, versionId, { version: 1, resolved: true }),
  ).rejects.toThrow();
  f.tx.authoringThread.findFirst.mockResolvedValue(null);
  await expect(
    f.service.reply(script, 1, versionId, { text: 'Synthetic', mentions: [] }),
  ).rejects.toThrow();
});
it('returns eligible reviews and readable mentions in date order, respecting authorization context', async () => {
  const f = fixture();
  const notices = await run(() => f.service.notifications());
  expect(notices.map((n) => n.kind)).toEqual(['mention', 'review']);
  expect(await run(() => f.service.notifications(), false)).toEqual([]);
  f.authz.authorize.mockImplementation(() => {
    throw new Error('Denied');
  });
  expect((await run(() => f.service.notifications())).map((n) => n.kind)).toEqual(['review']);
});
it('skips deleted mention targets, unmentioned threads and authors reviewing their own work', async () => {
  const f = fixture();
  f.version.source.collaborationAuthors = [`user:${id}`];
  f.tx.scriptVersion.findMany.mockResolvedValueOnce([f.version]).mockResolvedValueOnce([]);
  expect(await run(() => f.service.notifications())).toEqual([]);
  f.thread.messages[0]!.mentions = [];
  expect(await run(() => f.service.notifications())).toEqual([]);
});
it('loads notifications in a bounded number of queries for 100 versions and 200 mentions', async () => {
  const f = fixture();
  f.tx.scriptVersion.findMany.mockResolvedValue(Array.from({ length: 100 }, () => f.version));
  f.tx.authoringThread.findMany.mockResolvedValue(Array.from({ length: 200 }, () => f.thread));
  await run(() => f.service.notifications());
  expect(f.tx.assignment.findMany.mock.calls.length).toBeLessThanOrEqual(1);
  expect(f.tx.scriptVersionReview.findMany.mock.calls.length).toBeLessThanOrEqual(1);
  expect(f.tx.scriptVersion.findFirst).not.toHaveBeenCalled();
});
