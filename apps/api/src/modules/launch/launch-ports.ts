import { Injectable } from '@nestjs/common';

import { LaunchDeniedError } from './domain/launch.js';

/**
 * Server-side platform check (SECURITY §4.4 item 7): "is this user really a current participant of
 * this interaction?" Implemented by connector adapters with the platform credentials they hold
 * (platform OAuth / service account). Registered in code only; no client can register one.
 */
export interface PlatformInteractionVerifier {
  isActiveParticipant(input: {
    readonly tenantId: string;
    readonly connectorId: string;
    /** Platform conversation/interaction id. */
    readonly externalId: string;
    readonly platform?: string;
    /** Identity matched by the authenticated connector event, never browser input. */
    readonly platformUserId?: string | undefined;
    /** The user's platform identities (`users.cti_identities`), never client-supplied. */
    readonly ctiIdentities: readonly unknown[];
  }): Promise<boolean>;
}

const VERIFY_TIMEOUT_MS = 3_000;

@Injectable()
export class LaunchPorts {
  readonly #verifiers = new Map<string, PlatformInteractionVerifier>();
  #fallback: PlatformInteractionVerifier | undefined;

  registerVerifier(connectorId: string, verifier: PlatformInteractionVerifier): void {
    this.#verifiers.set(connectorId, verifier);
  }

  /** Used for connectors without a specific verifier (the connector-hub bridge, ADR-0018). */
  registerFallbackVerifier(verifier: PlatformInteractionVerifier): void {
    this.#fallback = verifier;
  }

  /** Fails closed: no verifier, a timeout, an error or `false` all deny. */
  async verify(input: Parameters<PlatformInteractionVerifier['isActiveParticipant']>[0]) {
    const verifier = this.#verifiers.get(input.connectorId) ?? this.#fallback;
    if (verifier === undefined) throw new LaunchDeniedError('connector_unavailable');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ok = await Promise.race([
      verifier.isActiveParticipant(input).catch(() => false),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => {
          resolve(false);
        }, VERIFY_TIMEOUT_MS);
        timer.unref();
      }),
    ]).finally(() => {
      clearTimeout(timer);
    });
    if (!ok) throw new LaunchDeniedError('platform_unverified');
  }
}
