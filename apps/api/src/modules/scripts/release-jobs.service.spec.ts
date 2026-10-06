import { describe, expect, it, vi } from 'vitest';

import { requestContext, systemContext } from '../../common/context/request-context.js';
import { DomainError } from '../../common/errors/domain-errors.js';

import { ReleaseJobsService } from './release-jobs.service.js';

import type { TeamService } from './team.service.js';
import type { VersionLifecycleService } from './version-lifecycle.service.js';
import type { ApiEnv } from '../../env.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { RedisService } from '../../infra/redis/redis.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AbilityFactory } from '../authz/ability.factory.js';
import type { AuthzService } from '../authz/authz.service.js';

function fixture() {
  const row = {
    id: 'release',
    scriptId: 'script',
    requestedBy: 'publisher',
    number: 2,
    state: 'pending',
    checksum: 'signed-content',
    runAt: new Date(0),
  };
  const version = { state: 'approved', checksum: 'signed-content' };
  const publish = vi.fn<VersionLifecycleService['publish']>().mockResolvedValue({} as never);
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: row.id }]),
    scheduledRelease: {
      findFirst: vi.fn().mockResolvedValue(row),
      findMany: vi.fn().mockResolvedValue([row]),
      create: vi.fn().mockResolvedValue(row),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    assignment: { findMany: vi.fn().mockResolvedValue([{ campaignId: 'synthetic-campaign' }]) },
    tenant: { findFirst: vi.fn().mockResolvedValue({ settings: {} }) },
    scriptVersion: { findFirst: vi.fn().mockResolvedValue(version) },
  };
  const record = vi.fn().mockResolvedValue(undefined);
  const forPrincipal = vi.fn().mockResolvedValue({ ability: {} });
  const authorize = vi.fn(),
    team = {
      authorize: vi.fn().mockResolvedValue({
        id: 'version',
        state: 'approved',
        source: null,
        checksum: 'signed-content',
        createdBy: 'user:author',
        updatedBy: 'user:author',
      }),
    },
    outbox = { record: vi.fn().mockResolvedValue(undefined) };
  const env = { EVENT_CONSUMERS_ENABLED: true } as ApiEnv;
  const service = new ReleaseJobsService(
    {
      current: () => tx,
      tenantId: () => 'tenant',
      run: (_tenant: string, work: (transaction: typeof tx) => Promise<void>) => work(tx),
    } as unknown as TenantDb,
    {} as RedisService,
    env,
    outbox,
    { record } as unknown as AuditService,
    { forPrincipal } as unknown as AbilityFactory,
    { authorize } as unknown as AuthzService,
    team as unknown as TeamService,
    { publish } as unknown as VersionLifecycleService,
  );
  const run = () => service.run({ id: row.id, tenantId: 'tenant', at: '2026-10-02T12:00:00Z' });
  return {
    service,
    env,
    authorize,
    team,
    outbox,
    run,
    row,
    version,
    tx,
    publish,
    record,
    forPrincipal,
  };
}
describe('scheduled publication execution', () => {
  it('locks the schedule, refreshes publisher permissions and invokes the regression-gated lifecycle', async () => {
    const f = fixture();
    await f.run();
    expect(f.tx.$queryRaw).toHaveBeenCalledOnce();
    expect(f.forPrincipal).toHaveBeenCalledOnce();
    expect(f.publish).toHaveBeenCalledWith('script', 2);
    expect(f.tx.scheduledRelease.updateMany.mock.calls[0]?.[0]).toMatchObject({
      data: { state: 'published' },
    });
    expect(f.record.mock.calls[0]?.[1]).toMatchObject({ action: 'script.release.executed' });
  });
  it.each(['revoked', 'checksum', 'state', 'regression'])(
    'blocks %s without success audit',
    async (reason) => {
      const f = fixture();
      if (reason === 'revoked') f.forPrincipal.mockResolvedValue(undefined);
      if (reason === 'checksum') f.version.checksum = 'changed';
      if (reason === 'state') f.version.state = 'draft';
      if (reason === 'regression')
        f.publish.mockRejectedValue(
          new DomainError('VERBIS_SCRIPT_DOCUMENT_INVALID', 'Scenario failed'),
        );
      await f.run();
      expect(f.tx.scheduledRelease.updateMany.mock.calls[0]?.[0]).toMatchObject({
        data: { state: 'blocked' },
      });
      expect(f.record.mock.calls[0]?.[1]).toMatchObject({ action: 'script.release.blocked' });
      if (reason !== 'regression') expect(f.publish).not.toHaveBeenCalled();
    },
  );
  it('treats completed and premature jobs as no-ops', async () => {
    const f = fixture();
    f.row.state = 'published';
    await f.run();
    f.row.state = 'pending';
    f.row.runAt = new Date('2100-01-01');
    await f.run();
    expect(f.publish).not.toHaveBeenCalled();
    expect(f.record).not.toHaveBeenCalled();
  });
  it('leaves infrastructure failures retryable rather than marking a release blocked', async () => {
    const f = fixture();
    f.publish.mockRejectedValue(new Error('Database unavailable'));
    await expect(f.run()).rejects.toThrow('Database unavailable');
    expect(f.tx.scheduledRelease.updateMany).not.toHaveBeenCalled();
  });
});

describe('release scheduling authorization and time bounds', () => {
  const asPublisher = <T>(work: () => T, user = true) =>
    requestContext.run(
      {
        ...systemContext('synthetic', 'test'),
        principal: user
          ? { type: 'user', id: 'publisher', tenantId: 'tenant', scopes: [] }
          : { type: 'service', id: 'service', tenantId: 'tenant', scopes: [] },
      },
      work,
    );
  it('records a schedule with fresh publisher permissions and emits a durable release request', async () => {
    const f = fixture(),
      at = new Date(Date.now() + 120000).toISOString();
    expect(await asPublisher(() => f.service.schedule('script', 2, at))).toMatchObject({
      state: 'pending',
      at,
    });
    expect(f.authorize).toHaveBeenCalledWith(
      'publish',
      expect.objectContaining({ campaignIds: ['synthetic-campaign'] }),
    );
    expect(f.tx.scheduledRelease.create.mock.calls[0]?.[0]).toMatchObject({
      data: { checksum: 'signed-content', requestedBy: 'publisher', runAt: new Date(at) },
    });
    expect(f.outbox.record.mock.calls[0]?.[1]).toMatchObject({
      type: 'verbis.scripts.release.scheduled.v1',
    });
    expect(await asPublisher(() => f.service.list('script', 2))).toHaveLength(1);
  });
  it.each(['disabled', 'too soon', 'too far', 'service caller', 'unapproved'] as const)(
    'rejects %s scheduling before creating any release',
    async (reason) => {
      const f = fixture();
      if (reason === 'disabled') f.env.EVENT_CONSUMERS_ENABLED = false;
      if (reason === 'unapproved')
        f.team.authorize.mockResolvedValue({
          id: 'version',
          state: 'draft',
          source: null,
          checksum: 'signed-content',
          createdBy: 'user:author',
          updatedBy: 'user:author',
        });
      const at = new Date(
        Date.now() + (reason === 'too soon' ? 1000 : reason === 'too far' ? 91 * 86400000 : 120000),
      ).toISOString();
      await expect(
        asPublisher(() => f.service.schedule('script', 2, at), reason !== 'service caller'),
      ).rejects.toThrow();
      expect(f.tx.scheduledRelease.create).not.toHaveBeenCalled();
      expect(f.outbox.record).not.toHaveBeenCalled();
      await f.service.onModuleDestroy();
    },
  );
  it('ignores missing jobs and blocks publication for a removed tenant or source version', async () => {
    const f = fixture();
    f.tx.scheduledRelease.findFirst.mockResolvedValue(null);
    await f.run();
    expect(f.publish).not.toHaveBeenCalled();
    f.tx.scheduledRelease.findFirst.mockResolvedValue(f.row);
    f.tx.tenant.findFirst.mockResolvedValue(null);
    await f.run();
    expect(f.tx.scheduledRelease.updateMany.mock.calls[0]?.[0]).toMatchObject({
      data: { state: 'blocked' },
    });
    f.tx.tenant.findFirst.mockResolvedValue({ settings: {} });
    f.tx.scriptVersion.findFirst.mockResolvedValue(null);
    await f.run();
    expect(f.publish).not.toHaveBeenCalled();
  });
  it('does not create worker resources when event consumers are disabled', () => {
    const f = fixture();
    f.env.EVENT_CONSUMERS_ENABLED = false;
    f.service.onApplicationBootstrap();
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
  });
});
