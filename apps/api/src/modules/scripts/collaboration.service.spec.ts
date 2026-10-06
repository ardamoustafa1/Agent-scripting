import { describe, expect, it, vi } from 'vitest';

import { initializeDocument, Y } from '@verbis/collaboration';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { DomainError } from '../../common/errors/domain-errors.js';

import { CollaborationService } from './collaboration.service.js';

import type { DraftLeaseService } from './draft-lease.service.js';
import type { ScriptsService } from './scripts.service.js';
import type { TeamService } from './team.service.js';
import type { ApiEnv } from '../../env.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { RedisService } from '../../infra/redis/redis.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AbilityFactory } from '../authz/ability.factory.js';
import type { LaunchRealtime } from '../launch/launch-realtime.js';
import type { Document } from '@hocuspocus/server';

function fixture() {
  const broadcast = vi.fn(),
    doc = Object.assign(new Y.Doc(), { broadcastStateless: broadcast });
  initializeDocument(doc, minimalScript());
  const version = { id: 'version', number: 1, state: 'draft', version: 4, screens: [] };
  const updateDraft = vi.fn().mockResolvedValue({ version: 5, checksum: 'checksum' });
  const sourceUpdate = vi.fn().mockResolvedValue({ count: 1 }),
    snapshot = vi.fn().mockResolvedValue({});
  const tx = {
    tenant: { findFirst: vi.fn().mockResolvedValue({ settings: {} }) },
    scriptVersion: {
      findFirstOrThrow: vi
        .fn()
        .mockResolvedValue({ source: { collaborationAuthors: ['user:first-author'] } }),
      updateMany: sourceUpdate,
    },
    collaborationSnapshot: { upsert: snapshot },
  };
  const record = vi.fn().mockResolvedValue(undefined),
    renew = vi.fn().mockResolvedValue(undefined),
    authorize = vi.fn().mockResolvedValue(version);
  const service = new CollaborationService(
    { COLLABORATION_PORT: 0 } as ApiEnv,
    {
      run: (_tenant: string, work: (value: typeof tx) => Promise<unknown>) => work(tx),
      current: () => tx,
    } as unknown as TenantDb,
    {} as RedisService,
    { validate: vi.fn().mockResolvedValue(undefined) } as unknown as LaunchRealtime,
    { forPrincipal: vi.fn().mockResolvedValue({ ability: {} }) } as unknown as AbilityFactory,
    { authorize } as unknown as TeamService,
    { getVersion: vi.fn().mockResolvedValue(version), updateDraft } as unknown as ScriptsService,
    { record } as unknown as AuditService,
    { renew } as unknown as DraftLeaseService,
  );
  const room = {
    grant: {
      userId: 'author',
      tenantId: 'tenant',
      scriptId: 'script',
      number: 1,
      documentName: 'room',
      bffId: 'session',
    },
    version: 4,
    lease: 'lease',
    frozen: false,
    contributors: new Set(['author']),
    owners: new Map<number, string>(),
  };
  (service as unknown as { rooms: Map<string, typeof room> }).rooms.set('room', room);
  return {
    service,
    room,
    doc: doc as unknown as Document,
    broadcast,
    updateDraft,
    record,
    sourceUpdate,
    snapshot,
    renew,
    authorize,
    version,
  };
}
describe('collaboration snapshot fence', () => {
  it('writes snapshot, draft and coauthor provenance before acknowledging a new counter', async () => {
    const f = fixture();
    await f.service.persist('room', f.doc);
    expect(f.updateDraft.mock.calls[0]?.[2]).toBe(4);
    expect(f.snapshot.mock.calls[0]?.[0]).toMatchObject({ update: { version: 5 } });
    expect(f.sourceUpdate.mock.calls[0]?.[0]).toMatchObject({
      data: { source: { collaborationAuthors: ['user:first-author', 'user:author'] } },
    });
    expect(f.room.version).toBe(5);
    expect(f.room.contributors.size).toBe(0);
    expect(f.broadcast.mock.calls[0]?.[0]).toContain('"type":"saved"');
    expect(f.record).toHaveBeenCalledOnce();
    f.doc.destroy();
  });
  it('preserves room edits and contributors for temporary semantic validation failures', async () => {
    const f = fixture();
    f.updateDraft.mockRejectedValue(
      new DomainError('VERBIS_SCRIPT_DOCUMENT_INVALID', 'Decision is unfinished'),
    );
    await expect(f.service.persist('room', f.doc)).rejects.toMatchObject({
      code: 'VERBIS_SCRIPT_DOCUMENT_INVALID',
    });
    expect(f.room.frozen).toBe(false);
    expect(f.room.version).toBe(4);
    expect(f.room.contributors.has('author')).toBe(true);
    expect(f.snapshot).not.toHaveBeenCalled();
    expect(f.broadcast.mock.calls[0]?.[0]).toBe('{"type":"invalid"}');
    f.doc.destroy();
  });
  it('freezes an external version conflict without acknowledging or overwriting it', async () => {
    const f = fixture();
    f.version.version = 9;
    await expect(f.service.persist('room', f.doc)).rejects.toMatchObject({
      code: 'VERBIS_SCRIPT_INVALID_TRANSITION',
    });
    expect(f.room.frozen).toBe(true);
    expect(f.updateDraft).not.toHaveBeenCalled();
    expect(f.room.version).toBe(4);
    f.doc.destroy();
  });
  it('does not advance the room counter when the tenant transaction fails to commit', async () => {
    const f = fixture();
    f.snapshot.mockRejectedValue(new Error('Transaction aborted'));
    await expect(f.service.persist('room', f.doc)).rejects.toThrow('Transaction aborted');
    expect(f.room.version).toBe(4);
    expect(f.room.contributors.has('author')).toBe(true);
    expect(f.broadcast.mock.calls[0]?.[0]).toBe('{"type":"conflict"}');
    f.doc.destroy();
  });
});
