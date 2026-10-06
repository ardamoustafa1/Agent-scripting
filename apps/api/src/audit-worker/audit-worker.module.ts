import {
  type DynamicModule,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import pg from 'pg';

import { type ApiEnv, API_ENV } from '../env.js';
import { InfraModule } from '../infra/infra.module.js';
import { S3WormClient } from '../modules/audit/archive/s3-worm.client.js';
import { AuditRepository } from '../modules/audit/audit.repository.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { CheckpointSigner } from '../modules/audit/core/checkpoint-signer.js';

import { PartitionLifecycleJob, WORM_CLIENT } from './archive.job.js';
import { CHECKPOINT_SIGNER, CheckpointJob } from './checkpoint.job.js';
import { DomainEventAuditHandler } from './domain-event-audit.handler.js';
import { IntervalJob } from './interval-job.js';
import { EnvSecretResolver } from './secret-resolver.js';
import { SECRET_RESOLVER, SiemDispatcher } from './siem.dispatcher.js';

export class WorkerConfigError extends Error {
  override readonly name = 'WorkerConfigError';
}

/** Worker env: its own DB role; no outbox relay (the API runs it); consumers on. */
export function workerEnv(env: ApiEnv): ApiEnv {
  if (env.AUDIT_WORKER_DATABASE_URL === undefined) {
    throw new WorkerConfigError('AUDIT_WORKER_DATABASE_URL is required for the audit worker');
  }
  if (env.AUDIT_CHECKPOINT_SIGNING_JWK === undefined) {
    throw new WorkerConfigError('AUDIT_CHECKPOINT_SIGNING_JWK is required for the audit worker');
  }
  return {
    ...env,
    DATABASE_APP_URL: env.AUDIT_WORKER_DATABASE_URL,
    OUTBOX_RELAY_ENABLED: false,
    EVENT_CONSUMERS_ENABLED: true,
  };
}

/** Starts the jobs and wakes SIEM delivery on `NOTIFY verbis_audit_appended`. */
@Injectable()
export class AuditWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly #logger = new Logger(AuditWorkerService.name);
  readonly jobs: IntervalJob[];
  readonly #siem: IntervalJob;
  #listener: pg.Client | undefined;
  #stopped = false;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(CheckpointJob) checkpoints: CheckpointJob,
    @Inject(SiemDispatcher) siem: SiemDispatcher,
    @Inject(PartitionLifecycleJob) partitions: PartitionLifecycleJob,
  ) {
    this.#siem = new IntervalJob('siem', 2_000, () => siem.tick());
    this.jobs = [
      new IntervalJob('partitions', 3_600_000, () => partitions.tick()),
      new IntervalJob('checkpoints', env.AUDIT_CHECKPOINT_INTERVAL_SECONDS * 1000, () =>
        checkpoints.tick(),
      ),
      this.#siem,
    ];
  }

  onApplicationBootstrap(): void {
    for (const job of this.jobs) job.start();
    void this.#listen();
  }

  async #listen(): Promise<void> {
    if (this.#stopped) return;
    const client = new pg.Client({ connectionString: this.env.DATABASE_APP_URL });
    client.on('notification', () => {
      this.#siem.wake();
    });
    client.on('error', () => {
      this.#listener = undefined;
      if (!this.#stopped) setTimeout(() => void this.#listen(), 5_000).unref();
    });
    try {
      await client.connect();
      await client.query('LISTEN verbis_audit_appended');
      this.#listener = client;
    } catch {
      this.#logger.warn('LISTEN failed; SIEM falls back to polling, retrying in 5s');
      await client.end().catch(() => undefined);
      setTimeout(() => void this.#listen(), 5_000).unref();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.#stopped = true;
    for (const job of this.jobs) job.stop();
    await this.#listener?.end().catch(() => undefined);
  }
}

@Module({})
export class AuditWorkerModule {
  static forRoot(env: ApiEnv): DynamicModule {
    const resolved = workerEnv(env);
    const signer = CheckpointSigner.fromJwk(
      resolved.AUDIT_CHECKPOINT_SIGNING_JWK ?? '',
      resolved.AUDIT_CHECKPOINT_JWKS,
    );
    const s3 = resolved.AUDIT_ARCHIVE_S3_ENDPOINT;
    const worm =
      s3 !== undefined &&
      resolved.AUDIT_ARCHIVE_S3_BUCKET !== undefined &&
      resolved.AUDIT_ARCHIVE_S3_ACCESS_KEY_ID !== undefined &&
      resolved.AUDIT_ARCHIVE_S3_SECRET_ACCESS_KEY !== undefined
        ? new S3WormClient({
            endpoint: s3,
            region: resolved.AUDIT_ARCHIVE_S3_REGION,
            bucket: resolved.AUDIT_ARCHIVE_S3_BUCKET,
            accessKeyId: resolved.AUDIT_ARCHIVE_S3_ACCESS_KEY_ID,
            secretAccessKey: resolved.AUDIT_ARCHIVE_S3_SECRET_ACCESS_KEY,
            mode: resolved.AUDIT_ARCHIVE_LOCK_MODE,
          })
        : undefined;
    return {
      module: AuditWorkerModule,
      imports: [InfraModule.forRoot(resolved)],
      providers: [
        AuditService,
        AuditRepository,
        DomainEventAuditHandler,
        CheckpointJob,
        SiemDispatcher,
        PartitionLifecycleJob,
        AuditWorkerService,
        { provide: CHECKPOINT_SIGNER, useValue: signer },
        { provide: SECRET_RESOLVER, useValue: new EnvSecretResolver() },
        ...(worm === undefined ? [] : [{ provide: WORM_CLIENT, useValue: worm }]),
      ],
    };
  }
}
