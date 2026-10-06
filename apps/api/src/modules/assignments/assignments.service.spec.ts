import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { requestContext, systemContext } from '../../common/context/request-context.js';

import { AssignmentListQuerySchema, CreateAssignmentSchema } from './assignments.dto.js';
import { AssignmentsService } from './assignments.service.js';

import type { AssignmentRow, AssignmentsRepository } from './assignments.repository.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthzService } from '../authz/authz.service.js';
import type { SnapshotRepository } from '../routing/snapshot.repository.js';

function fixture() {
  const tenantId = randomUUID();
  const row: AssignmentRow = {
    id: randomUUID(),
    scriptId: randomUUID(),
    campaignId: randomUUID(),
    priority: 100,
    versionPolicy: 'latestPublished',
    pinnedVersionId: null,
    validFrom: null,
    validTo: null,
    rule: null,
    conditions: {},
    abTest: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  };
  const tx = {
    assignment: { findMany: vi.fn().mockResolvedValue([{ campaignId: row.campaignId }]) },
    campaign: { findMany: vi.fn().mockResolvedValue([{ id: row.campaignId }, { id: 'private' }]) },
  };
  const repository = {
    find: vi.fn<AssignmentsRepository['find']>().mockResolvedValue(row),
    referencesExist: vi
      .fn<AssignmentsRepository['referencesExist']>()
      .mockResolvedValue({ script: true, campaign: true, version: true }),
    create: vi.fn<AssignmentsRepository['create']>().mockResolvedValue(row),
    update: vi.fn<AssignmentsRepository['update']>().mockResolvedValue(row),
    softDelete: vi.fn<AssignmentsRepository['softDelete']>().mockResolvedValue(true),
    list: vi.fn<AssignmentsRepository['list']>().mockResolvedValue([row]),
  };
  const authz = {
    authorize: vi.fn(),
    can: vi
      .fn()
      .mockImplementation((_action: string, subject: { id: string }) => subject.id !== 'private'),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) },
    outbox = { record: vi.fn().mockResolvedValue(undefined) };
  const snapshots = { load: vi.fn().mockResolvedValue(undefined) };
  const service = new AssignmentsService(
    authz as unknown as AuthzService,
    { current: () => tx, tenantId: () => tenantId } as unknown as TenantDb,
    repository as unknown as AssignmentsRepository,
    audit as unknown as AuditService,
    outbox,
    snapshots as unknown as SnapshotRepository,
  );
  const run = <T>(work: () => T) =>
    requestContext.run(
      {
        ...systemContext(randomUUID(), 'synthetic'),
        principal: { type: 'user', id: randomUUID(), tenantId, scopes: [] },
      },
      work,
    );
  const input = CreateAssignmentSchema.parse({
    scriptId: row.scriptId,
    campaignId: row.campaignId,
  });
  return { row, tx, repository, authz, audit, outbox, service, run, input, tenantId };
}
describe('assignment reference and transaction boundaries', () => {
  it('filters lists by readable campaigns and checks explicit campaign access', async () => {
    const f = fixture();
    const query = AssignmentListQuerySchema.parse({ campaignId: f.row.campaignId });
    const page = await f.service.list(query);
    expect(page.data).toHaveLength(1);
    expect(f.repository.list.mock.calls[0]?.[3]).toEqual([f.row.campaignId]);
    expect(f.authz.authorize).toHaveBeenCalledWith(
      'read',
      expect.objectContaining({ id: f.row.campaignId }),
    );
    expect(await f.service.get(f.row.id)).toMatchObject({ id: f.row.id });
  });
  it('audits validated creation and emits an event only after reference checks', async () => {
    const f = fixture();
    expect(await f.run(() => f.service.create(f.input))).toMatchObject({
      id: f.row.id,
      warnings: [],
    });
    expect(f.repository.referencesExist.mock.calls[0]?.[2]).toEqual({
      scriptId: f.row.scriptId,
      campaignId: f.row.campaignId,
      versionIds: [],
    });
    expect(f.authz.authorize).toHaveBeenCalledWith(
      'read',
      expect.objectContaining({ id: f.row.scriptId, campaignIds: [f.row.campaignId] }),
    );
    expect(f.audit.record).toHaveBeenCalledOnce();
    expect(f.outbox.record).toHaveBeenCalledOnce();
  });
  it('checks version pins for both the assignment and all overridden variants', async () => {
    const f = fixture();
    const first = randomUUID(),
      second = randomUUID();
    await f.run(() =>
      f.service.create({
        ...f.input,
        versionPolicy: 'pinned',
        pinnedVersionId: first,
        variants: [
          { key: 'a', weight: 5000, pinnedVersionId: second },
          { key: 'b', weight: 5000 },
        ],
      }),
    );
    expect(f.repository.referencesExist.mock.calls[0]?.[2].versionIds).toEqual([first, second]);
  });
  it.each(['script', 'campaign', 'version'] as const)(
    'rejects missing %s references before any write',
    async (missing) => {
      const f = fixture();
      f.repository.referencesExist.mockResolvedValue({
        script: true,
        campaign: true,
        version: true,
        [missing]: false,
      });
      await expect(f.run(() => f.service.create(f.input))).rejects.toThrow();
      expect(f.repository.create).not.toHaveBeenCalled();
      expect(f.audit.record).not.toHaveBeenCalled();
      expect(f.outbox.record).not.toHaveBeenCalled();
    },
  );
  it.each(['get', 'update', 'delete'] as const)(
    'rejects a missing assignment during %s',
    async (operation) => {
      const f = fixture();
      f.repository.find.mockResolvedValue(null);
      await expect(
        f.run(() =>
          operation === 'get'
            ? f.service.get(f.row.id)
            : operation === 'update'
              ? f.service.update(f.row.id, 1, { priority: 1 })
              : f.service.remove(f.row.id, 1),
        ),
      ).rejects.toThrow();
      expect(f.outbox.record).not.toHaveBeenCalled();
    },
  );
  it.each(['stale', 'concurrent', 'pin missing', 'unexpected pin'] as const)(
    'rejects unsafe updates: %s',
    async (reason) => {
      const f = fixture();
      if (reason === 'concurrent') f.repository.update.mockResolvedValue(null);
      const patch =
        reason === 'pin missing'
          ? { versionPolicy: 'pinned' as const }
          : reason === 'unexpected pin'
            ? { pinnedVersionId: randomUUID() }
            : { priority: 1 };
      await expect(
        f.run(() => f.service.update(f.row.id, reason === 'stale' ? 9 : 1, patch)),
      ).rejects.toThrow();
      expect(f.audit.record).not.toHaveBeenCalled();
      expect(f.outbox.record).not.toHaveBeenCalled();
    },
  );
  it('merges existing pins and permits clearing them only with the published policy', async () => {
    const f = fixture();
    f.row.versionPolicy = 'pinned';
    f.row.pinnedVersionId = randomUUID();
    await f.run(() => f.service.update(f.row.id, 1, { priority: 1 }));
    expect(f.repository.referencesExist.mock.calls[0]?.[2].versionIds).toEqual([
      f.row.pinnedVersionId,
    ]);
    await f.run(() =>
      f.service.update(f.row.id, 1, {
        versionPolicy: 'latestPublished',
        pinnedVersionId: null,
        variants: [
          { key: 'a', weight: 5000, pinnedVersionId: randomUUID() },
          { key: 'b', weight: 5000 },
        ],
      }),
    );
    expect(f.repository.referencesExist.mock.calls[1]?.[2].versionIds).toHaveLength(1);
    expect(f.audit.record).toHaveBeenCalledTimes(2);
  });
  it('preserves deletion version fences and emits success only for an actual deletion', async () => {
    const f = fixture();
    f.repository.softDelete.mockResolvedValue(false);
    await expect(f.run(() => f.service.remove(f.row.id, 1))).rejects.toThrow();
    expect(f.audit.record).not.toHaveBeenCalled();
    f.repository.softDelete.mockResolvedValue(true);
    await f.run(() => f.service.remove(f.row.id, 1));
    expect(f.outbox.record).toHaveBeenCalledOnce();
    expect(f.authz.authorize).toHaveBeenCalledWith(
      'delete',
      expect.objectContaining({ id: f.row.campaignId }),
    );
  });
  it('sorts batch update locks deterministically without changing caller input order', async () => {
    const f = fixture();
    const input = {
      creates: [f.input],
      updates: [
        { id: 'z', version: 1, patch: { priority: 1 } },
        { id: 'a', version: 1, patch: { priority: 2 } },
      ],
    };
    const result = await f.run(() => f.service.batch(input));
    expect(result.creates).toHaveLength(1);
    expect(result.updates).toHaveLength(2);
    expect(f.repository.update.mock.calls.map((call) => call[2])).toEqual(['a', 'z']);
    expect(input.updates.map((value) => value.id)).toEqual(['z', 'a']);
  });
});
