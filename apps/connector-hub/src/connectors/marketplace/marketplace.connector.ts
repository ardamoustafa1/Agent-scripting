import { z } from 'zod';

import {
  AttributesSchema,
  WrapUpSchema,
  CommandNotSupportedError,
  ConnectorError,
  PayloadRejectedError,
  UnknownInteractionError,
  MARKETPLACE_PROFILES,
  MarketplaceEnvelopeSchema,
  MarketplaceCommandSchema,
  parseInteractionEvent,
  canTransition,
  STATUS_OF_EVENT,
  type Attributes,
  type CommandTarget,
  type Connector,
  type ConnectorCapabilities,
  type ConnectorContext,
  type ConnectorHealth,
  type WrapUp,
  type MarketplacePlatform,
  type InteractionStatus,
  type InteractionEvent,
  type MarketplaceCommand,
} from '@verbis/sdk-connector';

import {
  NatsSidecarTransport,
  sidecarSubjects,
  type SidecarTransport,
} from '../shared/nats-sidecar-transport.js';

export const MarketplaceConfigSchema = z.strictObject({
  kind: z.string().min(1).max(32),
  nats: z.strictObject({
    servers: z
      .array(z.string().regex(/^tls:\/\/[A-Za-z0-9.-]+:\d{2,5}$/))
      .min(1)
      .max(10),
    stream: z
      .string()
      .regex(/^[A-Z0-9_]{1,64}$/)
      .default('VERBIS_MARKETPLACE'),
    requestTimeoutMs: z.number().int().min(500).max(30_000).default(5_000),
  }),
  attributeAllowList: z
    .array(z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/))
    .max(100)
    .default([]),
  routing: z.record(z.string().min(1).max(256), z.string().min(1).max(256)).default({}),
  participantTtlSeconds: z.number().int().min(5).max(300).default(60),
  secrets: z.record(z.string(), z.uuid()).optional(),
});

export interface MarketplaceDeps {
  readonly transport?: SidecarTransport;
  readonly autoStart?: boolean;
}
interface Live {
  status: InteractionStatus;
  agent: string | undefined;
  expiresAt: number;
}

/** SDK adapter over tenant-scoped authenticated bridges; command ACK follows vendor success. */
export class MarketplaceConnector implements Connector {
  readonly type;
  readonly kind;
  readonly capabilities: ConnectorCapabilities;
  readonly configSchema;
  #ctx: ConnectorContext | undefined;
  #config: z.infer<typeof MarketplaceConfigSchema> | undefined;
  #transport: SidecarTransport | undefined;
  readonly #live = new Map<string, Live>();
  readonly #seen = new Set<string>();
  readonly #sent = new Map<string, string>();
  #serial: Promise<unknown> = Promise.resolve();
  #commands: Promise<unknown> = Promise.resolve();

  constructor(
    readonly platform: MarketplacePlatform,
    private readonly deps: MarketplaceDeps = {},
  ) {
    const profile = MARKETPLACE_PROFILES[platform];
    this.type = profile.type;
    this.kind = profile.kind;
    this.capabilities = { channels: profile.channels, features: profile.features };
    this.configSchema = MarketplaceConfigSchema.extend({ kind: z.literal(profile.kind) });
  }

  async init(ctx: ConnectorContext): Promise<void> {
    if (this.#ctx !== undefined)
      throw new ConnectorError('Connector already running', 'already_running', false);
    const config = this.configSchema.parse(ctx.config);
    const creds = await ctx.secrets.get('natsCreds');
    this.#config = config;
    this.#ctx = ctx;
    this.#transport =
      this.deps.transport ??
      new NatsSidecarTransport({
        connectorId: ctx.connectorId,
        subjects: sidecarSubjects(this.platform, ctx.connectorId),
        nats: config.nats,
        creds,
        logger: ctx.logger,
      });
    try {
      if (this.deps.autoStart !== false)
        await this.#transport.start((payload) => this.ingest(payload).then(() => undefined));
    } catch (error) {
      await this.shutdown();
      throw error;
    }
  }

  health(): Promise<ConnectorHealth> {
    return Promise.resolve({
      status:
        this.#ctx === undefined ? 'down' : this.#transport?.connected === true ? 'up' : 'degraded',
      checkedAt: (this.#ctx?.now() ?? new Date()).toISOString(),
    });
  }

  async shutdown(): Promise<void> {
    const transport = this.#transport;
    this.#ctx = undefined;
    await transport?.stop();
    await Promise.allSettled([this.#serial, this.#commands]);
    this.#transport = undefined;
    this.#config = undefined;
    this.#live.clear();
    this.#seen.clear();
    this.#sent.clear();
  }

  ingest(payload: unknown): Promise<number> {
    const work = this.#serial.then(() => this.#ingest(payload));
    this.#serial = work.catch(() => undefined);
    return work;
  }

  async #ingest(payload: unknown): Promise<number> {
    const ctx = this.#require();
    const config = this.#config;
    if (config === undefined)
      throw new ConnectorError('Connector is not running', 'not_running', true);
    const parsed = MarketplaceEnvelopeSchema.safeParse(payload);
    if (!parsed.success) throw new PayloadRejectedError('invalid marketplace envelope');
    const envelope = parsed.data;
    if (
      envelope.platform !== this.platform ||
      !this.capabilities.channels.includes(envelope.event.channel)
    )
      throw new PayloadRejectedError('platform or channel mismatch');
    const profile = MARKETPLACE_PROFILES[this.platform];
    // The platform bridge supplies routing, never a browser-selected Verbis campaign or script.
    const {
      campaignRef: _campaign,
      attributes: _attributes,
      transferContext: _transfer,
      ...base
    } = envelope.event;
    const routingId = envelope.routingId;
    const mapped = routingId === undefined ? undefined : config.routing[routingId];
    const candidate = {
      ...base,
      attributes: Object.fromEntries(
        Object.entries(envelope.variables).filter(([key]) =>
          config.attributeAllowList.includes(key),
        ),
      ),
      ...(routingId === undefined
        ? {}
        : { campaignRef: { kind: profile.routing, externalId: mapped ?? routingId } }),
    };
    let event: InteractionEvent;
    try {
      event = parseInteractionEvent(candidate);
    } catch {
      throw new PayloadRejectedError('invalid normalized interaction');
    }
    const prior = this.#live.get(event.platformInteractionId);
    if (this.#seen.has(event.eventId) || !canTransition(prior?.status, STATUS_OF_EVENT[event.type]))
      return 0;
    await ctx.emit(event); // Backpressure leaves dedupe/state unchanged.
    this.#seen.add(event.eventId);
    if (this.#seen.size > 80_000) {
      const oldest = this.#seen.values().next();
      if (!oldest.done) this.#seen.delete(oldest.value);
    }
    this.#live.set(event.platformInteractionId, {
      status: STATUS_OF_EVENT[event.type],
      agent:
        event.type === 'ended'
          ? undefined
          : event.type === 'transferred'
            ? event.transferTo?.id
            : (event.agent?.id ?? prior?.agent),
      expiresAt:
        Math.min(ctx.now().getTime(), Date.parse(event.occurredAt)) +
        config.participantTtlSeconds * 1_000,
    });
    if (this.#live.size > 20_000) {
      const oldest = this.#live.keys().next();
      if (!oldest.done) this.#live.delete(oldest.value);
    }
    return 1;
  }

  async verifyParticipant(agent: string, interaction: string): Promise<boolean> {
    const ctx = this.#ctx;
    const live = this.#live.get(interaction);
    if (
      ctx === undefined ||
      this.#transport?.connected !== true ||
      live?.agent !== agent ||
      live.expiresAt <= ctx.now().getTime()
    )
      return false;
    try {
      const verified = await this.#transport.verify(agent, interaction);
      return (
        verified &&
        this.#ctx === ctx &&
        this.#live.get(interaction) === live &&
        live.expiresAt > ctx.now().getTime()
      );
    } catch {
      return false;
    }
  }

  writeAttributes(target: CommandTarget, input: Attributes): Promise<void> {
    return this.#dispatch('writeAttributes', target, { attributes: AttributesSchema.parse(input) });
  }
  setWrapUp(target: CommandTarget, input: WrapUp): Promise<void> {
    return this.#dispatch('setWrapUp', target, { wrapUp: WrapUpSchema.parse(input) });
  }
  pauseRecording(target: CommandTarget): Promise<void> {
    return this.#dispatch('pauseRecording', target);
  }
  resumeRecording(target: CommandTarget): Promise<void> {
    return this.#dispatch('resumeRecording', target);
  }

  #dispatch(
    type: MarketplaceCommand['type'],
    target: CommandTarget,
    body: { attributes?: Attributes; wrapUp?: WrapUp } = {},
  ): Promise<void> {
    const feature =
      type === 'writeAttributes'
        ? 'writeBack'
        : type === 'setWrapUp'
          ? 'wrapUpCodes'
          : 'recordingControl';
    if (!this.capabilities.features.includes(feature))
      return Promise.reject(new CommandNotSupportedError(type));
    const work = this.#commands.then(async () => {
      this.#require();
      if (!this.#live.has(target.platformInteractionId)) throw new UnknownInteractionError();
      const command = MarketplaceCommandSchema.parse({
        type,
        commandId: target.commandId,
        interactionId: target.platformInteractionId,
        platform: this.platform,
        ...body,
      });
      if (
        command.attributes !== undefined &&
        Object.keys(command.attributes).some(
          (key) => !this.#config?.attributeAllowList.includes(key),
        )
      )
        throw new ConnectorError('Attribute is not writable', 'attribute_not_allowed', false);
      const key = `${type}:${target.commandId}`;
      const fingerprint = JSON.stringify(command);
      const previous = this.#sent.get(key);
      if (previous !== undefined) {
        if (previous !== fingerprint)
          throw new ConnectorError('Command id reused', 'command_conflict', false);
        return;
      }
      if (this.#transport === undefined)
        throw new ConnectorError('Bridge unavailable', 'not_running', true);
      await this.#transport.send(command);
      this.#sent.set(key, fingerprint);
      if (this.#sent.size > 20_000) {
        const oldest = this.#sent.keys().next();
        if (!oldest.done) this.#sent.delete(oldest.value);
      }
    });
    this.#commands = work.catch(() => undefined);
    return work;
  }

  #require(): ConnectorContext {
    if (this.#ctx === undefined)
      throw new ConnectorError('Connector is not running', 'not_running', true);
    return this.#ctx;
  }
}
