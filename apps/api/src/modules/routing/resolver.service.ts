import { Inject, Injectable } from '@nestjs/common';

import { ConflictError, NotFoundError } from '../../common/errors/domain-errors.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';

import { detectConflicts } from './domain/conflicts.js';
import { resolveScript, type CampaignSnapshot, type Decision } from './domain/resolver.js';
import { ResolverCache } from './resolver.cache.js';
import { SnapshotRepository } from './snapshot.repository.js';

import type { ResolveRequest } from './routing.dto.js';

@Injectable()
export class ResolverService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(SnapshotRepository) private readonly snapshots: SnapshotRepository,
    @Inject(ResolverCache) private readonly cache: ResolverCache,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Redis generation accelerates invalidation; authoritative metadata revisions fence every hit/load. */
  async snapshot(
    campaignId: string,
  ): Promise<{ snapshot: CampaignSnapshot; cache: 'hit' | 'miss' | 'bypass' }> {
    const tenantId = this.db.tenantId();
    const tx = this.db.current();
    const generation = await this.cache.generation(tenantId);
    for (let attempt = 0; attempt < 3; attempt++) {
      const revision = await this.snapshots.revision(tx, tenantId, campaignId);
      const key = generation === undefined ? undefined : `${generation}:${revision}`;
      if (key !== undefined) {
        const cached = await this.cache.get(tenantId, campaignId, key);
        if (cached !== undefined) return { snapshot: cached, cache: 'hit' };
      }
      const loaded = await this.snapshots.load(tx, tenantId, campaignId);
      if (loaded === undefined) throw new NotFoundError('Campaign');
      // A commit during the multi-query load cannot be stamped as an older or newer revision.
      if (revision !== (await this.snapshots.revision(tx, tenantId, campaignId))) continue;
      if (key !== undefined) await this.cache.set(tenantId, campaignId, key, loaded);
      return { snapshot: loaded, cache: key === undefined ? 'bypass' : 'miss' };
    }
    throw new ConflictError('Routing configuration changed; retry resolution');
  }

  lookupCampaign(request: ResolveRequest) {
    return this.snapshots.findCampaignId(this.db.current(), this.db.tenantId(), {
      ...(request.campaignId ? { campaignId: request.campaignId } : {}),
      ...(request.campaignCode ? { campaignCode: request.campaignCode } : {}),
      ...(request.external ? { external: request.external } : {}),
    });
  }
  async resolve(
    request: ResolveRequest,
    campaignIdOverride?: string,
  ): Promise<Decision & { cache: 'hit' | 'miss' | 'bypass' }> {
    const tx = this.db.current();
    const campaignId =
      campaignIdOverride ??
      (await this.snapshots.findCampaignId(tx, this.db.tenantId(), {
        ...(request.campaignId === undefined ? {} : { campaignId: request.campaignId }),
        ...(request.campaignCode === undefined ? {} : { campaignCode: request.campaignCode }),
        ...(request.external === undefined ? {} : { external: request.external }),
      }));
    if (campaignId === undefined) throw new NotFoundError('Campaign');
    const { snapshot, cache } = await this.snapshot(campaignId);
    const decision = resolveScript(snapshot, {
      channel: request.channel,
      ...(request.locale === undefined ? {} : { locale: request.locale }),
      ...(request.queue === undefined ? {} : { queue: request.queue }),
      ...(request.skills === undefined ? {} : { skills: request.skills }),
      ...(request.segment === undefined ? {} : { segment: request.segment }),
      ...(request.attributes === undefined ? {} : { attributes: request.attributes }),
      ...(request.agent === undefined
        ? {}
        : {
            agent: {
              id: request.agent.id,
              ...(request.agent.attributes === undefined
                ? {}
                : { attributes: request.agent.attributes }),
            },
          }),
      ...(request.interactionId === undefined ? {} : { interactionId: request.interactionId }),
      ...(request.stickyKey === undefined ? {} : { stickyKey: request.stickyKey }),
      at: request.at === undefined ? new Date() : new Date(request.at),
    });
    // The decision (not the attached data, which may hold PII) is audited for forensics.
    await this.audit.record(tx, {
      action: 'routing.script.resolved',
      target: { type: 'Campaign', id: campaignId },
      outcome: decision.outcome === 'resolved' ? 'success' : 'failure',
      ...(decision.reason === undefined ? {} : { reason: decision.reason }),
      ...(request.interactionId === undefined ? {} : { interactionId: request.interactionId }),
      metadata: {
        assignmentId: decision.assignmentId ?? null,
        scriptId: decision.scriptId ?? null,
        versionId: decision.version?.id ?? null,
        checksum: decision.version?.checksum ?? null,
        variant: decision.variant?.key ?? null,
        abSkipped: decision.trace.abSkipped ?? null,
        ranking: decision.trace.ranking,
        tie: decision.trace.tie,
        rejected: decision.trace.evaluated
          .filter((e) => !e.eligible)
          .map((e) => ({ id: e.assignmentId, reasons: e.reasons })),
        channel: request.channel,
        cache,
        at: decision.trace.at,
      },
    });
    return { ...decision, cache };
  }

  async conflicts(campaignId: string) {
    const loaded = await this.snapshots.load(this.db.current(), this.db.tenantId(), campaignId);
    if (loaded === undefined) throw new NotFoundError('Campaign');
    return detectConflicts(loaded.assignments, new Date());
  }
}
