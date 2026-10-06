import {
  CommandNotSupportedError,
  ConnectorError,
  mapPlatformEvent,
  UnknownInteractionError,
  type Attributes,
  type CommandTarget,
  type Connector,
  type ConnectorCapabilities,
  type ConnectorContext,
  type ConnectorHealth,
  type WrapUp,
} from '@verbis/sdk-connector';

import { InteractionState } from '../interaction-state.js';
import { NatsSidecarTransport, type SidecarTransport } from '../shared/nats-sidecar-transport.js';
import { RecordingHook } from '../shared/recording-hook.js';

import { avayaSubjects, AvayaSidecarConfigSchema, type AvayaSidecarConfig } from './config.js';
import {
  AvayaCommandSchema,
  AvayaEnvelopeSchema,
  type AvayaCommandInput,
  type AvayaEnvelope,
} from './envelope.js';
import { agentKey, createAvayaMapper } from './mapper.js';

export interface AvayaSidecarDeps {
  readonly sidecar?: SidecarTransport;
  readonly fetch?: typeof fetch;
  /** false ⇒ the transport is not started by `init` (fixture tests drive `ingest`). */
  readonly autoStart?: boolean;
}

interface Known {
  readonly envelope: AvayaEnvelope;
}

const MAX_KNOWN = 20_000;

/**
 * Avaya Aura AES (`avaya_aes`) and Avaya Aura Contact Center (`avaya_aacc`) through the Avaya
 * sidecar (ADR-0020). One class, two platforms: capabilities differ (AES cannot write data back
 * into a live call; AACC writes contact intrinsics through CCMM).
 * - wrap-up: AACC activity code / closed reason; outbound (POM / Proactive Contact) completion
 *   code; otherwise the recording system is tagged (when configured).
 * - secure pause: recording-system hook (UCID-keyed).
 */
export class AvayaSidecarConnector implements Connector {
  readonly kind = 'sidecar';
  readonly capabilities: ConnectorCapabilities;
  readonly configSchema = AvayaSidecarConfigSchema;

  readonly #state = new InteractionState();
  readonly #known = new Map<string, Known>();
  readonly #sent = new Set<string>();
  #ctx: ConnectorContext | undefined;
  #config: AvayaSidecarConfig | undefined;
  #sidecar: SidecarTransport | undefined;
  #recording: RecordingHook | undefined;
  #mapper = createAvayaMapper(() => {
    if (this.#config === undefined)
      throw new ConnectorError('Connector is not running', 'not_running', true);
    return this.#config;
  });
  #lastEventAt: Date | undefined;

  constructor(
    readonly type: 'avaya-aes' | 'avaya-aacc',
    private readonly deps: AvayaSidecarDeps = {},
  ) {
    this.capabilities =
      type === 'avaya-aes'
        ? { channels: ['voice'] as const, features: ['wrapUpCodes', 'recordingControl'] as const }
        : {
            channels: ['voice', 'email', 'chat', 'sms', 'social'] as const,
            features: ['writeBack', 'wrapUpCodes', 'recordingControl'] as const,
            maxConcurrent: { email: 3, chat: 3, sms: 3, social: 3 },
          };
  }

  async init(ctx: ConnectorContext): Promise<void> {
    const config = AvayaSidecarConfigSchema.parse(ctx.config);
    this.#config = config;
    this.#ctx = ctx;
    if (config.recording !== undefined) {
      await ctx.secrets.get('recorderSecret');
      this.#recording = new RecordingHook(
        config.recording,
        () => ctx.secrets.get('recorderSecret'),
        ctx.now,
        this.deps.fetch ?? fetch,
      );
    }
    const creds = await ctx.secrets.get('natsCreds').catch(() => undefined);
    this.#sidecar =
      this.deps.sidecar ??
      new NatsSidecarTransport({
        connectorId: ctx.connectorId,
        subjects: avayaSubjects(ctx.connectorId),
        nats: config.nats,
        logger: ctx.logger,
        ...(creds === undefined ? {} : { creds }),
      });
    if (this.deps.autoStart !== false)
      await this.#sidecar.start((payload) => this.ingest(payload).then(() => undefined));
  }

  health(): Promise<ConnectorHealth> {
    const checkedAt = (this.#ctx?.now() ?? new Date()).toISOString();
    if (this.#ctx === undefined) return Promise.resolve({ status: 'down', checkedAt });
    if (this.deps.autoStart !== false && this.#sidecar?.connected !== true)
      return Promise.resolve({ status: 'degraded', checkedAt, detail: 'sidecar link down' });
    return Promise.resolve({
      status: 'up',
      checkedAt,
      detail:
        this.#lastEventAt === undefined
          ? 'no events yet'
          : `last event ${this.#lastEventAt.toISOString()}`,
    });
  }

  async shutdown(): Promise<void> {
    const sidecar = this.#sidecar;
    this.#ctx = undefined;
    this.#sidecar = undefined;
    this.#state.clear();
    if (this.deps.autoStart !== false) await sidecar?.stop().catch(() => undefined);
  }

  async ingest(payload: unknown): Promise<number> {
    const ctx = this.#require();
    const events = mapPlatformEvent(this.#mapper, payload);
    const envelope = AvayaEnvelopeSchema.parse(payload);
    if (envelope.source !== (this.type === 'avaya-aes' ? 'aes' : 'aacc'))
      throw new ConnectorError(
        'Envelope from the wrong Avaya platform',
        'avaya_wrong_source',
        false,
      );
    this.#remember(envelope);
    let accepted = 0;
    for (const event of events) {
      if (!this.#state.accepts(event)) continue;
      await ctx.emit(event);
      this.#state.record(event);
      this.#lastEventAt = ctx.now();
      accepted += 1;
    }
    return accepted;
  }

  async writeAttributes(target: CommandTarget, attributes: Attributes): Promise<void> {
    if (this.type === 'avaya-aes') throw new CommandNotSupportedError('writeAttributes');
    const known = this.#knownOrThrow(target.platformInteractionId);
    const intrinsics = Object.fromEntries(
      Object.entries(attributes).map(([k, v]) => [k.slice(0, 64), v === null ? '' : String(v)]),
    );
    await this.#dispatch({
      type: 'setIntrinsics',
      commandId: target.commandId,
      interactionId: known.envelope.interactionId,
      intrinsics,
    });
  }

  async setWrapUp(target: CommandTarget, wrapUp: WrapUp): Promise<void> {
    const config = this.#configOrThrow();
    const { envelope } = this.#knownOrThrow(target.platformInteractionId);
    const note = [
      wrapUp.subCodes.length > 0 ? `[${wrapUp.subCodes.join(', ')}]` : '',
      wrapUp.note ?? '',
    ]
      .filter((s) => s !== '')
      .join(' ');
    if (envelope.outbound !== undefined)
      await this.#dispatch({
        type: 'outboundResult',
        commandId: `${target.commandId}:outbound`,
        interactionId: envelope.interactionId,
        system: envelope.outbound.system,
        campaign: envelope.outbound.campaign,
        recordId: envelope.outbound.recordId,
        completionCode: config.outbound.completionCodes[wrapUp.code] ?? wrapUp.code,
        ...(envelope.agent === undefined ? {} : { agent: envelope.agent }),
      });
    if (this.type === 'avaya-aacc')
      await this.#dispatch({
        type: 'disposition',
        commandId: `${target.commandId}:disposition`,
        interactionId: envelope.interactionId,
        mediaType: envelope.mediaType,
        code: config.dispositionCodes[wrapUp.code] ?? wrapUp.code,
        ...(note === '' ? {} : { note: note.slice(0, 4_000) }),
        ...(envelope.agent === undefined ? {} : { agent: envelope.agent }),
      });
    else if (envelope.outbound === undefined && this.#recording !== undefined)
      // Aura inbound: no switch-side disposition store; tag the recording with the outcome.
      await this.#recording.send('tag', `${target.commandId}:tag`, this.#call(envelope), {
        outcome: wrapUp.code.slice(0, 128),
      });
  }

  pauseRecording(target: CommandTarget): Promise<void> {
    return this.#record('pause', target);
  }

  resumeRecording(target: CommandTarget): Promise<void> {
    return this.#record('resume', target);
  }

  /** s2s: the connector's event state and the sidecar's own AES/AACC view must agree. */
  async verifyParticipant(platformUserId: string, platformInteractionId: string): Promise<boolean> {
    if (
      this.#ctx === undefined ||
      this.#sidecar === undefined ||
      !this.#state.isParticipant(platformUserId, platformInteractionId)
    )
      return false;
    return this.#sidecar.verify(platformUserId, platformInteractionId);
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  async #record(action: 'pause' | 'resume', target: CommandTarget): Promise<void> {
    const { envelope } = this.#knownOrThrow(target.platformInteractionId);
    if (envelope.mediaType !== 'voice') return; // nothing to pause on digital channels
    if (this.#recording === undefined)
      throw new ConnectorError('No recording system configured', 'recorder_not_configured', false);
    await this.#recording.send(action, target.commandId, this.#call(envelope));
  }

  #call(envelope: AvayaEnvelope) {
    const config = this.#configOrThrow();
    return {
      interactionId: envelope.interactionId,
      ucid: envelope.ucid,
      agent: agentKey(envelope.agent, config.agentIdentity),
      extension: envelope.agent?.extension,
    };
  }

  async #dispatch(input: AvayaCommandInput): Promise<void> {
    if (this.#sent.has(input.commandId)) return;
    const sidecar = this.#sidecar;
    if (sidecar === undefined)
      throw new ConnectorError('Connector is not running', 'not_running', true);
    await sidecar.send(AvayaCommandSchema.parse(input));
    this.#sent.add(input.commandId);
    if (this.#sent.size > MAX_KNOWN) {
      const oldest = this.#sent.values().next();
      if (!oldest.done) this.#sent.delete(oldest.value);
    }
  }

  #remember(envelope: AvayaEnvelope): void {
    const previous = this.#known.get(envelope.interactionId)?.envelope;
    const merged: AvayaEnvelope = {
      ...envelope,
      agent:
        envelope.event === 'transferred'
          ? (envelope.transferTo ?? envelope.agent)
          : (envelope.agent ?? previous?.agent),
      outbound: envelope.outbound ?? previous?.outbound,
      ucid: envelope.ucid ?? previous?.ucid,
    };
    this.#known.delete(envelope.interactionId);
    this.#known.set(envelope.interactionId, { envelope: merged });
    if (this.#known.size > MAX_KNOWN) {
      const oldest = this.#known.keys().next();
      if (!oldest.done) this.#known.delete(oldest.value);
    }
  }

  #knownOrThrow(id: string): Known {
    const known = this.#known.get(id);
    if (known === undefined) throw new UnknownInteractionError();
    return known;
  }

  #configOrThrow(): AvayaSidecarConfig {
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
