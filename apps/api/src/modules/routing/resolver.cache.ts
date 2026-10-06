import { Inject, Injectable, Logger } from '@nestjs/common';

import { instruments } from '@verbis/observability';

import { type ApiEnv, API_ENV } from '../../env.js';
import { RedisService } from '../../infra/redis/redis.service.js';

import type { CampaignSnapshot } from './domain/resolver.js';

/**
 * Redis cache of campaign snapshots (not of decisions: decisions depend on time and context).
 * Keys carry a per-tenant generation; any publish/retire/assignment/campaign event bumps it, so
 * every cached snapshot of the tenant becomes unreachable at once. TTL is a safety net. Redis
 * failures degrade to a database read — never to a wrong answer.
 */
@Injectable()
export class ResolverCache {
  readonly #logger = new Logger(ResolverCache.name);

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  #genKey(tenantId: string): string {
    return `resolver:gen:${tenantId}`;
  }

  async generation(tenantId: string): Promise<string | undefined> {
    try {
      return (await this.redis.client.get(this.#genKey(tenantId))) ?? '0';
    } catch {
      return undefined;
    }
  }

  async get(
    tenantId: string,
    campaignId: string,
    generation: string,
  ): Promise<CampaignSnapshot | undefined> {
    try {
      const raw = await this.redis.client.get(
        `resolver:snap:${tenantId}:${generation}:${campaignId}`,
      );
      return raw === null ? undefined : reviveSnapshot(JSON.parse(raw) as SerializedSnapshot);
    } catch {
      return undefined;
    }
  }

  async set(
    tenantId: string,
    campaignId: string,
    generation: string,
    snapshot: CampaignSnapshot,
  ): Promise<void> {
    try {
      await this.redis.client.set(
        `resolver:snap:${tenantId}:${generation}:${campaignId}`,
        JSON.stringify(snapshot),
        'EX',
        this.env.RESOLVER_CACHE_TTL_SECONDS,
      );
    } catch {
      // Cache is optional.
    }
  }

  async invalidate(tenantId: string): Promise<void> {
    try {
      await this.redis.client.incr(this.#genKey(tenantId));
    } catch (error) {
      instruments.operationFailures.add(1, { operation: 'routing.cache.invalidate' });
      this.#logger.warn('Resolver cache invalidation failed; delivery must retry');
      throw error;
    }
  }
}

type SerializedSnapshot = Omit<CampaignSnapshot, 'campaign' | 'assignments'> & {
  campaign: Omit<CampaignSnapshot['campaign'], 'startsAt' | 'endsAt'> & {
    startsAt: string | null;
    endsAt: string | null;
  };
  assignments: (Omit<
    CampaignSnapshot['assignments'][number],
    'effectiveFrom' | 'effectiveTo' | 'createdAt'
  > & {
    effectiveFrom: string | null;
    effectiveTo: string | null;
    createdAt: string;
  })[];
};

const d = (v: string | null): Date | null => (v === null ? null : new Date(v));

export function reviveSnapshot(raw: SerializedSnapshot): CampaignSnapshot {
  return {
    ...raw,
    campaign: {
      ...raw.campaign,
      startsAt: d(raw.campaign.startsAt),
      endsAt: d(raw.campaign.endsAt),
    },
    assignments: raw.assignments.map((a) => ({
      ...a,
      effectiveFrom: d(a.effectiveFrom),
      effectiveTo: d(a.effectiveTo),
      createdAt: new Date(a.createdAt),
    })),
  };
}
