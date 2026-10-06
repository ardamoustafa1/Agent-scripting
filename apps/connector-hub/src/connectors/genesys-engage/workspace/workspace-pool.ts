import type { ConnectorLogger } from '@verbis/sdk-connector';

import { WorkspaceSession, type AgentTokenSource } from './workspace-session.js';

import type { EngageAgent } from '../envelope.js';

/** Sessions per linked agent; the connector talks to agents only through this. */
export interface WorkspacePool {
  sync(): Promise<void>;
  stop(): Promise<void>;
  request(agentRef: string, method: 'GET' | 'POST', path: string, body: unknown): Promise<unknown>;
  isConnected(agentRef: string): boolean;
  readonly size: number;
  readonly down: number;
}

export interface WorkspacePoolDeps {
  readonly baseUrl: string;
  readonly channels: readonly string[];
  readonly tokens: AgentTokenSource;
  readonly fetch: typeof fetch;
  readonly logger: ConnectorLogger;
  readonly now: () => Date;
  readonly sleep: (ms: number) => Promise<void>;
  readonly random?: () => number;
  /** A notification from `agentRef`'s session plus the identity it initialized with. */
  readonly onMessage: (agentRef: string, agent: EngageAgent, message: unknown) => Promise<void>;
  /** Upper bound of concurrent agent sessions per connector (GWS capacity). */
  readonly maxSessions?: number;
}

/**
 * Opens a session for every agent the API reports as linked, closes sessions whose link is gone
 * (unlinked, expired, user deprovisioned). Called on start and on every config refresh tick.
 */
export class WorkspaceSessionPool implements WorkspacePool {
  readonly #sessions = new Map<string, { session: WorkspaceSession; agent: EngageAgent }>();

  constructor(private readonly deps: WorkspacePoolDeps) {}

  get size(): number {
    return this.#sessions.size;
  }

  get down(): number {
    return [...this.#sessions.values()].filter((s) => !s.session.connected).length;
  }

  async sync(): Promise<void> {
    const linked = new Set(
      (await this.deps.tokens.linkedAgents()).slice(0, this.deps.maxSessions ?? 2_000),
    );
    for (const [agentRef, entry] of this.#sessions)
      if (!linked.has(agentRef)) {
        this.#sessions.delete(agentRef);
        await entry.session.stop();
      }
    for (const agentRef of linked) {
      if (this.#sessions.has(agentRef)) continue;
      const entry: { session: WorkspaceSession; agent: EngageAgent } = {
        agent: {},
        session: undefined as unknown as WorkspaceSession,
      };
      entry.session = new WorkspaceSession({
        baseUrl: this.deps.baseUrl,
        platformUserId: agentRef,
        tokens: this.deps.tokens,
        channels: this.deps.channels,
        fetch: this.deps.fetch,
        logger: this.deps.logger,
        now: this.deps.now,
        sleep: this.deps.sleep,
        ...(this.deps.random === undefined ? {} : { random: this.deps.random }),
        onIdentity: (agent) => {
          entry.agent = agent;
        },
        onMessage: (message) => this.deps.onMessage(agentRef, entry.agent, message),
      });
      this.#sessions.set(agentRef, entry);
      await entry.session.start().catch((error: unknown) => {
        this.deps.logger.warn('engage workspace session failed to start', {
          reason: error instanceof Error ? error.message : 'unknown',
        });
        this.#sessions.delete(agentRef);
      });
    }
  }

  async stop(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.all(sessions.map((s) => s.session.stop()));
  }

  request(agentRef: string, method: 'GET' | 'POST', path: string, body: unknown): Promise<unknown> {
    const entry = this.#sessions.get(agentRef);
    if (entry === undefined) return Promise.reject(new Error('no session'));
    return entry.session.request(method, path, body);
  }

  isConnected(agentRef: string): boolean {
    return this.#sessions.get(agentRef)?.session.connected ?? false;
  }
}
