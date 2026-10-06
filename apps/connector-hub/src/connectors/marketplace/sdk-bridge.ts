import { jetstream } from '@nats-io/jetstream';
import {
  connect,
  credsAuthenticator,
  type NatsConnection,
  type Subscription,
} from '@nats-io/transport-node';
import { z } from 'zod';

import {
  MarketplaceEnvelopeSchema,
  createMarketplaceSdkBridge,
  type MarketplacePlatform,
  type MarketplaceSdkPort,
} from '@verbis/sdk-connector';

import { sidecarSubjects, type SidecarNatsConfig } from '../shared/nats-sidecar-transport.js';

const VerifyRequest = z.strictObject({
  platformUserId: z.string().min(1).max(256),
  interactionId: z.string().min(1).max(256),
});
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Server-only worker: owns the vendor SDK credentials and the connector-specific NATS ACL. */
export class MarketplaceSdkWorker {
  #nc: NatsConnection | undefined;
  readonly #subscriptions: Subscription[] = [];
  readonly #loops: Promise<void>[] = [];
  #serial: Promise<unknown> = Promise.resolve();
  readonly #completed = new Map<string, string>();
  readonly #bridge;
  readonly #subjects;
  constructor(
    readonly platform: MarketplacePlatform,
    connectorId: string,
    private readonly port: MarketplaceSdkPort,
  ) {
    this.#bridge = createMarketplaceSdkBridge(platform, port);
    this.#subjects = sidecarSubjects(platform, connectorId);
  }
  async start(nats: SidecarNatsConfig, creds: string): Promise<void> {
    if (this.#nc !== undefined) throw new Error('Worker already running');
    this.#nc = await connect({
      servers: [...nats.servers],
      authenticator: credsAuthenticator(encoder.encode(creds)),
    });
    for (const [subject, verify] of [
      [this.#subjects.commands, false],
      [this.#subjects.verify, true],
    ] as const) {
      const subscription = this.#nc.subscribe(subject);
      this.#subscriptions.push(subscription);
      this.#loops.push(
        (async () => {
          for await (const message of subscription) {
            let reply: unknown;
            try {
              const input: unknown = JSON.parse(decoder.decode(message.data));
              if (verify) {
                const request = VerifyRequest.parse(input);
                reply = {
                  participant: await this.port.verifyParticipant(
                    request.platformUserId,
                    request.interactionId,
                  ),
                };
              } else {
                // Execute commands serially; retry ACK only after a successful platform response.
                const work = this.#serial.then(async () => {
                  const parsed = z.object({ type: z.string(), commandId: z.string() }).parse(input);
                  const key = `${parsed.type}:${parsed.commandId}`;
                  const fingerprint = JSON.stringify(input);
                  const prior = this.#completed.get(key);
                  if (prior !== undefined && prior !== fingerprint)
                    throw new Error('Command conflict');
                  if (prior === undefined) {
                    await this.#bridge.execute(input);
                    this.#completed.set(key, fingerprint);
                    if (this.#completed.size > 20_000) {
                      const oldest = this.#completed.keys().next();
                      if (!oldest.done) this.#completed.delete(oldest.value);
                    }
                  }
                });
                this.#serial = work.catch(() => undefined);
                await work;
                reply = { ok: true };
              }
            } catch {
              reply = verify
                ? { participant: false }
                : { ok: false, code: 'marketplace_sdk_refused', retryable: true };
            }
            message.respond(encoder.encode(JSON.stringify(reply)));
          }
        })(),
      );
    }
  }
  async publish(input: unknown): Promise<void> {
    const envelope = MarketplaceEnvelopeSchema.parse(input);
    if (envelope.platform !== this.platform) throw new Error('Wrong event platform');
    const nc = this.#nc;
    if (nc === undefined) throw new Error('Worker not running');
    await jetstream(nc).publish(this.#subjects.events, encoder.encode(JSON.stringify(envelope)), {
      msgID: envelope.event.eventId,
    });
  }
  async stop(): Promise<void> {
    for (const subscription of this.#subscriptions) subscription.unsubscribe();
    await Promise.allSettled(this.#loops);
    await this.#nc?.drain();
    this.#nc = undefined;
    this.#subscriptions.length = 0;
    this.#loops.length = 0;
  }
}
