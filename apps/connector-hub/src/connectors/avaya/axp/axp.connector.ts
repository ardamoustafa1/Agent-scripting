import { z } from 'zod';

import {
  CommandNotSupportedError,
  ConnectorError,
  mapPlatformEvent,
  STATUS_OF_EVENT,
  UnknownInteractionError,
  type CommandTarget,
  type Connector,
  type ConnectorContext,
  type ConnectorHealth,
  type InteractionEvent,
  type WrapUp,
} from '@verbis/sdk-connector';

import { InteractionState } from '../../interaction-state.js';
import { RecordingHook } from '../../shared/recording-hook.js';

import { AxpClient, type AxpCredentials } from './axp-client.js';
import { AxpNotificationStream } from './axp-notifications.js';
import { AxpConfigSchema, type AxpConfig } from './config.js';
import { createAxpMapper } from './mapper.js';

import type { Scheduler, SocketFactory } from '../../genesys-cloud/notifications.js';

export interface AxpDeps {
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  /** `null` disables the notification stream (fixture tests drive `ingest`). */
  readonly socket?: SocketFactory | null;
  readonly scheduler?: Scheduler;
}

/** Engagement as read for verification (fields: docs/connectors/avaya.md §AXP, assumption A5). */
const EngagementSchema = z.looseObject({
  engagementId: z.string().optional(),
  state: z.string().optional(),
  participants: z
    .array(
      z.looseObject({
        type: z.string().optional(),
        participantType: z.string().optional(),
        loginId: z.string().optional(),
        agentId: z.string().optional(),
        state: z.string().optional(),
        participantId: z.string().optional(),
      }),
    )
    .max(100)
    .default([]),
});

const LIVE = new Set(['ACTIVE', 'CONNECTED', 'HELD', 'ACW', 'AFTER_CONTACT_WORK', 'WRAP_UP']);

/**
 * Avaya Experience Platform connector (`avaya_axp`, kind `workspaces`).
 * - Agents work in AXP Workspaces; the Verbis custom widget (infra/avaya-axp/widget) frames
 *   agent-web `/launch#connector=…&conversation=<interactionId>` — embedded flow, re-verified here.
 * - Events: Notification API WebSocket (`AGENT_ENGAGEMENT`).
 * - Wrap-up: disposition through the Interactions API; secure pause: recording-system hook.
 */
export class AxpConnector implements Connector {
  readonly type = 'avaya-axp' as const;
  readonly kind = 'workspaces';
  readonly capabilities = {
    channels: ['voice', 'chat', 'email', 'sms', 'whatsapp', 'social'] as const,
    features: ['wrapUpCodes', 'recordingControl'] as const,
    maxConcurrent: { chat: 4, email: 3, sms: 4, whatsapp: 4, social: 4 },
  };
  readonly configSchema = AxpConfigSchema;

  readonly #state = new InteractionState();
  readonly #channels = new Map<string, InteractionEvent['channel']>();
  readonly #sent = new Set<string>();
  #ctx: ConnectorContext | undefined;
  #config: AxpConfig | undefined;
  #client: AxpClient | undefined;
  #stream: AxpNotificationStream | undefined;
  #recording: RecordingHook | undefined;
  #mapper = createAxpMapper(
    () => {
      if (this.#config === undefined)
        throw new ConnectorError('Connector is not running', 'not_running', true);
      return this.#config;
    },
    () => this.#ctx?.now() ?? new Date(),
  );
  #lastEventAt: Date | undefined;

  constructor(private readonly deps: AxpDeps = {}) {}

  async init(ctx: ConnectorContext): Promise<void> {
    const config = AxpConfigSchema.parse(ctx.config);
    const credentials = async (): Promise<AxpCredentials> => ({
      clientId: await ctx.secrets.get('clientId'),
      clientSecret: await ctx.secrets.get('clientSecret'),
      appKey: await ctx.secrets.get('appKey'),
    });
    await credentials(); // fail fast
    this.#config = config;
    this.#ctx = ctx;
    this.#client = new AxpClient(config, credentials, {
      ...(this.deps.fetch === undefined ? {} : { fetch: this.deps.fetch }),
      now: ctx.now,
      ...(this.deps.sleep === undefined ? {} : { sleep: this.deps.sleep }),
      ...(this.deps.random === undefined ? {} : { random: this.deps.random }),
    });
    if (config.recording !== undefined)
      this.#recording = new RecordingHook(
        config.recording,
        () => ctx.secrets.get('recorderSecret'),
        ctx.now,
        this.deps.fetch ?? fetch,
      );
    if (this.deps.socket === null) return;
    this.#stream = new AxpNotificationStream({
      client: this.#client,
      accountId: config.accountId,
      socket: this.deps.socket ?? ((url: string) => new WebSocket(url)),
      scheduler: this.deps.scheduler ?? {
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (h) => {
          clearTimeout(h as NodeJS.Timeout);
        },
      },
      logger: ctx.logger,
      ...(this.deps.random === undefined ? {} : { random: this.deps.random }),
      onNotification: (frame) => {
        this.ingest(frame).catch((error: unknown) => {
          ctx.logger.warn('axp notification not ingested', {
            reason: error instanceof Error ? error.name : 'unknown',
          });
        });
      },
    });
    void this.#stream.start().catch((error: unknown) => {
      ctx.logger.error('axp notifications failed to start', {
        reason: error instanceof Error ? error.message : 'unknown',
      });
    });
  }

  health(): Promise<ConnectorHealth> {
    const checkedAt = (this.#ctx?.now() ?? new Date()).toISOString();
    if (this.#ctx === undefined) return Promise.resolve({ status: 'down', checkedAt });
    if (this.#stream !== undefined && !this.#stream.connected)
      return Promise.resolve({
        status: 'degraded',
        checkedAt,
        detail: 'notification stream reconnecting',
      });
    return Promise.resolve({
      status: 'up',
      checkedAt,
      detail:
        this.#lastEventAt === undefined
          ? 'no events yet'
          : `last event ${this.#lastEventAt.toISOString()}`,
    });
  }

  shutdown(): Promise<void> {
    this.#stream?.stop();
    this.#stream = undefined;
    this.#ctx = undefined;
    this.#state.clear();
    return Promise.resolve();
  }

  async ingest(frame: unknown): Promise<number> {
    const ctx = this.#require();
    let accepted = 0;
    for (const event of mapPlatformEvent(this.#mapper, frame)) {
      if (!this.#state.accepts(event)) continue;
      // REMOVED and AfterContactWorkActivated both mean wrap-up: emit once.
      if (
        this.#state.status(event.platformInteractionId) === STATUS_OF_EVENT[event.type] &&
        event.type !== 'transferred'
      )
        continue;
      await ctx.emit(event);
      this.#state.record(event);
      this.#channels.set(event.platformInteractionId, event.channel);
      if (this.#channels.size > 20_000) {
        const oldest = this.#channels.keys().next();
        if (!oldest.done) this.#channels.delete(oldest.value);
      }
      this.#lastEventAt = ctx.now();
      accepted += 1;
    }
    return accepted;
  }

  writeAttributes(): Promise<void> {
    return Promise.reject(new CommandNotSupportedError('writeAttributes'));
  }

  /** Disposition + notes on the interaction (AXP requires it to be out of Connected state). */
  async setWrapUp(target: CommandTarget, wrapUp: WrapUp): Promise<void> {
    if (this.#sent.has(target.commandId)) return;
    const config = this.#configOrThrow();
    if (!this.#channels.has(target.platformInteractionId)) throw new UnknownInteractionError();
    const notes = [
      wrapUp.subCodes.length > 0 ? `[${wrapUp.subCodes.join(', ')}]` : '',
      wrapUp.note ?? '',
    ]
      .filter((s) => s !== '')
      .join(' ');
    await this.#api().request(
      'POST',
      `/api/interactions/v1/accounts/${encodeURIComponent(config.accountId)}/interactions/${encodeURIComponent(target.platformInteractionId)}/wrapup`,
      z.unknown(),
      {
        dispositionCode: config.dispositionCodes[wrapUp.code] ?? wrapUp.code,
        ...(notes === '' ? {} : { notes: notes.slice(0, 4_000) }),
      },
      true,
    );
    this.#sent.add(target.commandId);
    if (this.#sent.size > 20_000) {
      const oldest = this.#sent.values().next().value;
      if (oldest !== undefined) this.#sent.delete(oldest);
    }
  }

  pauseRecording(target: CommandTarget): Promise<void> {
    return this.#record('pause', target);
  }

  resumeRecording(target: CommandTarget): Promise<void> {
    return this.#record('resume', target);
  }

  /**
   * Embedded launch (ADR-0017 b): the widget's interaction id is only a hint. Reads the
   * engagement with the connector's own credentials (no cache) and requires a live agent
   * participant with this login/agent id. Not found ⇒ false; outages propagate (fail closed).
   */
  async verifyParticipant(platformUserId: string, platformInteractionId: string): Promise<boolean> {
    const config = this.#config;
    if (
      this.#ctx === undefined ||
      config === undefined ||
      !/^[A-Za-z0-9._:@-]{1,128}$/.test(platformInteractionId)
    )
      return false;
    let engagement: z.infer<typeof EngagementSchema>;
    try {
      engagement = await this.#api().request(
        'GET',
        `/api/engagement/v1/accounts/${encodeURIComponent(config.accountId)}/engagements/${encodeURIComponent(platformInteractionId)}`,
        EngagementSchema,
      );
    } catch (error) {
      if (error instanceof ConnectorError && error.code === 'axp_not_found') return false;
      throw error;
    }
    const live = new Set(config.verifyInvited ? [...LIVE, 'INVITED', 'ALERTING'] : LIVE);
    return engagement.participants.some((p) => {
      const isAgent = (p.type ?? p.participantType ?? '').toUpperCase() === 'AGENT';
      const id = config.agentIdentity === 'loginId' ? p.loginId : p.agentId;
      return isAgent && id === platformUserId && live.has((p.state ?? '').toUpperCase());
    });
  }

  async #record(action: 'pause' | 'resume', target: CommandTarget): Promise<void> {
    const channel = this.#channels.get(target.platformInteractionId);
    if (channel === undefined) throw new UnknownInteractionError();
    if (channel !== 'voice') return;
    if (this.#recording === undefined)
      throw new ConnectorError('No recording system configured', 'recorder_not_configured', false);
    await this.#recording.send(action, target.commandId, {
      interactionId: target.platformInteractionId,
    });
  }

  #api(): AxpClient {
    if (this.#client === undefined || this.#ctx === undefined)
      throw new ConnectorError('Connector is not running', 'not_running', true);
    return this.#client;
  }

  #configOrThrow(): AxpConfig {
    if (this.#config === undefined || this.#ctx === undefined)
      throw new ConnectorError('Connector is not running', 'not_running', true);
    return this.#config;
  }

  #require(): ConnectorContext {
    if (this.#ctx === undefined)
      throw new ConnectorError('Connector is not running', 'not_running', true);
    return this.#ctx;
  }
}
