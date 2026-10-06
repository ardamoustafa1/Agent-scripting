import { z } from 'zod';

import {
  BackpressureError,
  ConnectorError,
  mapPlatformEvent,
  STATUS_OF_EVENT,
  type Attributes,
  type CommandTarget,
  type Connector,
  type ConnectorContext,
  type ConnectorHealth,
  type InteractionEvent,
  type InteractionStatus,
  type WrapUp,
} from '@verbis/sdk-connector';

import { InteractionState } from '../interaction-state.js';

import { GenesysCloudConfigSchema, topicsFor, type GenesysCloudConfig } from './config.js';
import { GenesysCloudClient, seg, type GenesysClientDeps } from './genesys-client.js';
import {
  agentLegs,
  attributeKey,
  ConversationSchema,
  createGenesysMapper,
  customerOf,
  dialerOf,
  inAfterCallWork,
  isAlerting,
  isConnected,
  type AgentLeg,
  type GenesysConversation,
} from './mapper.js';
import {
  NotificationChannel,
  shardTopics,
  type Scheduler,
  type SocketFactory,
} from './notifications.js';

export interface GenesysCloudDeps extends GenesysClientDeps {
  /** WebSocket factory; default Node's global `WebSocket`. `null` disables notifications (tests). */
  readonly socket?: SocketFactory | null;
  readonly scheduler?: Scheduler;
}

const ContactSchema = z.object({ data: z.record(z.string(), z.unknown()).default({}) });
const MembersSchema = z.object({
  entities: z.array(z.object({ id: z.string() })).default([]),
  pageCount: z.number().int().optional(),
});

/** Pending frames while the hub queue is full (bounded; overflow ⇒ resync by GET). */
const MAX_PENDING = 500;
const MAX_TRACKED = 20_000;

/**
 * Genesys Cloud connector (ADR-0008, docs/connectors/genesys-cloud.md).
 * - Events: Notifications API WebSocket (user + queue conversation topics), sharded ≤ 1,000 topics.
 * - Commands: participant attributes, wrap-up, secure pause; Platform API with Client Credentials.
 * - Secure launch: `verifyParticipant` asks the Conversations API — never cached, fail closed.
 */
export class GenesysCloudConnector implements Connector {
  readonly type = 'genesys-cloud' as const;
  readonly kind = 'cloud';
  readonly capabilities = {
    channels: ['voice', 'callback', 'chat', 'email', 'sms', 'whatsapp', 'social'] as const,
    features: ['writeBack', 'wrapUpCodes', 'recordingControl'] as const,
    maxConcurrent: { chat: 4, email: 2, sms: 4, whatsapp: 4, social: 4 },
  };
  readonly configSchema = GenesysCloudConfigSchema;

  readonly #state = new InteractionState();
  /** Last snapshot per conversation (for commands without an extra GET). */
  readonly #conversations = new Map<string, GenesysConversation>();
  readonly #holds = new Map<string, string>();
  readonly #sentCommands = new Set<string>();
  readonly #pending: unknown[] = [];
  readonly #resync = new Set<string>();
  #channels: NotificationChannel[] = [];
  #draining = false;
  #ctx: ConnectorContext | undefined;
  #config: GenesysCloudConfig | undefined;
  #client: GenesysCloudClient | undefined;
  #mapper = createGenesysMapper(
    { lastHoldStart: (c, p) => this.#holds.get(`${c}:${p}`) },
    () => this.#ctx?.now() ?? new Date(),
  );
  #lastEventAt: Date | undefined;
  #startError: string | undefined;

  constructor(private readonly deps: GenesysCloudDeps = {}) {}

  async init(ctx: ConnectorContext): Promise<void> {
    const config = GenesysCloudConfigSchema.parse(ctx.config);
    // Fail fast when the OAuth client is not configured.
    await ctx.secrets.get('clientId');
    await ctx.secrets.get('clientSecret');
    this.#config = config;
    this.#ctx = ctx;
    this.#client = new GenesysCloudClient(
      config.region,
      async () => ({
        clientId: await ctx.secrets.get('clientId'),
        clientSecret: await ctx.secrets.get('clientSecret'),
      }),
      { ...this.deps, now: this.deps.now ?? ctx.now },
    );
    if (this.deps.socket !== null) void this.#startNotifications();
  }

  health(): Promise<ConnectorHealth> {
    const checkedAt = (this.#ctx?.now() ?? new Date()).toISOString();
    if (this.#ctx === undefined) return Promise.resolve({ status: 'down', checkedAt });
    if (this.#startError !== undefined)
      return Promise.resolve({ status: 'degraded', checkedAt, detail: this.#startError });
    const down = this.#channels.filter((c) => !c.connected).length;
    if (down > 0)
      return Promise.resolve({
        status: 'degraded',
        checkedAt,
        detail: `${String(down)} notification channel(s) reconnecting`,
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
    for (const channel of this.#channels) channel.stop();
    this.#channels = [];
    this.#ctx = undefined;
    this.#state.clear();
    this.#conversations.clear();
    this.#holds.clear();
    this.#pending.length = 0;
    this.#resync.clear();
    return Promise.resolve();
  }

  /** Maps and emits one notification frame; returns the number of events accepted. */
  async ingest(frame: unknown): Promise<number> {
    const ctx = this.#require();
    const events = mapPlatformEvent(this.#mapper, frame);
    const conversation = (frame as { eventBody?: unknown }).eventBody;
    let accepted = 0;
    for (const raw of events) {
      if (!this.#accepts(raw)) continue;
      const event = await this.#enrich(raw, conversation);
      await ctx.emit(event);
      this.#record(event);
      this.#lastEventAt = ctx.now();
      accepted += 1;
    }
    const parsed = ConversationSchema.safeParse(conversation);
    if (parsed.success) this.#remember(parsed.data, events);
    return accepted;
  }

  async writeAttributes(target: CommandTarget, attributes: Attributes): Promise<void> {
    if (this.#sentCommands.has(target.commandId)) return;
    const conversation = await this.#conversation(target.platformInteractionId);
    const customer = customerOf(conversation);
    if (customer === undefined)
      throw new ConnectorError(
        'Conversation has no customer participant',
        'genesys_no_customer',
        false,
      );
    const prefix = this.#config?.attributePrefix ?? 'Verbis.';
    // Participant data values are strings in Genesys.
    const body = Object.fromEntries(
      Object.entries(attributes).map(([key, value]) => [
        `${prefix}${key}`,
        value === null ? '' : String(value),
      ]),
    );
    await this.#api().request(
      'PATCH',
      `/api/v2/conversations/${seg(conversation.id)}/participants/${seg(customer.id)}/attributes`,
      z.unknown(),
      { body: { attributes: body }, idempotent: true },
    );
    this.#sent(target.commandId);
  }

  async setWrapUp(target: CommandTarget, wrapUp: WrapUp): Promise<void> {
    if (this.#sentCommands.has(target.commandId)) return;
    const codeId = this.#wrapUpCodeId(wrapUp.code);
    const conversation = await this.#conversation(target.platformInteractionId);
    const leg = agentLegs(conversation).at(-1);
    if (leg === undefined)
      throw new ConnectorError('Conversation has no agent participant', 'genesys_no_agent', false);
    const notes = [
      wrapUp.subCodes.length > 0 ? `[${wrapUp.subCodes.join(', ')}]` : '',
      wrapUp.note ?? '',
    ]
      .filter((s) => s !== '')
      .join(' ');
    await this.#api().request(
      'POST',
      `/api/v2/conversations/${leg.media}/${seg(conversation.id)}/participants/${seg(leg.participant.id)}/communications/${seg(leg.communication.id)}/wrapup`,
      z.unknown(),
      {
        body: { code: codeId, ...(notes === '' ? {} : { notes: notes.slice(0, 4_000) }) },
        idempotent: true,
      },
    );
    this.#sent(target.commandId);
  }

  pauseRecording(target: CommandTarget): Promise<void> {
    return this.#recording(target, 'paused');
  }

  resumeRecording(target: CommandTarget): Promise<void> {
    return this.#recording(target, 'active');
  }

  /**
   * Secure-launch check (ADR-0017 embedded flow): fetches the conversation with the connector's
   * own credentials and requires a *current* agent leg of this user: connected (incl. held), in
   * pending after-call work (disconnected, wrap-up required, not yet applied), or alerting when
   * `verifyAlerting`. Not found ⇒ false; other errors propagate (the hub treats them as false).
   */
  async verifyParticipant(platformUserId: string, platformInteractionId: string): Promise<boolean> {
    if (this.#ctx === undefined) return false;
    let conversation: GenesysConversation;
    try {
      conversation = await this.#fetchConversation(platformInteractionId);
    } catch (error) {
      if (
        error instanceof ConnectorError &&
        (error.code === 'genesys_not_found' || error.code === 'genesys_bad_path')
      )
        return false;
      throw error;
    }
    const allowAlerting = this.#config?.verifyAlerting ?? false;
    return agentLegs(conversation).some(
      (leg) =>
        leg.participant.userId === platformUserId &&
        (isConnected(leg) ||
          inAfterCallWork(leg) ||
          (allowAlerting && leg.participant.endTime === undefined && isAlerting(leg))),
    );
  }

  /** Notification frame from a socket: retried locally under backpressure, never dropped silently. */
  onNotification(frame: unknown): void {
    if (this.#pending.length > 0) {
      this.#queue(frame);
      return;
    }
    this.ingest(frame).catch((error: unknown) => {
      if (error instanceof BackpressureError) this.#queue(frame);
      else
        this.#ctx?.logger.warn('genesys notification rejected', {
          reason: error instanceof Error ? error.message : 'unknown',
        });
    });
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  async #startNotifications(): Promise<void> {
    const ctx = this.#require();
    const config = this.#config;
    if (config === undefined) return;
    try {
      const members = config.subscribeQueueMembers ? await this.#queueMembers(config.queueIds) : [];
      const shards = shardTopics(topicsFor(config, members));
      const factory: SocketFactory = this.deps.socket ?? ((url: string) => new WebSocket(url));
      const scheduler = this.#scheduler();
      this.#channels = shards.map(
        () =>
          new NotificationChannel({
            client: this.#api(),
            region: config.region,
            socket: factory,
            scheduler,
            now: ctx.now,
            logger: ctx.logger,
            ...(this.deps.random === undefined ? {} : { random: this.deps.random }),
            onNotification: (frame) => {
              this.onNotification(frame);
            },
          }),
      );
      await Promise.all(this.#channels.map((channel, index) => channel.start(shards[index] ?? [])));
      this.#startError = undefined;
    } catch (error) {
      this.#startError = error instanceof Error ? error.message : 'notifications failed';
      ctx.logger.error('genesys notifications failed to start', { reason: this.#startError });
    }
  }

  async #queueMembers(queueIds: readonly string[]): Promise<string[]> {
    const ids = new Set<string>();
    for (const queueId of queueIds)
      for (let page = 1; page <= 50; page += 1) {
        const result = await this.#api().request(
          'GET',
          `/api/v2/routing/queues/${seg(queueId)}/members?pageSize=100&pageNumber=${String(page)}`,
          MembersSchema,
        );
        for (const member of result.entities) ids.add(member.id);
        if (result.pageCount === undefined || page >= result.pageCount) break;
      }
    return [...ids];
  }

  #queue(frame: unknown): void {
    if (this.#pending.length >= MAX_PENDING) {
      const dropped = this.#pending.shift();
      const id = (dropped as { eventBody?: { id?: unknown } } | undefined)?.eventBody?.id;
      if (typeof id === 'string') this.#resync.add(id);
    }
    this.#pending.push(frame);
    void this.#drain();
  }

  async #drain(attempt = 0): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (this.#ctx !== undefined && this.#pending.length > 0) {
        try {
          await this.ingest(this.#pending[0]);
        } catch (error) {
          if (error instanceof BackpressureError) {
            const delay = Math.min(5_000, 100 * 2 ** attempt);
            this.#draining = false;
            this.#scheduler().setTimeout(() => void this.#drain(attempt + 1), delay);
            return;
          }
        }
        this.#pending.shift();
      }
      for (const id of [...this.#resync]) {
        this.#resync.delete(id);
        const conversation = await this.#fetchConversation(id).catch(() => undefined);
        if (conversation !== undefined)
          await this.ingest({ topicName: 'resync', eventBody: conversation }).catch(
            () => undefined,
          );
      }
    } finally {
      this.#draining = false;
    }
  }

  async #enrich(event: InteractionEvent, body: unknown): Promise<InteractionEvent> {
    const config = this.#config;
    if (!config?.dialer.enabled) return event;
    if (event.type !== 'interactionOffered' && event.type !== 'connected') return event;
    if (config.dialer.contactColumns.length === 0 && !config.dialer.importAll) return event;
    const conversation = ConversationSchema.safeParse(body);
    const dialer = conversation.success ? dialerOf(conversation.data) : undefined;
    if (dialer?.contactListId === undefined || dialer.contactId === undefined) return event;
    const contact = await this.#api()
      .request(
        'GET',
        `/api/v2/outbound/contactlists/${seg(dialer.contactListId)}/contacts/${seg(dialer.contactId)}`,
        ContactSchema,
      )
      .catch((error: unknown) => {
        this.#ctx?.logger.warn('genesys dialer contact lookup failed', {
          code: error instanceof ConnectorError ? error.code : 'unknown',
        });
        return undefined;
      });
    if (contact === undefined) return event;
    const allowed = new Set(config.dialer.contactColumns);
    const attributes = { ...event.attributes };
    for (const [column, value] of Object.entries(contact.data)) {
      if (!config.dialer.importAll && !allowed.has(column)) continue;
      const key = attributeKey(`contact.${column}`);
      if (key === undefined) continue;
      if (typeof value === 'string') attributes[key] = value.slice(0, 1_000);
      else if (typeof value === 'number' || typeof value === 'boolean' || value === null)
        attributes[key] = value;
    }
    return { ...event, attributes };
  }

  /** New id, valid transition and an actual change (snapshots repeat across user + queue topics). */
  #accepts(event: InteractionEvent): boolean {
    if (!this.#state.accepts(event)) return false;
    const status: InteractionStatus | undefined = this.#state.status(event.platformInteractionId);
    return !(
      status === STATUS_OF_EVENT[event.type] &&
      event.type !== 'transferred' &&
      this.#state.isParticipant(event.agent?.id ?? '', event.platformInteractionId)
    );
  }

  #record(event: InteractionEvent): void {
    this.#state.record(event);
    const key = `${event.platformInteractionId}:${event.eventId.split(':')[1] ?? ''}`;
    if (event.type === 'held')
      this.#holds.set(key, event.eventId.split(':').slice(3).join(':') || 'na');
    if (event.type === 'ended')
      for (const k of [...this.#holds.keys()])
        if (k.startsWith(`${event.platformInteractionId}:`)) this.#holds.delete(k);
  }

  #remember(conversation: GenesysConversation, events: readonly InteractionEvent[]): void {
    if (events.some((e) => e.type === 'ended')) {
      this.#conversations.delete(conversation.id);
      return;
    }
    this.#conversations.delete(conversation.id);
    this.#conversations.set(conversation.id, conversation);
    if (this.#conversations.size > MAX_TRACKED) {
      const oldest = this.#conversations.keys().next();
      if (!oldest.done) this.#conversations.delete(oldest.value);
    }
  }

  async #conversation(id: string): Promise<GenesysConversation> {
    return this.#conversations.get(id) ?? (await this.#fetchConversation(id));
  }

  #fetchConversation(id: string): Promise<GenesysConversation> {
    if (!/^[A-Za-z0-9-]{1,128}$/.test(id))
      return Promise.reject(
        new ConnectorError('Invalid conversation id', 'genesys_bad_path', false),
      );
    return this.#api().request('GET', `/api/v2/conversations/${seg(id)}`, ConversationSchema);
  }

  async #recording(target: CommandTarget, state: 'paused' | 'active'): Promise<void> {
    if (this.#sentCommands.has(target.commandId)) return;
    const conversation = await this.#conversation(target.platformInteractionId);
    const voice = agentLegs(conversation).some((leg: AgentLeg) => leg.media === 'calls');
    if (!voice) {
      // Digital transcripts have no pausable recording; secure pause is a voice (PCI) control.
      this.#ctx?.logger.info('genesys secure pause skipped: not a voice conversation', {
        conversationId: conversation.id,
      });
      this.#sent(target.commandId);
      return;
    }
    await this.#api().request(
      'PATCH',
      `/api/v2/conversations/calls/${seg(conversation.id)}`,
      z.unknown(),
      {
        body: { recordingState: state },
        idempotent: true,
      },
    );
    this.#sent(target.commandId);
  }

  #scheduler(): Scheduler {
    return (
      this.deps.scheduler ?? {
        setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
        clearTimeout: (handle: unknown) => {
          clearTimeout(handle as NodeJS.Timeout);
        },
      }
    );
  }

  #wrapUpCodeId(code: string): string {
    const mapped = this.#config?.wrapUpCodes[code];
    if (mapped !== undefined) return mapped;
    if (z.uuid().safeParse(code).success) return code;
    throw new ConnectorError(
      `Wrap-up code ${code} is not mapped to a Genesys wrap-up code`,
      'genesys_wrapup_unmapped',
      false,
    );
  }

  #sent(commandId: string): void {
    this.#sentCommands.add(commandId);
    if (this.#sentCommands.size > MAX_TRACKED) {
      const oldest = this.#sentCommands.values().next();
      if (!oldest.done) this.#sentCommands.delete(oldest.value);
    }
  }

  #api(): GenesysCloudClient {
    if (this.#client === undefined || this.#ctx === undefined)
      throw new ConnectorError('Connector is not running', 'not_running', true);
    return this.#client;
  }

  #require(): ConnectorContext {
    if (this.#ctx === undefined)
      throw new ConnectorError('Connector is not running', 'not_running', true);
    return this.#ctx;
  }
}
