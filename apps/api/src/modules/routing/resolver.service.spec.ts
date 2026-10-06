import { describe, expect, it, vi } from 'vitest';

import { ResolverService } from './resolver.service.js';

import type { CampaignSnapshot } from './domain/resolver.js';
import type { ResolverCache } from './resolver.cache.js';
import type { SnapshotRepository } from './snapshot.repository.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { AuditService } from '../audit/audit.service.js';

const snapshot: CampaignSnapshot = {
  campaign: {
    id: 'campaign',
    code: 'C',
    status: 'active',
    channels: ['voice'],
    startsAt: null,
    endsAt: null,
    workingHours: null,
  },
  assignments: [],
  versions: [],
};
function fixture() {
  const revisions = {
    revision: vi.fn().mockResolvedValue('r1'),
    load: vi.fn().mockResolvedValue(snapshot),
  };
  const cache = { generation: vi.fn().mockResolvedValue('g'), get: vi.fn(), set: vi.fn() };
  const service = new ResolverService(
    { tenantId: () => 'tenant', current: () => ({}) } as unknown as TenantDb,
    revisions as unknown as SnapshotRepository,
    cache as unknown as ResolverCache,
    {} as AuditService,
  );
  return { service, revisions, cache };
}
describe('authoritative routing cache revisions', () => {
  it('only reads a cache entry keyed by the current database revision', async () => {
    const f = fixture();
    f.cache.get.mockResolvedValue(snapshot);
    expect(await f.service.snapshot('campaign')).toEqual({ snapshot, cache: 'hit' });
    expect(f.cache.get).toHaveBeenCalledWith('tenant', 'campaign', 'g:r1');
    expect(f.revisions.load).not.toHaveBeenCalled();
  });
  it('retries a racing configuration load and never caches it under the wrong revision', async () => {
    const f = fixture();
    f.revisions.revision.mockResolvedValueOnce('r1').mockResolvedValue('r2');
    await f.service.snapshot('campaign');
    expect(f.revisions.load).toHaveBeenCalledTimes(2);
    expect(f.cache.set).toHaveBeenCalledOnce();
    expect(f.cache.set).toHaveBeenCalledWith('tenant', 'campaign', 'g:r2', snapshot);
  });
  it('fails visibly after bounded configuration churn, without caching any mixed snapshot', async () => {
    const f = fixture();
    let revision = 0;
    f.revisions.revision.mockImplementation(() => Promise.resolve(String(++revision)));
    await expect(f.service.snapshot('campaign')).rejects.toThrow('retry resolution');
    expect(f.revisions.load).toHaveBeenCalledTimes(3);
    expect(f.cache.set).not.toHaveBeenCalled();
  });
  it('bypasses unavailable Redis but still fences the database load', async () => {
    const f = fixture();
    f.cache.generation.mockResolvedValue(undefined);
    expect(await f.service.snapshot('campaign')).toEqual({ snapshot, cache: 'bypass' });
    expect(f.revisions.revision).toHaveBeenCalledTimes(2);
    expect(f.cache.get).not.toHaveBeenCalled();
    expect(f.cache.set).not.toHaveBeenCalled();
  });
  it('never serves a snapshot for a deleted campaign', async () => {
    const f = fixture();
    f.revisions.load.mockResolvedValue(undefined);
    await expect(f.service.snapshot('campaign')).rejects.toThrow('Campaign');
    expect(f.cache.set).not.toHaveBeenCalled();
  });
});
