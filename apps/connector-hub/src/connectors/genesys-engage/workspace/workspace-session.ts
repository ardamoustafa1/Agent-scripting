import { z } from 'zod';

import {
  backoffDelay,
  BackpressureError,
  ConnectorError,
  type ConnectorLogger,
} from '@verbis/sdk-connector';

import type { EngageAgent } from '../envelope.js';

export interface AgentToken {
  readonly accessToken: string;
  /** Epoch ms. */
  readonly expiresAt: number;
}

/** Delegated agent tokens, vended by the API (the agent linked once; ADR-0019). */
export interface AgentTokenSource {
  /** Platform user ids (configured agent identity) with a live link for this connector. */
  linkedAgents(): Promise<string[]>;
  token(platformUserId: string): Promise<AgentToken>;
}

export interface WorkspaceSessionDeps {
  readonly baseUrl: string;
  readonly platformUserId: string;
  readonly tokens: AgentTokenSource;
  readonly channels: readonly string[];
  readonly fetch: typeof fetch;
  readonly logger: ConnectorLogger;
  readonly now: () => Date;
  readonly sleep: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly onIdentity: (agent: EngageAgent) => void;
  readonly onMessage: (message: unknown) => Promise<void>;
}

const BayeuxReply = z.array(
  z.looseObject({
    channel: z.string(),
    successful: z.boolean().optional(),
    clientId: z.string().optional(),
    data: z.unknown().optional(),
    advice: z.looseObject({ reconnect: z.string().optional() }).optional(),
  }),
);
const InitData = z.looseObject({
  data: z.looseObject({
    state: z.string().optional(),
    user: z
      .looseObject({
        employeeId: z.string().optional(),
        userName: z.string().optional(),
        agentLogin: z.string().optional(),
        defaultPlace: z.string().optional(),
      })
      .optional(),
  }),
});

const SUBSCRIPTIONS = [
  '/workspace/v3/initialization',
  '/workspace/v3/voice',
  '/workspace/v3/media',
];
const MAX_ATTEMPTS = 4;

/**
 * One agent's Workspace API v3 session: initialize-workspace (cookie session) → CometD
 * handshake/subscribe/connect long-poll loop → activate-channels. Only the agent's own events
 * arrive here. The hub never changes agent state (no ready/not-ready/logout requests).
 */
export class WorkspaceSession {
  #cookie: string | undefined;
  #clientId: string | undefined;
  #stopped = false;
  #loop: Promise<void> | undefined;
  #attempt = 0;
  #connected = false;
  #token: { value: string; expiresAt: number } | undefined;

  constructor(private readonly deps: WorkspaceSessionDeps) {}

  get connected(): boolean {
    return this.#connected;
  }

  async start(): Promise<void> {
    this.#stopped = false;
    await this.#open();
    this.#loop = this.#poll();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#connected = false;
    const clientId = this.#clientId;
    if (clientId !== undefined)
      await this.#bayeux([{ channel: '/meta/disconnect', clientId }]).catch(() => undefined);
    await this.request('POST', '/workspace/v3/logout', undefined).catch(() => undefined);
    await this.#loop?.catch(() => undefined);
  }

  /** Authenticated REST call in this agent's session; 401 refreshes the delegated token once, 429/5xx retry. */
  async request(method: 'GET' | 'POST', path: string, body: unknown): Promise<unknown> {
    if (!path.startsWith('/workspace/v3/'))
      throw new ConnectorError('Invalid Workspace path', 'engage_bad_path', false);
    let refreshed = false;
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.#send(
        method,
        path,
        body === undefined ? undefined : JSON.stringify(body),
      );
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        this.#token = undefined;
        attempt -= 1;
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt + 1 < MAX_ATTEMPTS) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await this.deps.sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter, 60) * 1_000
            : backoffDelay(attempt, this.#backoff()),
        );
        continue;
      }
      if (!response.ok)
        throw new ConnectorError(
          `Workspace API responded ${String(response.status)}`,
          response.status === 404 ? 'engage_not_found' : 'engage_failed',
          response.status >= 500 || response.status === 429,
        );
      return response.status === 204 ? null : await response.json().catch(() => null);
    }
  }

  async #open(): Promise<void> {
    this.#cookie = undefined;
    this.#clientId = undefined;
    await this.request('POST', '/workspace/v3/initialize-workspace', undefined);
    const handshake = await this.#bayeux([
      {
        channel: '/meta/handshake',
        version: '1.0',
        minimumVersion: '1.0',
        supportedConnectionTypes: ['long-polling'],
      },
    ]);
    const clientId = handshake.find(
      (m) => m.channel === '/meta/handshake' && m.successful === true,
    )?.clientId;
    if (clientId === undefined)
      throw new ConnectorError('CometD handshake failed', 'engage_cometd_failed', true);
    this.#clientId = clientId;
    for (const subscription of SUBSCRIPTIONS)
      await this.#bayeux([{ channel: '/meta/subscribe', clientId, subscription }]);
    await this.request('POST', '/workspace/v3/activate-channels', {
      data: { channels: this.deps.channels },
    });
    this.#connected = true;
    this.#attempt = 0;
  }

  async #poll(): Promise<void> {
    while (!this.#stopped) {
      try {
        const clientId = this.#clientId;
        if (clientId === undefined)
          throw new ConnectorError('No CometD client', 'engage_cometd_failed', true);
        const messages = await this.#bayeux([
          { channel: '/meta/connect', clientId, connectionType: 'long-polling' },
        ]);
        for (const message of messages) {
          if (message.channel === '/meta/connect') {
            if (message.successful === false && message.advice?.reconnect === 'handshake')
              throw new ConnectorError('CometD rehandshake', 'engage_cometd_failed', true);
            continue;
          }
          if (message.channel === '/workspace/v3/initialization') {
            const init = InitData.safeParse(message);
            const user = init.success ? init.data.data.user : undefined;
            if (user !== undefined)
              this.deps.onIdentity({
                ...(user.employeeId === undefined ? {} : { employeeId: user.employeeId }),
                ...(user.userName === undefined ? {} : { userName: user.userName }),
                ...(user.agentLogin === undefined ? {} : { agentLoginId: user.agentLogin }),
                ...(user.defaultPlace === undefined ? {} : { place: user.defaultPlace }),
              });
            continue;
          }
          if (message.channel.startsWith('/meta/')) continue;
          await this.#deliver(message);
        }
      } catch (error) {
        if (this.#isStopped()) return;
        this.#connected = false;
        const delay = backoffDelay(this.#attempt, {
          baseMs: 1_000,
          maxMs: 60_000,
          ...(this.deps.random === undefined ? {} : { random: this.deps.random }),
        });
        this.#attempt += 1;
        this.deps.logger.warn('engage workspace session reconnecting', {
          reason: error instanceof Error ? error.message : 'unknown',
          delayMs: delay,
        });
        await this.deps.sleep(delay);
        if (this.#isStopped()) return;
        await this.#open().catch(() => undefined);
      }
    }
  }

  #isStopped(): boolean {
    return this.#stopped;
  }

  /** Hub queue full ⇒ wait and retry the same message (long-poll pauses meanwhile); never dropped. */
  async #deliver(message: unknown): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.deps.onMessage(message);
        return;
      } catch (error) {
        if (!(error instanceof BackpressureError) || this.#stopped) {
          if (!(error instanceof BackpressureError))
            this.deps.logger.warn('engage workspace message rejected', {
              reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
            });
          return;
        }
        await this.deps.sleep(Math.min(5_000, 100 * 2 ** attempt));
      }
    }
  }

  async #bayeux(messages: unknown[]): Promise<z.infer<typeof BayeuxReply>> {
    const response = await this.#send(
      'POST',
      '/workspace/v3/notifications',
      JSON.stringify(messages),
    );
    if (!response.ok)
      throw new ConnectorError(
        `CometD responded ${String(response.status)}`,
        'engage_cometd_failed',
        true,
      );
    const parsed = BayeuxReply.safeParse(await response.json().catch(() => null));
    if (!parsed.success)
      throw new ConnectorError('Unexpected CometD reply', 'engage_cometd_failed', true);
    return parsed.data;
  }

  async #send(method: string, path: string, body: string | undefined): Promise<Response> {
    let response: Response;
    try {
      response = await this.deps.fetch(new URL(path, this.deps.baseUrl).toString(), {
        method,
        headers: {
          authorization: `Bearer ${await this.#accessToken()}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(this.#cookie === undefined ? {} : { cookie: this.#cookie }),
        },
        ...(body === undefined ? {} : { body }),
        redirect: 'error',
        // Long-poll connects are held up to ~30 s by the server.
        signal: AbortSignal.timeout(path === '/workspace/v3/notifications' ? 45_000 : 10_000),
      });
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError('Workspace API unreachable', 'engage_unavailable', true);
    }
    const setCookie = response.headers.get('set-cookie');
    // Session affinity cookie(s) only; never logged.
    if (setCookie !== null)
      this.#cookie = setCookie
        .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
        .map((c) => c.split(';')[0]?.trim())
        .filter(Boolean)
        .join('; ');
    return response;
  }

  async #accessToken(): Promise<string> {
    if (this.#token !== undefined && this.#token.expiresAt - 30_000 > this.deps.now().getTime())
      return this.#token.value;
    const token = await this.deps.tokens.token(this.deps.platformUserId);
    this.#token = { value: token.accessToken, expiresAt: token.expiresAt };
    return token.accessToken;
  }

  #backoff() {
    return {
      baseMs: 500,
      maxMs: 15_000,
      ...(this.deps.random === undefined ? {} : { random: this.deps.random }),
    };
  }
}
