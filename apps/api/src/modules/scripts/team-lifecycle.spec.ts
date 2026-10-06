/* Test doubles use asynchronous signatures and Vitest asymmetric matchers. */
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment */
import { describe, expect, it, vi } from 'vitest';

import { requestContext } from '../../common/context/request-context.js';
import { DomainError } from '../../common/errors/domain-errors.js';

import { VersionLifecycleService } from './version-lifecycle.service.js';

import type { DraftLeaseService } from './draft-lease.service.js';
import type { PreviewService } from './preview.service.js';
import type { ScriptsRepository } from './scripts.repository.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthzService } from '../authz/authz.service.js';

function fixture() {
  const version = {
    id: 'old',
    number: 1,
    state: 'published',
    semver: '1.0.0' as string | null,
    checksum: 'hash',
    reviewRound: 1,
    createdBy: 'user:author',
    updatedBy: 'user:author',
    submittedBy: 'user:author',
    contributors: ['user:coauthor'],
  };
  const tx = {
    $queryRaw: vi.fn(async () => [version]),
    scriptVersion: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi
        .fn<(...args: unknown[]) => Promise<{ number: number } | null>>()
        .mockResolvedValue({ number: 2 }),
    },
    script: { updateMany: vi.fn(async () => ({ count: 1 })) },
    assignment: { findMany: vi.fn(async () => [{ campaignId: 'campaign' }]) },
  };
  const authorize = vi.fn(),
    record = vi.fn(async () => undefined),
    outbox = vi.fn(async () => undefined),
    requirePassing = vi.fn(async () => undefined),
    assertWritable = vi.fn(async () => undefined);
  const service = new VersionLifecycleService(
    { assertWritable } as unknown as DraftLeaseService,
    { requirePassing } as unknown as PreviewService,
    { current: () => tx, tenantId: () => 'tenant' } as unknown as TenantDb,
    {} as ScriptsRepository,
    { record } as unknown as AuditService,
    { record: outbox } as unknown as OutboxWriter,
    { authorize } as unknown as AuthzService,
  );
  return { service, tx, authorize, record, outbox, requirePassing, assertWritable, version };
}
const run = <T>(fn: () => T) =>
  requestContext.run(
    {
      requestId: 'fixture',
      correlationId: 'fixture',
      ip: '',
      userAgent: 'test',
      principal: { type: 'user', id: 'reviewer', tenantId: 'tenant', scopes: [] },
    },
    fn,
  );
describe('release head rollback', () => {
  it('checks SoD authors, scenarios and optimistic head, audits and invalidates through the outbox', async () => {
    const f = fixture();
    const value = await run(() => f.service.rollback('script', 1, 'current'));
    expect(value).toEqual({ number: 1, currentVersionId: 'old' });
    expect(f.requirePassing).toHaveBeenCalledWith('script', 1);
    expect(f.authorize).toHaveBeenCalledWith(
      'publish',
      expect.objectContaining({ authorIds: expect.arrayContaining(['coauthor']) }),
    );
    expect(f.tx.script.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ currentVersionId: 'current' }) }),
    );
    expect(f.record).toHaveBeenCalledWith(
      f.tx,
      expect.objectContaining({ action: 'script.version.rolledBack' }),
    );
    expect(f.outbox).toHaveBeenCalledWith(
      f.tx,
      expect.objectContaining({ type: 'verbis.scripts.version.rolledBack.v1' }),
    );
  });
  it('rejects a concurrent head change without emitting a success audit', async () => {
    const f = fixture();
    f.tx.script.updateMany.mockResolvedValue({ count: 0 });
    await expect(run(() => f.service.rollback('script', 1, 'stale'))).rejects.toMatchObject({
      code: 'VERBIS_SCRIPT_INVALID_TRANSITION',
    });
    expect(f.record).not.toHaveBeenCalled();
  });
  it('rejects unpublished targets and empty submission notes before mutation', async () => {
    const f = fixture();
    f.version.state = 'draft';
    await expect(run(() => f.service.rollback('script', 1, 'current'))).rejects.toMatchObject({
      code: 'VERBIS_SCRIPT_INVALID_TRANSITION',
    });
    await expect(
      run(() => f.service.submit('script', 1, { semver: '2.0.0', changeNote: ' ' })),
    ).rejects.toMatchObject({ code: 'VERBIS_VALIDATION_FAILED' });
    expect(f.tx.script.updateMany).not.toHaveBeenCalled();
  });
});

describe('release publication validation regressions', () => {
  it('blocks submit before transition when release validation fails', async () => {
    const f = fixture();
    f.version.state = 'draft';
    f.requirePassing.mockRejectedValue(new DomainError('VERBIS_SCRIPT_DOCUMENT_INVALID'));
    await expect(
      run(() => f.service.submit('script', 1, { semver: '2.0.0', changeNote: 'Synthetic' })),
    ).rejects.toMatchObject({ code: 'VERBIS_SCRIPT_DOCUMENT_INVALID' });
    expect(f.requirePassing).toHaveBeenCalledWith('script', 1);
    expect(f.record).not.toHaveBeenCalled();
    expect(f.outbox).not.toHaveBeenCalled();
  });
  it.each([undefined, 'x'.repeat(4001)])(
    'rejects missing or oversized change notes before recording a transition (%j)',
    async (changeNote) => {
      const f = fixture();
      await expect(
        run(() => f.service.submit('script', 1, changeNote === undefined ? {} : { changeNote })),
      ).rejects.toMatchObject({ code: 'VERBIS_VALIDATION_FAILED' });
      expect(f.record).not.toHaveBeenCalled();
    },
  );
  it('requires semver when neither the stored draft nor the submit request provides one', async () => {
    const f = fixture();
    f.version.semver = null;
    await expect(
      run(() => f.service.submit('script', 1, { changeNote: 'Synthetic' })),
    ).rejects.toMatchObject({ code: 'VERBIS_VALIDATION_FAILED' });
    expect(f.record).not.toHaveBeenCalled();
  });
  it.each(['missing head', 'same release', 'later target'] as const)(
    'refuses rollback to an unsafe release head: %s',
    async (reason) => {
      const f = fixture();
      f.tx.scriptVersion.findFirst.mockResolvedValue(
        reason === 'missing head' ? null : { number: reason === 'same release' ? 1 : 0 },
      );
      await expect(run(() => f.service.rollback('script', 1, 'current'))).rejects.toMatchObject({
        code: 'VERBIS_SCRIPT_INVALID_TRANSITION',
      });
      expect(f.requirePassing).not.toHaveBeenCalled();
      expect(f.tx.script.updateMany).not.toHaveBeenCalled();
      expect(f.outbox).not.toHaveBeenCalled();
    },
  );
  it('rejects missing locked versions before permission checks or mutations', async () => {
    const f = fixture();
    f.tx.$queryRaw.mockResolvedValue([]);
    await expect(run(() => f.service.rollback('script', 1, 'current'))).rejects.toMatchObject({
      code: 'VERBIS_RESOURCE_NOT_FOUND',
    });
    expect(f.authorize).not.toHaveBeenCalled();
  });
  it('blocks rollback when a required regression fails and omits all success records', async () => {
    const f = fixture();
    f.requirePassing.mockRejectedValue(
      new DomainError('VERBIS_SCRIPT_DOCUMENT_INVALID', 'Synthetic scenario failed'),
    );
    await expect(run(() => f.service.rollback('script', 1, 'current'))).rejects.toMatchObject({
      code: 'VERBIS_SCRIPT_DOCUMENT_INVALID',
    });
    expect(f.tx.script.updateMany).not.toHaveBeenCalled();
    expect(f.record).not.toHaveBeenCalled();
    expect(f.outbox).not.toHaveBeenCalled();
  });
});
