import {
  jetstream,
  jetstreamManager,
  AckPolicy,
  DeliverPolicy,
  type ConsumerMessages,
} from '@nats-io/jetstream';
import {
  connect,
  credsAuthenticator,
  headers as natsHeaders,
  type NatsConnection,
} from '@nats-io/transport-node';
import { SpanKind } from '@opentelemetry/api';
import { z } from 'zod';

import { consumeMessage, messagingHeaders, inSpan } from '@verbis/observability';
import {
  BackpressureError,
  ConnectorError,
  PayloadRejectedError,
  type ConnectorLogger,
} from '@verbis/sdk-connector';

/** Replies every Verbis sidecar (Genesys Engage, Avaya) sends on request/reply subjects. */
export const CommandReplySchema = z.union([
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), code: z.string().max(64), retryable: z.boolean() }),
]);
export const VerifyReplySchema = z.strictObject({ participant: z.boolean() });

export interface SidecarSubjects {
  readonly events: string;
  readonly commands: string;
  readonly verify: string;
}

/** `verbis.connector.<family>.<connectorId>.{event,command,verify}.v1` (CLAUDE.md §5). */
export const sidecarSubjects = (family: string, connectorId: string): SidecarSubjects => ({
  events: `verbis.connector.${family}.${connectorId}.event.v1`,
  commands: `verbis.connector.${family}.${connectorId}.command.v1`,
  verify: `verbis.connector.${family}.${connectorId}.verify.v1`,
});

export interface SidecarNatsConfig {
  readonly servers: readonly string[];
  readonly stream: string;
  readonly requestTimeoutMs: number;
}

/** Commands are platform-specific objects with a stable id and a discriminator. */
export interface SidecarCommand {
  readonly type: string;
  readonly commandId: string;
}

/** What the connector needs from the sidecar link (NATS in production, in-memory in tests). */
export interface SidecarTransport {
  start(sink: (envelope: unknown) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  readonly connected: boolean;
  send(command: SidecarCommand): Promise<void>;
  verify(platformUserId: string, interactionId: string): Promise<boolean>;
}

export interface NatsSidecarOptions {
  readonly connectorId: string;
  readonly subjects: SidecarSubjects;
  readonly nats: SidecarNatsConfig;
  /** NATS user credentials (`.creds` content) from the vault; optional only in dev. */
  readonly creds?: string;
  readonly logger: ConnectorLogger;
}

const text = new TextEncoder();
const decode = new TextDecoder();

/**
 * Hub side of a sidecar link (Genesys Engage ADR-0019, Avaya ADR-0020):
 * - events: durable JetStream pull consumer `hub-<connectorId>` (explicit ack). Backpressure ⇒
 *   `nak(1s)` (redelivered, never dropped); a payload the mapper refuses ⇒ `term` (poison, logged).
 *   The sidecar publishes with `Nats-Msg-Id = eventId`, so JetStream dedupes producer retries.
 * - commands / verify: core NATS request-reply with a timeout; the sidecar answers
 *   `{ok}` / `{ok:false, code, retryable}` and `{participant}`.
 */
export class NatsSidecarTransport implements SidecarTransport {
  #nc: NatsConnection | undefined;
  #messages: ConsumerMessages | undefined;
  #loop: Promise<void> | undefined;
  readonly #subjects;

  constructor(private readonly options: NatsSidecarOptions) {
    this.#subjects = options.subjects;
  }

  get connected(): boolean {
    return this.#nc !== undefined && !this.#nc.isClosed();
  }

  async start(sink: (envelope: unknown) => Promise<void>): Promise<void> {
    const config = this.options.nats;
    this.#nc = await connect({
      servers: [...config.servers],
      name: `verbis-hub-sidecar-${this.options.connectorId}`,
      ...(this.options.creds === undefined
        ? {}
        : { authenticator: credsAuthenticator(text.encode(this.options.creds)) }),
      maxReconnectAttempts: -1,
    });
    const durable = `hub-${this.options.connectorId}`;
    const jsm = await jetstreamManager(this.#nc);
    await jsm.consumers
      .add(config.stream, {
        durable_name: durable,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
        filter_subject: this.#subjects.events,
        ack_wait: 30_000_000_000,
        max_deliver: -1,
      })
      .catch(() => undefined); // already exists
    const consumer = await jetstream(this.#nc).consumers.get(config.stream, durable);
    this.#messages = await consumer.consume({ max_messages: 100 });
    const messages = this.#messages;
    this.#loop = (async () => {
      for await (const message of messages) {
        let payload: unknown;
        try {
          payload = JSON.parse(decode.decode(message.data));
        } catch {
          payload = undefined;
        }
        try {
          const carrier = {
            traceparent: message.headers?.get('traceparent') ?? '',
            tracestate: message.headers?.get('tracestate') ?? '',
          };
          await consumeMessage(carrier, () => sink(payload));
          message.ack();
        } catch (error) {
          if (error instanceof BackpressureError) message.nak(1_000);
          else if (error instanceof PayloadRejectedError) {
            this.options.logger.warn('sidecar envelope rejected (terminated)', {
              reason: error.message.slice(0, 200),
            });
            message.term();
          } else message.nak(5_000);
        }
      }
    })();
  }

  async stop(): Promise<void> {
    await this.#messages?.close().catch(() => undefined);
    await this.#loop?.catch(() => undefined);
    await this.#nc?.drain().catch(() => undefined);
    this.#nc = undefined;
  }

  async send(command: SidecarCommand): Promise<void> {
    const reply = CommandReplySchema.safeParse(
      await this.#request(this.#subjects.commands, command),
    );
    if (!reply.success)
      throw new ConnectorError('Unexpected sidecar reply', 'engage_sidecar_reply', true);
    if (!reply.data.ok)
      throw new ConnectorError(
        `Sidecar refused ${command.type}`,
        reply.data.code,
        reply.data.retryable,
      );
  }

  async verify(platformUserId: string, interactionId: string): Promise<boolean> {
    const reply = VerifyReplySchema.safeParse(
      await this.#request(this.#subjects.verify, { platformUserId, interactionId }),
    );
    if (!reply.success)
      throw new ConnectorError('Unexpected sidecar reply', 'engage_sidecar_reply', true);
    return reply.data.participant;
  }

  async #request(subject: string, body: unknown): Promise<unknown> {
    const nc = this.#nc;
    if (nc === undefined)
      throw new ConnectorError('Sidecar link down', 'engage_sidecar_down', true);
    try {
      const response = await inSpan(
        'nats.request',
        () => {
          const headers = natsHeaders();
          for (const [key, value] of Object.entries(messagingHeaders())) headers.set(key, value);
          return nc.request(subject, text.encode(JSON.stringify(body)), {
            timeout: this.options.nats.requestTimeoutMs,
            headers,
          });
        },
        SpanKind.CLIENT,
      );
      return JSON.parse(decode.decode(response.data)) as unknown;
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new ConnectorError('Sidecar reply is not JSON', 'engage_sidecar_reply', true);
      throw new ConnectorError('Sidecar did not answer', 'engage_sidecar_timeout', true);
    }
  }
}
