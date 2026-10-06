import { z } from 'zod';

import { ConnectorError, signWebhook } from '@verbis/sdk-connector';

/**
 * Secure pause through the *recording system* (Avaya Workforce Engagement, Verint, NICE, …)
 * rather than the switch: Avaya Aura/AES, AACC and AXP expose no switch-level pause we can rely on.
 * The hub POSTs a signed JSON command to the recorder's integration endpoint (or a small adapter
 * in front of it). HMAC like our webhooks (`t=…,v1=…`, secret `recorderSecret`), idempotency key
 * = commandId, https only, no redirects.
 */
export const RecordingHookConfigSchema = z.strictObject({
  url: z.url({ protocol: /^https$/ }).max(2_048),
  /** Recorder-side identifier to send: the UCID is what Avaya recorders index calls by. */
  callKey: z.enum(['ucid', 'interactionId']).default('ucid'),
  timeoutMs: z.number().int().min(500).max(10_000).default(3_000),
});
export type RecordingHookConfig = z.infer<typeof RecordingHookConfigSchema>;

export type RecordingAction = 'pause' | 'resume' | 'tag';

export interface RecordingCall {
  readonly interactionId: string;
  readonly ucid?: string | undefined;
  readonly agent?: string | undefined;
  readonly extension?: string | undefined;
}

export class RecordingHook {
  readonly #sent = new Set<string>();

  constructor(
    private readonly config: RecordingHookConfig,
    private readonly secret: () => Promise<string>,
    private readonly now: () => Date,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(
    action: RecordingAction,
    commandId: string,
    call: RecordingCall,
    tags?: Record<string, string>,
  ): Promise<void> {
    if (this.#sent.has(commandId)) return;
    const key =
      this.config.callKey === 'ucid' && call.ucid !== undefined ? call.ucid : call.interactionId;
    const body = JSON.stringify({
      action,
      commandId,
      callKey: this.config.callKey === 'ucid' && call.ucid !== undefined ? 'ucid' : 'interactionId',
      call: key,
      ...(call.agent === undefined ? {} : { agent: call.agent }),
      ...(call.extension === undefined ? {} : { extension: call.extension }),
      ...(tags === undefined ? {} : { tags }),
      at: this.now().toISOString(),
    });
    const signature = signWebhook(
      await this.secret(),
      body,
      Math.floor(this.now().getTime() / 1000),
    );
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-verbis-signature': signature,
          'idempotency-key': commandId,
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch {
      throw new ConnectorError('Recording system unreachable', 'recorder_unreachable', true);
    }
    if (!response.ok)
      throw new ConnectorError(
        `Recording system responded ${String(response.status)}`,
        'recorder_failed',
        response.status >= 500 || response.status === 429,
      );
    this.#sent.add(commandId);
    if (this.#sent.size > 20_000) {
      const oldest = this.#sent.values().next();
      if (!oldest.done) this.#sent.delete(oldest.value);
    }
  }
}
