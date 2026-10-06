import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  CHANNEL_TYPES,
  ConnectorError,
  defineMapper,
  mapPlatformEvent,
  type Attributes,
  type ChannelContext,
  type ChannelType,
  type CommandTarget,
  type Connector,
  type ConnectorContext,
  type ConnectorHealth,
  type InteractionEventInput,
  type InteractionEventType,
  type WrapUp,
} from '@verbis/sdk-connector';

import { InteractionState } from '../interaction-state.js';

/**
 * Interaction Simulator: a fully functional connector for development and demos. admin-web's
 * "Interaction Simulator" (via the API) creates fake calls/chats/emails… and drives them through
 * the lifecycle; commands the runtime sends back are recorded and shown. Never enabled in
 * production (registry + API guard).
 */
export const SimulatorConfigSchema = z.strictObject({
  kind: z.literal('simulator'),
  secrets: z.record(z.string(), z.uuid()).optional(),
  maxConcurrent: z.partialRecord(z.enum(CHANNEL_TYPES), z.number().int().min(1).max(50)).optional(),
});

const Attr = z.union([z.string().max(256), z.number(), z.boolean()]);
export const SimCreateSchema = z.strictObject({
  channel: z.enum(CHANNEL_TYPES),
  direction: z.enum(['inbound', 'outbound']).default('inbound'),
  agentPlatformUserId: z.string().min(1).max(256),
  agentEmail: z.email().max(320).optional(),
  queue: z.string().max(128).optional(),
  customerName: z.string().max(256).optional(),
  customerAddress: z.string().max(320).optional(),
  subject: z.string().max(1_000).optional(),
  message: z.string().max(8_000).optional(),
  attributes: z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/), Attr).default({}),
  autoConnect: z.boolean().default(false),
});
export const SimActionSchema = z.strictObject({
  action: z.enum(['connect', 'hold', 'resume', 'transfer', 'customerMessage', 'wrapup', 'end']),
  message: z.string().max(8_000).optional(),
  transferToPlatformUserId: z.string().min(1).max(256).optional(),
});

/** The simulator's "platform payload" (what the UI sends), also used as recorded fixtures. */
export const SimPayloadSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('create'),
    requestId: z.string().min(1).max(128),
    at: z.iso.datetime({ offset: true }),
    platformInteractionId: z.string().regex(/^sim-[A-Za-z0-9-]{1,64}$/),
    input: SimCreateSchema,
  }),
  z.strictObject({
    op: z.literal('action'),
    requestId: z.string().min(1).max(128),
    at: z.iso.datetime({ offset: true }),
    platformInteractionId: z.string().regex(/^sim-[A-Za-z0-9-]{1,64}$/),
    input: SimActionSchema,
  }),
]);
export type SimPayload = z.infer<typeof SimPayloadSchema>;

export interface SimInteraction {
  platformInteractionId: string;
  channel: ChannelType;
  direction: 'inbound' | 'outbound';
  agentPlatformUserId: string;
  agentEmail?: string | undefined;
  queue?: string | undefined;
  status: 'alerting' | 'connected' | 'held' | 'transferred' | 'wrapup' | 'ended';
  context: ChannelContext;
  attributes: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
}

export interface SimCommand {
  commandId: string;
  command: string;
  platformInteractionId: string;
  payload: Record<string, unknown>;
  at: string;
}

const DEFAULT_LIMITS: Record<ChannelType, number> = {
  voice: 1,
  video: 1,
  callback: 1,
  chat: 3,
  email: 2,
  sms: 3,
  whatsapp: 3,
  social: 3,
};

function contextFor(input: z.infer<typeof SimCreateSchema>, at: string): ChannelContext {
  const name = input.customerName ?? 'Demo Müşteri';
  const address = input.customerAddress ?? '+905550000000';
  const message = input.message ?? 'Merhaba, yardıma ihtiyacım var.';
  switch (input.channel) {
    case 'voice':
      return { channel: 'voice', ani: address, dnis: '4440000', ivrPath: ['main'] };
    case 'chat':
      return {
        channel: 'chat',
        customerName: name,
        entryPoint: 'simulator',
        transcript: [{ from: 'customer', text: message, at }],
      };
    case 'email':
      return {
        channel: 'email',
        from: input.customerAddress ?? 'musteri@example.com',
        to: ['destek@example.com'],
        subject: input.subject ?? 'Destek talebi',
        body: message,
        attachments: [],
      };
    case 'sms':
      return { channel: 'sms', from: address, messages: [{ from: 'customer', text: message, at }] };
    case 'whatsapp':
      return {
        channel: 'whatsapp',
        from: address,
        profileName: name,
        messages: [{ from: 'customer', text: message, at }],
      };
    case 'social':
      return {
        channel: 'social',
        network: 'x',
        handle: `@${name.replaceAll(/\s+/g, '').toLowerCase().slice(0, 30) || 'musteri'}`,
        message,
        isPublic: false,
      };
    case 'video':
      return {
        channel: 'video',
        roomId: `room-${at.slice(11, 19).replaceAll(':', '')}`,
        customerName: name,
      };
    case 'callback':
      return { channel: 'callback', number: address, reason: message };
  }
}

function appendMessage(context: ChannelContext, text: string, at: string): ChannelContext {
  const msg = { from: 'customer' as const, text, at };
  switch (context.channel) {
    case 'chat':
      return { ...context, transcript: [...context.transcript, msg].slice(-500) };
    case 'sms':
    case 'whatsapp':
      return { ...context, messages: [...context.messages, msg].slice(-500) };
    case 'social':
      return { ...context, message: text };
    case 'email':
      return { ...context, body: `${context.body}\n\n${text}`.slice(-100_000) };
    default:
      return context;
  }
}

export class SimulatorConnector implements Connector {
  readonly type = 'generic' as const;
  readonly kind = 'simulator';
  readonly capabilities = {
    channels: CHANNEL_TYPES,
    features: ['writeBack', 'wrapUpCodes', 'recordingControl', 'transferContext'] as const,
    maxConcurrent: { chat: 3, email: 2, sms: 3, whatsapp: 3, social: 3 },
  };
  readonly configSchema = SimulatorConfigSchema;
  readonly #state = new InteractionState();
  readonly #interactions = new Map<string, SimInteraction>();
  readonly #commands: SimCommand[] = [];
  readonly #requests = new Set<string>();
  #limits: Record<ChannelType, number> = { ...DEFAULT_LIMITS };
  #ctx: ConnectorContext | undefined;

  readonly #mapper = defineMapper<SimPayload>({
    name: 'simulator',
    payloadSchema: SimPayloadSchema,
    map: (payload) => this.#apply(payload),
  });

  init(ctx: ConnectorContext): Promise<void> {
    const config = SimulatorConfigSchema.parse(ctx.config);
    this.#limits = { ...DEFAULT_LIMITS, ...config.maxConcurrent };
    this.#ctx = ctx;
    return Promise.resolve();
  }

  health(): Promise<ConnectorHealth> {
    return Promise.resolve({
      status: this.#ctx === undefined ? 'down' : 'up',
      checkedAt: (this.#ctx?.now() ?? new Date()).toISOString(),
      ...(this.#ctx === undefined
        ? {}
        : { detail: `${String(this.#active().length)} active simulated interactions` }),
    });
  }

  shutdown(): Promise<void> {
    this.#ctx = undefined;
    this.#interactions.clear();
    this.#state.clear();
    this.#requests.clear();
    return Promise.resolve();
  }

  // ─── control API (admin-web via API → hub) ──────────────────────────────────

  async create(input: unknown): Promise<SimInteraction> {
    const ctx = this.#require();
    const platformInteractionId = `sim-${randomUUID()}`;
    const at = ctx.now().toISOString();
    await this.ingest({ op: 'create', requestId: randomUUID(), at, platformInteractionId, input });
    const parsed = SimCreateSchema.parse(input);
    if (parsed.autoConnect)
      await this.ingest({
        op: 'action',
        requestId: randomUUID(),
        at,
        platformInteractionId,
        input: { action: 'connect' },
      });
    return this.#get(platformInteractionId);
  }

  async act(platformInteractionId: string, input: unknown): Promise<SimInteraction> {
    const ctx = this.#require();
    const interaction = this.#get(platformInteractionId);
    await this.ingest({
      op: 'action',
      requestId: randomUUID(),
      at: ctx.now().toISOString(),
      platformInteractionId,
      input,
    });
    return this.#interactions.get(platformInteractionId) ?? interaction;
  }

  snapshot(): { interactions: SimInteraction[]; commands: SimCommand[] } {
    return { interactions: [...this.#interactions.values()], commands: this.#commands.slice(-200) };
  }

  /** "Platform" ingress: validates, applies to simulated platform state, emits normalized events. */
  async ingest(payload: unknown): Promise<number> {
    const ctx = this.#require();
    const requestId = (payload as { requestId?: unknown } | null)?.requestId;
    if (typeof requestId === 'string' && this.#requests.has(requestId)) return 0;
    const pid = (payload as { platformInteractionId?: unknown } | null)?.platformInteractionId;
    const before =
      typeof pid === 'string' ? structuredClone(this.#interactions.get(pid)) : undefined;
    const events = mapPlatformEvent(this.#mapper, payload);
    let accepted = 0;
    try {
      for (const event of events) {
        if (!this.#state.accepts(event)) continue;
        await ctx.emit(event);
        this.#state.record(event);
        accepted += 1;
      }
    } catch (error) {
      // Refused downstream (backpressure): undo the simulated platform change so a retry re-emits.
      if (typeof pid === 'string') {
        if (before === undefined) this.#interactions.delete(pid);
        else this.#interactions.set(pid, before);
      }
      throw error;
    }
    if (typeof requestId === 'string') this.#requests.add(requestId);
    return accepted;
  }

  // ─── commands (recorded so the UI can show what the script wrote back) ──────

  writeAttributes(target: CommandTarget, attributes: Attributes): Promise<void> {
    return this.#command(target, 'writeAttributes', { attributes });
  }
  setWrapUp(target: CommandTarget, wrapUp: WrapUp): Promise<void> {
    return this.#command(target, 'setWrapUp', { ...wrapUp });
  }
  pauseRecording(target: CommandTarget): Promise<void> {
    return this.#command(target, 'pauseRecording', {});
  }
  resumeRecording(target: CommandTarget): Promise<void> {
    return this.#command(target, 'resumeRecording', {});
  }

  verifyParticipant(platformUserId: string, platformInteractionId: string): Promise<boolean> {
    return Promise.resolve(
      this.#ctx !== undefined && this.#state.isParticipant(platformUserId, platformInteractionId),
    );
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  #apply(payload: SimPayload): InteractionEventInput | null {
    if (payload.op === 'create') {
      if (this.#interactions.has(payload.platformInteractionId)) return null;
      const input = payload.input;
      const load = this.#active().filter(
        (i) => i.agentPlatformUserId === input.agentPlatformUserId && i.channel === input.channel,
      ).length;
      if (load >= this.#limits[input.channel])
        throw new ConnectorError(
          `Agent already has ${String(load)} ${input.channel} interactions`,
          'agent_at_capacity',
          false,
        );
      const interaction: SimInteraction = {
        platformInteractionId: payload.platformInteractionId,
        channel: input.channel,
        direction: input.direction,
        agentPlatformUserId: input.agentPlatformUserId,
        agentEmail: input.agentEmail,
        queue: input.queue,
        status: 'alerting',
        context: contextFor(input, payload.at),
        attributes: {
          ...input.attributes,
          ...(input.customerName === undefined ? {} : { customerName: input.customerName }),
        },
        createdAt: payload.at,
        updatedAt: payload.at,
      };
      this.#interactions.set(interaction.platformInteractionId, interaction);
      return this.#event(interaction, 'interactionOffered', payload.requestId, payload.at);
    }
    const interaction = this.#interactions.get(payload.platformInteractionId);
    if (interaction === undefined) return null;
    const { action, message, transferToPlatformUserId } = payload.input;
    const next: Record<typeof action, InteractionEventType | null> = {
      connect: 'connected',
      hold: 'held',
      resume: 'resumed',
      transfer: 'transferred',
      customerMessage: interaction.status === 'connected' ? 'connected' : null,
      wrapup: 'wrapupRequired',
      end: 'ended',
    };
    if (action === 'customerMessage' && message !== undefined)
      interaction.context = appendMessage(interaction.context, message, payload.at);
    if (action === 'transfer') {
      if (transferToPlatformUserId === undefined)
        throw new ConnectorError('transferToPlatformUserId is required', 'invalid_action', false);
      interaction.agentPlatformUserId = transferToPlatformUserId;
      interaction.agentEmail = undefined;
    }
    const type = next[action];
    if (type === null) return null;
    interaction.status = (
      {
        connected: 'connected',
        held: 'held',
        resumed: 'connected',
        transferred: 'transferred',
        wrapupRequired: 'wrapup',
        ended: 'ended',
        interactionOffered: 'alerting',
      } as const
    )[type];
    interaction.updatedAt = payload.at;
    const event = this.#event(interaction, type, payload.requestId, payload.at);
    if (type === 'ended') this.#interactions.delete(interaction.platformInteractionId);
    return event;
  }

  #event(
    i: SimInteraction,
    type: InteractionEventType,
    requestId: string,
    at: string,
  ): InteractionEventInput {
    const agent = {
      id: i.agentPlatformUserId,
      ...(i.agentEmail === undefined ? {} : { email: i.agentEmail }),
    };
    return {
      eventId: `sim-${requestId}`,
      type,
      occurredAt: at,
      platformInteractionId: i.platformInteractionId,
      channel: i.channel,
      direction: i.direction,
      ...(type === 'transferred'
        ? { transferTo: agent, transferContext: { simulated: true } }
        : { agent }),
      ...(i.queue === undefined ? {} : { queue: i.queue }),
      ...(i.queue?.length ? { campaignRef: { kind: 'queue' as const, externalId: i.queue } } : {}),
      attributes: { ...i.attributes, simulated: true },
      context: i.context,
    };
  }

  async #command(
    target: CommandTarget,
    command: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const ctx = this.#require();
    if (this.#commands.some((c) => c.commandId === target.commandId)) return;
    this.#commands.push({
      commandId: target.commandId,
      command,
      platformInteractionId: target.platformInteractionId,
      payload,
      at: ctx.now().toISOString(),
    });
    if (this.#commands.length > 1_000) this.#commands.shift();
    await Promise.resolve();
  }

  #active(): SimInteraction[] {
    return [...this.#interactions.values()].filter((i) => i.status !== 'ended');
  }

  #get(id: string): SimInteraction {
    const interaction = this.#interactions.get(id);
    if (interaction === undefined)
      throw new ConnectorError('Unknown simulated interaction', 'interaction_unknown', false);
    return interaction;
  }

  #require(): ConnectorContext {
    if (this.#ctx === undefined)
      throw new ConnectorError('Simulator is not running', 'not_running', true);
    return this.#ctx;
  }
}
