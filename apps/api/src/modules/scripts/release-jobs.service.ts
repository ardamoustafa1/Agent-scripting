import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { z } from 'zod';

import { asSubject, authorIdsOf } from '@verbis/authz';

import { requestContext, systemContext } from '../../common/context/request-context.js';
import { uuidv7 } from '../../common/crypto/uuid.js';
import { DomainError, ForbiddenError } from '../../common/errors/domain-errors.js';
import { API_ENV, type ApiEnv } from '../../env.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { DomainEventHandler } from '../../infra/events/event-consumers.service.js';
import { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import { RedisService } from '../../infra/redis/redis.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AbilityFactory } from '../authz/ability.factory.js';
import { AuthzService } from '../authz/authz.service.js';

import { TeamService } from './team.service.js';
import { VersionLifecycleService } from './version-lifecycle.service.js';

import type { EventHandler } from '../../infra/events/event-consumer.js';
import type { EventEnvelope } from '../../infra/outbox/outbox.types.js';
import type { Redis } from 'ioredis';

const Job = z.object({ id: z.uuid(), tenantId: z.uuid(), at: z.string() });
@DomainEventHandler()
@Injectable()
export class ReleaseJobsService implements EventHandler, OnApplicationBootstrap, OnModuleDestroy {
  readonly name = 'scheduled-releases';
  readonly stream = 'DOMAIN';
  readonly filterSubjects = ['verbis.scripts.release.scheduled.v1'];
  private queue: Queue | undefined;
  private worker: Worker | undefined;
  private connection: Redis | undefined;
  private workerConnection: Redis | undefined;
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AbilityFactory) private readonly abilities: AbilityFactory,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(TeamService) private readonly team: TeamService,
    @Inject(VersionLifecycleService) private readonly lifecycle: VersionLifecycleService,
  ) {}
  private getQueue() {
    if (!this.queue) {
      this.connection = this.redis.client.duplicate({
        keyPrefix: '',
        maxRetriesPerRequest: 1,
        commandTimeout: 2000,
      });
      this.connection.on('error', () => undefined);
      this.queue = new Queue('releases', { connection: this.connection, prefix: 'verbis:jobs' });
      this.queue.on('error', () => undefined);
    }
    return this.queue;
  }
  async schedule(scriptId: string, number: number, at: string) {
    if (!this.env.EVENT_CONSUMERS_ENABLED)
      throw new DomainError('VERBIS_VALIDATION_FAILED', 'Scheduled release worker is disabled');
    const runAt = new Date(at),
      now = Date.now();
    if (runAt.getTime() < now + 60000 || runAt.getTime() > now + 90 * 86400000)
      throw new DomainError(
        'VERBIS_VALIDATION_FAILED',
        'Schedule must be between one minute and 90 days from now',
      );
    const version = await this.team.authorize(scriptId, number),
      principal = requestContext.require().principal;
    if (principal?.type !== 'user') throw new ForbiddenError();
    const campaigns = await this.db.current().assignment.findMany({
      where: { tenantId: this.db.tenantId(), scriptId, deletedAt: null },
      select: { campaignId: true },
    });
    this.authz.authorize(
      'publish',
      asSubject('Script', {
        id: scriptId,
        campaignIds: campaigns.map((c) => c.campaignId),
        authorIds: authorIdsOf({
          ...version,
          contributors: z
            .object({ collaborationAuthors: z.array(z.string()).default([]) })
            .parse(version.source ?? {}).collaborationAuthors,
        }),
      }),
    );
    if (version.state !== 'approved')
      throw new DomainError(
        'VERBIS_SCRIPT_INVALID_TRANSITION',
        'Only approved versions may be scheduled',
      );
    const id = uuidv7(),
      tx = this.db.current();
    const row = await tx.scheduledRelease.create({
      data: {
        id,
        tenantId: principal.tenantId,
        scriptId,
        number,
        checksum: version.checksum,
        requestedBy: principal.id,
        runAt,
      },
    });
    await this.audit.record(tx, {
      action: 'script.release.scheduled',
      target: { type: 'ScriptVersion', id: version.id },
      metadata: { releaseId: id, runAt: at, checksum: version.checksum },
    });
    await this.outbox.record(tx, {
      type: 'verbis.scripts.release.scheduled.v1',
      aggregateType: 'Script',
      aggregateId: scriptId,
      payload: { id, at: runAt.toISOString() },
    });
    return { id, state: row.state, at: runAt.toISOString() };
  }
  async list(scriptId: string, number: number) {
    await this.team.authorize(scriptId, number);
    return this.db.current().scheduledRelease.findMany({
      where: { tenantId: this.db.tenantId(), scriptId, number },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
  async handle(event: EventEnvelope) {
    const job = Job.parse({ ...event.payload, tenantId: event.tenantId });
    await this.getQueue().add('publish', job, {
      jobId: job.id,
      delay: Math.max(0, Date.parse(job.at) - Date.now()),
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }
  onApplicationBootstrap() {
    if (!this.env.EVENT_CONSUMERS_ENABLED) return;
    this.getQueue();
    this.workerConnection = this.connection?.duplicate({
      maxRetriesPerRequest: null,
      commandTimeout: undefined,
      enableOfflineQueue: true,
    });
    if (!this.workerConnection) return;
    this.workerConnection.on('error', () => undefined);
    this.worker = new Worker('releases', (job) => this.run(Job.parse(job.data)), {
      connection: this.workerConnection,
      prefix: 'verbis:jobs',
    });
    this.worker.on('error', () => undefined);
  }
  async run(job: z.infer<typeof Job>) {
    await requestContext.run(systemContext(job.id, 'release-worker'), () =>
      this.db.run(job.tenantId, async (tx) => {
        const ctx = requestContext.require();
        ctx.tx = tx;
        // Serialize duplicate/retried jobs before invoking the publication transition.
        await tx.$queryRaw`SELECT id FROM scheduled_releases WHERE id = ${job.id}::uuid AND tenant_id = ${job.tenantId}::uuid FOR UPDATE`;
        const row = await tx.scheduledRelease.findFirst({
          where: { id: job.id, tenantId: job.tenantId },
        });
        if (row?.state !== 'pending' || row.runAt.getTime() > Date.now()) return;
        ctx.principal = { type: 'user', id: row.requestedBy, tenantId: job.tenantId, scopes: [] };
        const tenant = await tx.tenant.findFirst({
          where: { id: job.tenantId, status: 'active', deletedAt: null },
          select: { settings: true },
        });
        const authz = tenant
          ? await this.abilities.forPrincipal(tx, ctx.principal, tenant.settings)
          : undefined;
        const version = await tx.scriptVersion.findFirst({
          where: {
            tenantId: job.tenantId,
            scriptId: row.scriptId,
            number: row.number,
            deletedAt: null,
          },
        });
        let blocked = !authz || version?.checksum !== row.checksum || version.state !== 'approved';
        if (authz) ctx.authz = authz;
        if (!blocked) {
          try {
            await this.lifecycle.publish(row.scriptId, row.number);
          } catch (error) {
            if (error instanceof DomainError) blocked = true;
            else throw error;
          }
        }
        await tx.scheduledRelease.updateMany({
          where: { id: row.id, tenantId: job.tenantId, state: 'pending' },
          data: { state: blocked ? 'blocked' : 'published', completedAt: new Date() },
        });
        await this.audit.record(tx, {
          action: blocked ? 'script.release.blocked' : 'script.release.executed',
          target: { type: 'Script', id: row.scriptId },
          metadata: { releaseId: row.id, number: row.number },
        });
      }),
    );
  }
  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
    this.workerConnection?.disconnect();
  }
}
