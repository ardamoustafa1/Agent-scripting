import { Logger } from '@nestjs/common';

import {
  backoffDelay,
  BackpressureError,
  type Connector,
  type ConnectorContext,
  type ConnectorHealth,
  type ConnectorHealthStatus,
} from '@verbis/sdk-connector';

import { apiAgentTokens } from '../connectors/genesys-engage/workspace/api-agent-tokens.js';
import { createConnector, type RegistryOptions } from '../connectors/registry.js';

import type { EventPipeline } from './event-pipeline.js';
import type { HubConnector, VerbisApi } from '../api/verbis-api.js';

export type InstanceState = 'starting' | 'running' | 'reconnecting' | 'stopped' | 'unsupported';

export interface ConnectorInstance {
  readonly connectorId: string;
  readonly slug: string;
  readonly tenantId: string;
  readonly version: number;
  readonly connector: Connector | undefined;
  state: InstanceState;
  attempts: number;
  health: ConnectorHealth | undefined;
}

export interface SupervisorOptions extends RegistryOptions {
  readonly healthIntervalMs: number;
  readonly refreshIntervalMs: number;
  readonly now?: () => Date;
  readonly random?: () => number;
}

const SECRET_TTL_MS = 5 * 60_000;

/**
 * Owns connector lifecycles: start (init with retry/backoff), periodic health with change reports
 * to the API, reconnect on `down`, config refresh (new/removed/updated connectors) and graceful
 * shutdown. One failing connector never affects others.
 */
export class ConnectorSupervisor {
  readonly #logger = new Logger(ConnectorSupervisor.name);
  readonly #instances = new Map<string, ConnectorInstance>();
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  #stopped = false;

  constructor(
    private readonly api: VerbisApi,
    private readonly pipeline: EventPipeline,
    private readonly options: SupervisorOptions,
  ) {}

  async start(): Promise<void> {
    await this.sync();
    this.#every(this.options.refreshIntervalMs, () => this.sync());
    this.#every(this.options.healthIntervalMs, () => this.checkHealth());
  }

  list(): readonly ConnectorInstance[] {
    return [...this.#instances.values()];
  }

  /** Instance of a tenant; another tenant's connector id is simply not found. */
  get(tenantId: string, connectorId: string): ConnectorInstance | undefined {
    const instance = this.#instances.get(connectorId);
    return instance?.tenantId === tenantId ? instance : undefined;
  }

  /** Public webhook ingress: the connector id alone selects it, the signature authenticates. */
  byId(connectorId: string): ConnectorInstance | undefined {
    return this.#instances.get(connectorId);
  }

  async sync(): Promise<void> {
    for (const slug of this.api.tenantSlugs()) {
      let connectors: HubConnector[];
      let tenantId: string;
      try {
        tenantId = await this.api.tenantIdOf(slug);
        connectors = await this.api.listConnectors(slug);
      } catch {
        this.#logger.warn(`Connector config refresh failed for tenant ${slug}`);
        continue;
      }
      const seen = new Set(connectors.map((c) => c.id));
      for (const [id, instance] of this.#instances)
        if (instance.slug === slug && !seen.has(id)) await this.stop(id);
      for (const definition of connectors) {
        const current = this.#instances.get(definition.id);
        if (current?.version === definition.version) continue;
        if (current !== undefined) await this.stop(definition.id);
        await this.launch(slug, tenantId, definition);
      }
    }
  }

  async launch(
    slug: string,
    tenantId: string,
    definition: HubConnector,
  ): Promise<ConnectorInstance> {
    const connector = createConnector(definition.adapterType, definition.config, {
      ...this.options,
      engageAgentTokens: (ctx) => apiAgentTokens(this.api, slug, ctx.connectorId),
    });
    const instance: ConnectorInstance = {
      connectorId: definition.id,
      slug,
      tenantId,
      version: definition.version,
      connector,
      state: connector === undefined ? 'unsupported' : 'starting',
      attempts: 0,
      health: undefined,
    };
    this.#instances.set(definition.id, instance);
    if (connector === undefined) {
      // Admins must see why nothing happens (e.g. a marketplace adapter without a bridge).
      await this.#report(instance, {
        status: 'down',
        detail: 'unsupported adapter on this hub',
        checkedAt: this.#now().toISOString(),
      });
      return instance;
    }
    const parsed = connector.configSchema.safeParse(definition.config);
    if (!parsed.success) {
      instance.state = 'stopped';
      await this.#report(instance, {
        status: 'down',
        detail: 'invalid configuration',
        checkedAt: this.#now().toISOString(),
      });
      return instance;
    }
    await this.#init(instance, connector, parsed.data);
    return instance;
  }

  async stop(connectorId: string): Promise<void> {
    const instance = this.#instances.get(connectorId);
    this.#instances.delete(connectorId);
    if (instance?.connector === undefined) return;
    instance.state = 'stopped';
    await instance.connector.shutdown().catch(() => undefined);
  }

  async checkHealth(): Promise<void> {
    for (const instance of this.#instances.values()) {
      if (instance.connector === undefined || instance.state !== 'running') continue;
      const health = await instance.connector.health().catch((): ConnectorHealth => ({
        status: 'down',
        detail: 'health check failed',
        checkedAt: this.#now().toISOString(),
      }));
      await this.#report(instance, health);
      if (health.status === 'down') await this.#reconnect(instance);
    }
  }

  async shutdown(): Promise<void> {
    this.#stopped = true;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    await Promise.all([...this.#instances.keys()].map((id) => this.stop(id)));
  }

  async #init(instance: ConnectorInstance, connector: Connector, config: unknown): Promise<void> {
    try {
      await connector.init(this.#context(instance, config));
      instance.state = 'running';
      instance.attempts = 0;
      await this.#report(instance, await connector.health());
    } catch {
      instance.state = 'reconnecting';
      await this.#report(instance, {
        status: 'down',
        detail: 'initialization failed',
        checkedAt: this.#now().toISOString(),
      });
      this.#retry(instance, connector, config);
    }
  }

  async #reconnect(instance: ConnectorInstance): Promise<void> {
    const connector = instance.connector;
    if (connector === undefined) return;
    instance.state = 'reconnecting';
    await connector.shutdown().catch(() => undefined);
    const parsed = connector.configSchema.safeParse(
      (await this.api.listConnectors(instance.slug).catch(() => [])).find(
        (c) => c.id === instance.connectorId,
      )?.config,
    );
    if (!parsed.success) return;
    this.#retry(instance, connector, parsed.data);
  }

  #retry(instance: ConnectorInstance, connector: Connector, config: unknown): void {
    if (this.#stopped) return;
    instance.attempts += 1;
    const delay = backoffDelay(instance.attempts, {
      baseMs: 1_000,
      maxMs: 120_000,
      ...(this.options.random === undefined ? {} : { random: this.options.random }),
    });
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      if (this.#instances.get(instance.connectorId) !== instance) return;
      void this.#init(instance, connector, config);
    }, delay);
    timer.unref();
    this.#timers.add(timer);
  }

  #context(instance: ConnectorInstance, config: unknown): ConnectorContext {
    let cache: { values: Record<string, string>; at: number } | undefined;
    const maxConcurrent = instance.connector?.capabilities.maxConcurrent ?? {};
    return {
      connectorId: instance.connectorId,
      tenantId: instance.tenantId,
      config,
      secrets: {
        get: async (name) => {
          if (cache === undefined || Date.now() - cache.at > SECRET_TTL_MS)
            cache = {
              values: await this.api.resolveSecrets(instance.slug, instance.connectorId),
              at: Date.now(),
            };
          const value = cache.values[name];
          if (value === undefined) throw new Error(`Secret ${name} is not configured`);
          return value;
        },
      },
      logger: {
        info: (message) => {
          this.#logger.log(`[${instance.connectorId}] ${message}`);
        },
        warn: (message) => {
          this.#logger.warn(`[${instance.connectorId}] ${message}`);
        },
        error: (message) => {
          this.#logger.error(`[${instance.connectorId}] ${message}`);
        },
      },
      now: () => this.#now(),
      emit: (event) => {
        try {
          this.pipeline.offer({
            slug: instance.slug,
            tenantId: instance.tenantId,
            connectorId: instance.connectorId,
            event,
            maxConcurrent,
          });
          return Promise.resolve();
        } catch (error) {
          return Promise.reject(
            error instanceof BackpressureError ? error : new BackpressureError('queue unavailable'),
          );
        }
      },
    };
  }

  async #report(instance: ConnectorInstance, health: ConnectorHealth): Promise<void> {
    const previous: ConnectorHealthStatus | undefined = instance.health?.status;
    instance.health = health;
    if (previous === health.status) return;
    await this.api
      .reportHealth(instance.slug, instance.connectorId, {
        status: health.status,
        ...(health.detail === undefined ? {} : { detail: health.detail }),
      })
      .catch(() => {
        this.#logger.warn(`Health report failed for ${instance.connectorId}`);
      });
  }

  #every(ms: number, fn: () => Promise<void>): void {
    const tick = () => {
      if (this.#stopped) return;
      const timer = setTimeout(() => {
        this.#timers.delete(timer);
        void fn().finally(tick);
      }, ms);
      timer.unref();
      this.#timers.add(timer);
    };
    tick();
  }

  #now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
