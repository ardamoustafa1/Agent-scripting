import {
  type DynamicModule,
  Inject,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { HttpVerbisApi, VERBIS_API, type VerbisApi } from './api/verbis-api.js';
import { type HubEnv, HUB_ENV } from './env.js';
import { HealthController } from './health/health.controller.js';
import { HelloController } from './hello.controller.js';
import { InternalAuthGuard } from './http/internal-auth.guard.js';
import { InternalController } from './http/internal.controller.js';
import { WebhooksController } from './http/webhooks.controller.js';
import { ProblemDetailsFilter } from './problem.filter.js';
import { ConnectorSupervisor } from './runtime/connector-supervisor.js';
import { EventPipeline } from './runtime/event-pipeline.js';

export interface HubOverrides {
  /** Tests inject an in-memory API. */
  readonly api?: VerbisApi;
  /** Skip the background config sync (tests drive the supervisor directly). */
  readonly autoStart?: boolean;
}

export const HUB_AUTOSTART = Symbol('HUB_AUTOSTART');

@Module({})
export class AppModule implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(ConnectorSupervisor) private readonly supervisor: ConnectorSupervisor,
    @Inject(EventPipeline) private readonly pipeline: EventPipeline,
    @Inject(HUB_AUTOSTART) private readonly autoStart: boolean,
  ) {}

  static forRoot(env: HubEnv, overrides: HubOverrides = {}): DynamicModule {
    return {
      module: AppModule,
      controllers: [HelloController, HealthController, WebhooksController, InternalController],
      providers: [
        { provide: HUB_ENV, useValue: env },
        { provide: HUB_AUTOSTART, useValue: overrides.autoStart ?? env.HUB_TENANTS.length > 0 },
        { provide: VERBIS_API, useValue: overrides.api ?? new HttpVerbisApi(env) },
        {
          provide: EventPipeline,
          useFactory: (api: VerbisApi) =>
            new EventPipeline(api, {
              capacity: env.HUB_QUEUE_CAPACITY,
              concurrency: env.HUB_DELIVERY_CONCURRENCY,
            }),
          inject: [VERBIS_API],
        },
        {
          provide: ConnectorSupervisor,
          useFactory: (api: VerbisApi, pipeline: EventPipeline) =>
            new ConnectorSupervisor(api, pipeline, {
              simulatorEnabled: env.SIMULATOR_ENABLED && env.NODE_ENV !== 'production',
              healthIntervalMs: env.HUB_HEALTH_INTERVAL_SECONDS * 1_000,
              refreshIntervalMs: env.HUB_CONFIG_REFRESH_SECONDS * 1_000,
            }),
          inject: [VERBIS_API, EventPipeline],
        },
        InternalAuthGuard,
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.autoStart) await this.supervisor.start();
  }

  async onApplicationShutdown(): Promise<void> {
    // Stop intake, let queued events reach the API (bounded), then stop connectors.
    this.pipeline.close();
    await Promise.race([this.pipeline.drain(), new Promise((r) => setTimeout(r, 10_000).unref())]);
    await this.supervisor.shutdown();
  }
}
