import { randomUUID } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { asSubject } from '@verbis/authz';

import { requestContext, systemContext } from '../../common/context/request-context.js';
import { NotFoundError } from '../../common/errors/domain-errors.js';
import { API_ENV, type ApiEnv } from '../../env.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type TransactionClient } from '../../infra/database/prisma.service.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { aggregate } from '../analytics/metrics.js';
import { AnalyticsStore } from '../analytics/storage.js';
import { AuthzService } from '../authz/authz.service.js';

import { advise, armsOf, type Allocation } from './allocation.js';
import { variantsOf } from './assignments.dto.js';
import { AssignmentsRepository } from './assignments.repository.js';
import { AssignmentsService } from './assignments.service.js';
import { decideRollout, evidenceOf, rolloutArms, type RolloutDecision } from './rollout.js';

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 14;
const GUARD_ACTOR = 'rollout-guard';

export interface AllocationReport {
  readonly assignmentId: string;
  readonly allocation: Allocation;
}
export interface RolloutReport {
  readonly assignmentId: string;
  readonly decision: RolloutDecision;
  readonly stableSessions: number;
  readonly canarySessions: number;
  readonly windowDays: number;
}

@Injectable()
export class RolloutService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(AssignmentsRepository) private readonly repository: AssignmentsRepository,
    @Inject(AnalyticsStore) private readonly store: AnalyticsStore,
  ) {}

  /** Evidence-based verdict for one assignment inside the CALLER's transaction. */
  async evaluate(id: string, now = new Date()): Promise<RolloutReport> {
    const tx = this.db.current(),
      row = await this.repository.find(tx, this.db.tenantId(), id);
    if (row === null) throw new NotFoundError('Assignment');
    this.authz.authorize('read', asSubject('Campaign', { id: row.campaignId }));
    return this.report(tx, this.db.tenantId(), row.id, row.scriptId, row.abTest, now);
  }

  /** Bandit traffic advice for ANY A/B assignment (advisory; never applied here). */
  async allocation(id: string, now = new Date()): Promise<AllocationReport> {
    const tx = this.db.current(),
      tenantId = this.db.tenantId(),
      row = await this.repository.find(tx, tenantId, id);
    if (row === null) throw new NotFoundError('Assignment');
    this.authz.authorize('read', asSubject('Campaign', { id: row.campaignId }));
    const variants = variantsOf(row.abTest);
    if (variants === null)
      return { assignmentId: id, allocation: { reason: 'no-eligible-arm', arms: [] } };
    const facts = await this.store.read(tx, tenantId, {
      from: new Date(now.getTime() - WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10),
      to: now.toISOString().slice(0, 10),
      scriptId: row.scriptId,
    });
    const dashboard = aggregate(
      facts.filter((f) => f.experimentId === id),
      false,
      now,
    );
    return {
      assignmentId: id,
      allocation: advise(
        armsOf(
          dashboard,
          id,
          variants.map((v) => v.key),
        ),
        id,
      ),
    };
  }

  async report(
    tx: TransactionClient,
    tenantId: string,
    id: string,
    scriptId: string,
    abTest: unknown,
    now: Date,
  ): Promise<RolloutReport> {
    const variants = variantsOf(abTest);
    const empty = {
      assignmentId: id,
      stableSessions: 0,
      canarySessions: 0,
      windowDays: WINDOW_DAYS,
    };
    if (!rolloutArms(variants))
      return { ...empty, decision: decideRollout(variants, evidenceOf(blank, id)) };
    const facts = await this.store.read(tx, tenantId, {
      from: new Date(now.getTime() - WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10),
      to: now.toISOString().slice(0, 10),
      scriptId,
    });
    const dashboard = aggregate(
        facts.filter((f) => f.experimentId === id),
        false,
        now,
      ),
      evidence = evidenceOf(dashboard, id);
    return {
      ...empty,
      stableSessions: evidence.stableSessions,
      canarySessions: evidence.canarySessions,
      decision: decideRollout(variants, evidence),
    };
  }
}
const blank = { variants: [], comparisons: [], guardrails: [] };

/**
 * Periodic guard: finds active canary rollouts in every tenant and rolls back those with positive
 * evidence of harm. It never advances a rollout. Off unless ROLLOUT_GUARD_ENABLED (needs analytics).
 */
@Injectable()
export class RolloutGuard implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly logger = new Logger(RolloutGuard.name);
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(RolloutService) private readonly rollouts: RolloutService,
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
  ) {}
  onApplicationBootstrap() {
    if (!this.env.ROLLOUT_GUARD_ENABLED) return;
    if (!this.env.ANALYTICS_ENABLED)
      throw new Error('ROLLOUT_GUARD_ENABLED requires ANALYTICS_ENABLED (it decides on analytics)');
    this.timer = setInterval(() => {
      void this.tick().catch(() => {
        this.logger.warn('Rollout guard failed; retrying next tick');
      });
    }, 60_000);
    this.timer.unref();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
  /** Returns the ids it rolled back (for tests and logs). */
  async tick(now = new Date()): Promise<string[]> {
    if (this.running) return [];
    this.running = true;
    const rolledBack: string[] = [];
    try {
      const tenants = await this.prisma.client.$queryRaw<
        { id: string }[]
      >`SELECT id FROM analytics_active_tenants()`;
      for (const tenant of tenants)
        await requestContext.run(
          {
            ...systemContext(randomUUID(), GUARD_ACTOR),
            principal: { type: 'service', id: GUARD_ACTOR, tenantId: tenant.id, scopes: [] },
          },
          () =>
            this.db.run(tenant.id, async (tx) => {
              requestContext.require().tx = tx;
              const rows = await tx.assignment.findMany({
                where: {
                  tenantId: tenant.id,
                  deletedAt: null,
                  NOT: { abTest: { equals: Prisma.DbNull } },
                },
                select: { id: true, scriptId: true, abTest: true },
              });
              for (const row of rows) {
                const arms = rolloutArms(variantsOf(row.abTest));
                if (!arms || arms.canary.weight <= 0 || arms.canary.weight >= 10_000) continue;
                const report = await this.rollouts.report(
                  tx,
                  tenant.id,
                  row.id,
                  row.scriptId,
                  row.abTest,
                  now,
                );
                if (report.decision.action !== 'rollback') continue;
                const done = await this.assignments.rollbackCanary(
                  tx,
                  tenant.id,
                  row.id,
                  GUARD_ACTOR,
                  report.decision.breached,
                );
                if (done !== null) rolledBack.push(row.id);
              }
            }),
        );
    } finally {
      this.running = false;
    }
    return rolledBack;
  }
}
