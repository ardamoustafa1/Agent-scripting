import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../common/errors/domain-errors.js';
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

  /** Generation is read BEFORE the database, so a snapshot can never be cached under a newer one. */
  async snapshot(
    campaignId: string,
  ): Promise<{ snapshot: CampaignSnapshot; cache: 'hit' | 'miss' | 'bypass' }> {
    const tenantId = this.db.tenantId();
    const generation = await this.cache.generation(tenantId);
    if (generation !== undefined) {
      const cached = await this.cache.get(tenantId, campaignId, generation);
      if (cached !== undefined) {
        const scripts = await this.db.current().script.findMany({
          where: {
            tenantId,
            id: { in: [...new Set(cached.assignments.map((a) => a.scriptId))] },
            deletedAt: null,
          },
          select: { id: true, currentVersionId: true },
        });
        const fresh =
          scripts.length === new Set(cached.assignments.map((a) => a.scriptId)).size &&
          scripts.every((s) =>
            cached.versions.some(
              (v) => v.scriptId === s.id && v.current === true && v.id === s.currentVersionId,
            ),
          );
        if (fresh) return { snapshot: cached, cache: 'hit' };
      }
    }
    const loaded = await this.snapshots.load(this.db.current(), tenantId, campaignId);
    if (loaded === undefined) throw new NotFoundError('Campaign');
    if (generation !== undefined) await this.cache.set(tenantId, campaignId, generation, loaded);
    return { snapshot: loaded, cache: generation === undefined ? 'bypass' : 'miss' };
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
