import { z } from 'zod';

import {
  CommandNotSupportedError,
  ConnectorError,
  mapPlatformEvent,
  signWebhook,
  verifyWebhook,
  type Attributes,
  type CommandTarget,
  type Connector,
  type ConnectorContext,
  type ConnectorHealth,
  type WrapUp,
} from '@verbis/sdk-connector';

import { InteractionState } from '../interaction-state.js';

import { genericWebhookMapper } from './mapper.js';

export const GenericWebhookConfigSchema = z.strictObject({
  kind: z.literal('webhook'),
  /** Optional write-back endpoint of the sending system (https only). */
  callbackUrl: z
    .url({ protocol: /^https$/ })
    .max(2_048)
    .optional(),
  /** Accepted signature age (replay window). */
  toleranceSeconds: z.number().int().min(30).max(900).default(300),
  /** Connector-local secret names → integration Secret ids (resolved by the API). */
  secrets: z.record(z.string(), z.uuid()).optional(),
  maxConcurrent: z
    .partialRecord(
      z.enum(['voice', 'chat', 'email', 'sms', 'whatsapp', 'social', 'video', 'callback']),
      z.number().int().min(1).max(50),
    )
    .optional(),
});
export type GenericWebhookConfig = z.infer<typeof GenericWebhookConfigSchema>;

export class WebhookSignatureError extends ConnectorError {
  override readonly name = 'WebhookSignatureError';

  constructor(reason: string) {
    super(`Webhook signature rejected: ${reason}`, 'signature_invalid', false);
  }
}

export interface GenericWebhookDeps {
  readonly fetch?: typeof fetch;
}

/**
 * Generic Webhook Connector: any system POSTs HMAC-signed lifecycle events to
 * `/webhooks/{connectorId}` (secret `signingSecret`, optional `previousSigningSecret` for rotation).
 * Commands are POSTed back, signed with `callbackSecret`, to `callbackUrl` when configured.
 */
export class GenericWebhookConnector implements Connector {
  readonly type = 'generic' as const;
  readonly kind = 'webhook';
  readonly capabilities = {
    channels: ['voice', 'chat', 'email', 'sms', 'whatsapp', 'social', 'video', 'callback'] as const,
    features: ['writeBack', 'wrapUpCodes', 'transferContext'] as const,
    maxConcurrent: { chat: 3, email: 2, sms: 3, whatsapp: 3, social: 3 },
  };
  readonly configSchema = GenericWebhookConfigSchema;
  readonly #state = new InteractionState();
  readonly #sentCommands = new Set<string>();
  #ctx: ConnectorContext | undefined;
  #config: GenericWebhookConfig | undefined;
  #lastEventAt: Date | undefined;

  constructor(private readonly deps: GenericWebhookDeps = {}) {}

  async init(ctx: ConnectorContext): Promise<void> {
    this.#config = GenericWebhookConfigSchema.parse(ctx.config);
    // Fail fast when the signing secret is missing: the endpoint would refuse everything anyway.
    await ctx.secrets.get('signingSecret');
    this.#ctx = ctx;
  }

  health(): Promise<ConnectorHealth> {
    const checkedAt = (this.#ctx?.now() ?? new Date()).toISOString();
    if (this.#ctx === undefined) return Promise.resolve({ status: 'down', checkedAt });
    return Promise.resolve({
      status: 'up',
      checkedAt,
      ...(this.#lastEventAt === undefined
        ? { detail: 'no events yet' }
        : { detail: `last event ${this.#lastEventAt.toISOString()}` }),
    });
  }

  shutdown(): Promise<void> {
    this.#ctx = undefined;
    this.#state.clear();
    return Promise.resolve();
  }

  /** Transport entry point: verifies the HMAC over the raw body before parsing anything. */
  async handleWebhook(rawBody: Buffer | string, signature: string | undefined): Promise<number> {
    const ctx = this.#require();
    const secrets = [await ctx.secrets.get('signingSecret')];
    const previous = await ctx.secrets.get('previousSigningSecret').catch(() => undefined);
    if (previous !== undefined) secrets.push(previous);
    const verdict = verifyWebhook(
      secrets,
      rawBody,
      signature,
      Math.floor(ctx.now().getTime() / 1000),
      this.#config?.toleranceSeconds,
    );
    if (!verdict.ok) throw new WebhookSignatureError(verdict.reason);
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody);
    } catch {
      payload = undefined;
    }
    return this.ingest(payload);
  }

  /** Maps and emits; returns the number of events accepted. */
  async ingest(payload: unknown): Promise<number> {
    const ctx = this.#require();
    let accepted = 0;
    for (const event of mapPlatformEvent(genericWebhookMapper, payload)) {
      if (!this.#state.accepts(event)) continue;
      await ctx.emit(event);
      this.#state.record(event);
      this.#lastEventAt = ctx.now();
      accepted += 1;
    }
    return accepted;
  }

  writeAttributes(target: CommandTarget, attributes: Attributes): Promise<void> {
    return this.#callback(target, { command: 'writeAttributes', attributes });
  }

  setWrapUp(target: CommandTarget, wrapUp: WrapUp): Promise<void> {
    return this.#callback(target, { command: 'setWrapUp', wrapUp });
  }

  pauseRecording(): Promise<void> {
    return Promise.reject(new CommandNotSupportedError('pauseRecording'));
  }

  resumeRecording(): Promise<void> {
    return Promise.reject(new CommandNotSupportedError('resumeRecording'));
  }

  /** No platform API: the signed event stream is the authority (current, non-ended participant). */
  verifyParticipant(platformUserId: string, platformInteractionId: string): Promise<boolean> {
    return Promise.resolve(
      this.#ctx !== undefined && this.#state.isParticipant(platformUserId, platformInteractionId),
    );
  }

  async #callback(target: CommandTarget, body: Record<string, unknown>): Promise<void> {
    const ctx = this.#require();
    const url = this.#config?.callbackUrl;
    if (url === undefined)
      throw new ConnectorError('No callbackUrl configured', 'callback_not_configured', false);
    if (this.#sentCommands.has(target.commandId)) return;
    const raw = JSON.stringify({
      ...body,
      commandId: target.commandId,
      interactionId: target.platformInteractionId,
    });
    const signature = signWebhook(
      await ctx.secrets.get('callbackSecret'),
      raw,
      Math.floor(ctx.now().getTime() / 1000),
    );
    let response: Response;
    try {
      response = await (this.deps.fetch ?? fetch)(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-verbis-signature': signature,
          'idempotency-key': target.commandId,
        },
        body: raw,
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new ConnectorError('Callback unreachable', 'callback_unreachable', true);
    }
    if (!response.ok)
      throw new ConnectorError(
        `Callback responded ${String(response.status)}`,
        'callback_failed',
        response.status >= 500 || response.status === 429,
      );
    this.#sentCommands.add(target.commandId);
    if (this.#sentCommands.size > 20_000) {
      const oldest = this.#sentCommands.values().next().value;
      if (oldest !== undefined) this.#sentCommands.delete(oldest);
    }
  }

  #require(): ConnectorContext {
    if (this.#ctx === undefined)
      throw new ConnectorError('Connector is not running', 'not_running', true);
    return this.#ctx;
  }
}
