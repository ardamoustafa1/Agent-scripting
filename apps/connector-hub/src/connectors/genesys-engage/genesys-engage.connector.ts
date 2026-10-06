import { z } from 'zod';

import {
  CommandNotSupportedError,
  ConnectorError,
  mapPlatformEvent,
  PayloadRejectedError,
  UnknownInteractionError,
  type Attributes,
  type CommandTarget,
  type Connector,
  type ConnectorContext,
  type ConnectorHealth,
  type WrapUp,
} from '@verbis/sdk-connector';

import { InteractionState } from '../interaction-state.js';
import { NatsSidecarTransport, type SidecarTransport } from '../shared/nats-sidecar-transport.js';

import { engageSubjects, GenesysEngageConfigSchema, type GenesysEngageConfig } from './config.js';
import {
  EngageEnvelopeSchema,
  type EngageAgent,
  type EngageCommandInput,
  EngageCommandSchema,
  type EngageEnvelope,
} from './envelope.js';
import { agentKey, createEngageMapper, recordHandleOf } from './mapper.js';
import { ocsUserData } from './ocs.js';
import { WorkspaceTranslator } from './workspace/workspace-events.js';
import { WorkspaceSessionPool, type WorkspacePool } from './workspace/workspace-pool.js';

import type { AgentTokenSource } from './workspace/workspace-session.js';

export interface GenesysEngageDeps {
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  /** Delegated agent tokens (workspace mode), provided by the hub from the API per connector. */
  readonly agentTokens?: (ctx: ConnectorContext) => AgentTokenSource;
  /** Overrides for tests. */
  readonly pool?: WorkspacePool;
  readonly sidecar?: SidecarTransport;
  /** false ⇒ transports are not started by `init` (fixture tests drive `ingest`). */
  readonly autoStart?: boolean;
}

/** Workspace-mode test/transport payload: a CometD message from one agent's session. */
const WorkspacePayloadSchema = z.strictObject({
  workspace: z.strictObject({
    agentRef: z.string().min(1).max(256),
    agent: z.record(z.string(), z.string().max(128)).default({}),
    message: z.unknown(),
  }),
});

interface Known {
  readonly mediaType: EngageEnvelope['mediaType'];
  agent: EngageAgent | undefined;
  agentRef: string | undefined;
  recordHandle: number | undefined;
  campaignName: string | undefined;
  applicationId: number | undefined;
}

const MAX_KNOWN = 20_000;
const SYNC_INTERVAL_MS = 60_000;

/**
 * Genesys Engage (PureEngage) on-prem connector — no WDE (ADR-0008, ADR-0019).
 * - `kind: workspace`: Workspace API v3 / GWS, one session per linked agent (delegated token).
 * - `kind: sidecar`: Platform SDK sidecar (T-Server, Interaction Server, OCS) over NATS.
 * Both produce `EngageEnvelope`s, mapped once. Launch is server-to-server (pipeline → launch
 * intent push on `connected`): the agent keeps Verbis open with SSO and the script opens itself.
 */
export class GenesysEngageConnector implements Connector {
  readonly type = 'genesys-engage' as const;
  readonly capabilities = {
    channels: ['voice', 'chat', 'email', 'sms', 'whatsapp', 'social'] as const,
    features: ['writeBack', 'wrapUpCodes'] as const,
    maxConcurrent: { chat: 3, email: 3, sms: 3, whatsapp: 3, social: 3 },
  };
  readonly configSchema = GenesysEngageConfigSchema;

  readonly #state = new InteractionState();
  readonly #known = new Map<string, Known>();
  readonly #translators = new Map<string, WorkspaceTranslator>();
  readonly #sent = new Set<string>();
  #ctx: ConnectorContext | undefined;
  #config: GenesysEngageConfig | undefined;
  #pool: WorkspacePool | undefined;
  #sidecar: SidecarTransport | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #mapper = createEngageMapper(() => {
    if (this.#config === undefined)
      throw new ConnectorError('Connector is not running', 'not_running', true);
    return this.#config;
  });
  #lastEventAt: Date | undefined;

  constructor(
    readonly kind: 'workspace' | 'sidecar',
    private readonly deps: GenesysEngageDeps = {},
  ) {}

  async init(ctx: ConnectorContext): Promise<void> {
    const config = GenesysEngageConfigSchema.parse(ctx.config);
    if (config.kind !== this.kind)
      throw new ConnectorError('Config kind does not match the connector', 'engage_config', false);
    this.#config = config;
    this.#ctx = ctx;
    const sleep =
      this.deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    if (config.kind === 'sidecar') {
      const creds = await ctx.secrets.get('natsCreds').catch(() => undefined);
      this.#sidecar =
        this.deps.sidecar ??
        new NatsSidecarTransport({
          connectorId: ctx.connectorId,
          subjects: engageSubjects(ctx.connectorId),
          nats: config.nats,
          logger: ctx.logger,
          ...(creds === undefined ? {} : { creds }),
        });
      if (this.deps.autoStart !== false)
        await this.#sidecar.start((payload) => this.ingest(payload).then(() => undefined));
      return;
    }
    const tokens = this.deps.agentTokens?.(ctx);
    this.#pool =
      this.deps.pool ??
      (tokens === undefined
        ? undefined
        : new WorkspaceSessionPool({
            baseUrl: config.baseUrl,
            channels: config.channels,
            tokens,
            fetch: this.deps.fetch ?? fetch,
            logger: ctx.logger,
            now: ctx.now,
            sleep,
            ...(this.deps.random === undefined ? {} : { random: this.deps.random }),
            onMessage: (agentRef, agent, message) =>
              this.ingest({ workspace: { agentRef, agent, message } }).then(() => undefined),
          }));
    if (this.#pool === undefined)
      throw new ConnectorError('No agent token source for workspace mode', 'engage_config', false);
    if (this.deps.autoStart !== false) {
      await this.#pool.sync();
      this.#timer = setInterval(
        () => void this.#pool?.sync().catch(() => undefined),
        SYNC_INTERVAL_MS,
      );
    }
  }

  health(): Promise<ConnectorHealth> {
    const checkedAt = (this.#ctx?.now() ?? new Date()).toISOString();
    if (this.#ctx === undefined) return Promise.resolve({ status: 'down', checkedAt });
    if (this.#sidecar !== undefined && this.deps.autoStart !== false && !this.#sidecar.connected)
      return Promise.resolve({ status: 'degraded', checkedAt, detail: 'sidecar link down' });
    if (this.#pool !== undefined && this.#pool.down > 0)
      return Promise.resolve({
        status: 'degraded',
        checkedAt,
        detail: `${String(this.#pool.down)}/${String(this.#pool.size)} agent sessions reconnecting`,
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

  async shutdown(): Promise<void> {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
    const pool = this.#pool;
    const sidecar = this.#sidecar;
    this.#ctx = undefined;
    this.#pool = undefined;
    this.#sidecar = undefined;
    this.#state.clear();
    this.#translators.clear();
    if (this.deps.autoStart !== false) {
      await pool?.stop().catch(() => undefined);
      await sidecar?.stop().catch(() => undefined);
    }
  }

  /** Envelope (sidecar) or `{workspace: {agentRef, agent, message}}`; returns accepted events. */
  async ingest(payload: unknown): Promise<number> {
    const ctx = this.#require();
    const translated = this.#envelopeOf(payload);
    if (translated === null) return 0;
    const { envelope, commit } = translated;
    const events = mapPlatformEvent(this.#mapper, envelope);
    const parsed = EngageEnvelopeSchema.parse(envelope);
    const agentRef = WorkspacePayloadSchema.safeParse(payload).data?.workspace.agentRef;
    this.#remember(parsed, agentRef);
    let accepted = 0;
    for (const event of events) {
      if (!this.#state.accepts(event)) continue;
      await ctx.emit(event);
      this.#state.record(event);
      this.#lastEventAt = ctx.now();
      accepted += 1;
    }
    commit();
    return accepted;
  }

  async writeAttributes(target: CommandTarget, attributes: Attributes): Promise<void> {
    const config = this.#configOrThrow();
    const known = this.#knownOrThrow(target.platformInteractionId);
    const byVariable = new Map(config.attachedData.map((m) => [m.variable, m]));
    const userData: Record<string, string | number> = {};
    for (const [variable, value] of Object.entries(attributes)) {
      const mapping = byVariable.get(variable);
      // Mapped keys only when allowed back; everything else lands under the Verbis prefix.
      const key =
        mapping?.writeBack === true ? mapping.key : `${config.writeBackPrefix}${variable}`;
      userData[key] = value === null ? '' : typeof value === 'number' ? value : String(value);
    }
    await this.#dispatch(known, {
      type: 'updateUserData',
      commandId: target.commandId,
      interactionId: target.platformInteractionId,
      mediaType: known.mediaType,
      userData,
    });
  }

  async setWrapUp(target: CommandTarget, wrapUp: WrapUp): Promise<void> {
    const config = this.#configOrThrow();
    const known = this.#knownOrThrow(target.platformInteractionId);
    const note = [
      wrapUp.subCodes.length > 0 ? `[${wrapUp.subCodes.join(', ')}]` : '',
      wrapUp.note ?? '',
    ]
      .filter((s) => s !== '')
      .join(' ');
    await this.#dispatch(known, {
      type: 'updateUserData',
      commandId: `${target.commandId}:disposition`,
      interactionId: target.platformInteractionId,
      mediaType: known.mediaType,
      userData: {
        [config.disposition.key]: config.disposition.codes[wrapUp.code] ?? wrapUp.code,
        ...(note === '' ? {} : { [config.disposition.noteKey]: note.slice(0, 4_000) }),
      },
    });
    if (known.recordHandle !== undefined) {
      const callResult = config.outbound.callResults[wrapUp.code];
      await this.#dispatch(known, {
        type: 'ocsRecordProcessed',
        commandId: `${target.commandId}:ocs`,
        interactionId: target.platformInteractionId,
        recordHandle: known.recordHandle,
        ...(callResult === undefined ? {} : { callResult }),
        ...(known.campaignName === undefined ? {} : { campaignName: known.campaignName }),
        ...(known.applicationId === undefined ? {} : { applicationId: known.applicationId }),
        final: config.outbound.recordProcessed,
      });
    }
  }

  pauseRecording(): Promise<void> {
    return Promise.reject(new CommandNotSupportedError('pauseRecording'));
  }

  resumeRecording(): Promise<void> {
    return Promise.reject(new CommandNotSupportedError('resumeRecording'));
  }

  /**
   * s2s re-verification (ADR-0017 a): the authenticated event stream says the agent owns the
   * interaction *and* the live link confirms it — the sidecar asks T-Server/Interaction Server,
   * workspace mode requires that agent's own session to be connected.
   */
  async verifyParticipant(platformUserId: string, platformInteractionId: string): Promise<boolean> {
    if (
      this.#ctx === undefined ||
      !this.#state.isParticipant(platformUserId, platformInteractionId)
    )
      return false;
    if (this.#sidecar !== undefined)
      return this.#sidecar.verify(platformUserId, platformInteractionId);
    const agentRef = this.#known.get(platformInteractionId)?.agentRef;
    return agentRef !== undefined && (this.#pool?.isConnected(agentRef) ?? false);
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  #envelopeOf(payload: unknown): { envelope: unknown; commit: () => void } | null {
    const workspace = WorkspacePayloadSchema.safeParse(payload);
    if (!workspace.success) return { envelope: payload, commit: () => undefined };
    const { agentRef, agent, message } = workspace.data.workspace;
    let translator = this.#translators.get(agentRef);
    if (translator === undefined) {
      translator = new WorkspaceTranslator(
        agent,
        agentRef.replace(/[^A-Za-z0-9._-]/g, '_'),
        () => this.#ctx?.now() ?? new Date(),
      );
      this.#translators.set(agentRef, translator);
    }
    const translated = translator.translate(message);
    if (translated === 'invalid') throw new PayloadRejectedError('workspace message is invalid');
    return translated;
  }

  #remember(envelope: EngageEnvelope, agentRef: string | undefined): void {
    const previous = this.#known.get(envelope.interactionId);
    const campaign = envelope.userData['GSW_CAMPAIGN_NAME'];
    const app = envelope.userData['GSW_APPLICATION_ID'];
    const owner =
      envelope.event === 'partyChanged' ? (envelope.transferTo ?? envelope.agent) : envelope.agent;
    const known: Known = {
      mediaType: envelope.mediaType,
      agent: owner ?? previous?.agent,
      agentRef:
        agentRef ??
        previous?.agentRef ??
        agentKey(owner, this.#config?.agentIdentity ?? 'employeeId'),
      recordHandle: recordHandleOf(envelope) ?? previous?.recordHandle,
      campaignName: typeof campaign === 'string' ? campaign : previous?.campaignName,
      applicationId:
        typeof app === 'number'
          ? app
          : typeof app === 'string' && /^\d{1,9}$/.test(app)
            ? Number(app)
            : previous?.applicationId,
    };
    this.#known.delete(envelope.interactionId);
    this.#known.set(envelope.interactionId, known);
    if (this.#known.size > MAX_KNOWN) {
      const oldest = this.#known.keys().next();
      if (!oldest.done) this.#known.delete(oldest.value);
    }
  }

  async #dispatch(known: Known, input: EngageCommandInput): Promise<void> {
    if (this.#sent.has(input.commandId)) return;
    const command = EngageCommandSchema.parse({
      ...input,
      ...(known.agent === undefined ? {} : { agent: known.agent }),
    });
    if (this.#sidecar !== undefined) await this.#sidecar.send(command);
    else await this.#workspace(known, command);
    this.#sent.add(input.commandId);
    if (this.#sent.size > MAX_KNOWN) {
      const oldest = this.#sent.values().next();
      if (!oldest.done) this.#sent.delete(oldest.value);
    }
  }

  /** Workspace API v3 equivalents (paths: docs/connectors/genesys-engage.md §1). */
  async #workspace(known: Known, command: z.infer<typeof EngageCommandSchema>): Promise<void> {
    const pool = this.#pool;
    if (pool === undefined || known.agentRef === undefined)
      throw new ConnectorError('No agent session for this interaction', 'engage_no_session', true);
    const kv = (data: Record<string, string | number>) =>
      Object.entries(data).map(([key, value]) => ({
        key,
        type: typeof value === 'number' ? 'int' : 'str',
        value,
      }));
    const id = encodeURIComponent(command.interactionId);
    if (command.type === 'updateUserData') {
      const path =
        command.mediaType === 'voice'
          ? `/workspace/v3/voice/calls/${id}/update-user-data`
          : `/workspace/v3/media/${encodeURIComponent(command.mediaType)}/interactions/${id}/update-user-data`;
      await pool.request(known.agentRef, 'POST', path, {
        data: { userData: kv(command.userData) },
      });
      return;
    }
    // OCS desktop protocol over a T-Server UserEvent (GSW_AGENT_REQ_TYPE).
    await pool.request(known.agentRef, 'POST', '/workspace/v3/voice/send-user-event', {
      data: {
        userData: kv(ocsUserData(command)),
        connId: command.interactionId,
      },
    });
  }

  #knownOrThrow(id: string): Known {
    const known = this.#known.get(id);
    if (known === undefined) throw new UnknownInteractionError();
    return known;
  }

  #configOrThrow(): GenesysEngageConfig {
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
