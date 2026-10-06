import { z } from 'zod';

import { type AdapterType } from './adapter.js';
import { type CommandName, type ConnectorCapabilities } from './capabilities.js';
import { type InteractionEvent } from './interaction.js';

/** Health as the hub reports it per connector instance. */
export type ConnectorHealthStatus = 'up' | 'degraded' | 'down';
export interface ConnectorHealth {
  readonly status: ConnectorHealthStatus;
  readonly detail?: string;
  readonly checkedAt: string;
}

/**
 * Secrets come from the integration secret vault through the API; connectors read them by the
 * names declared in their config (`secretRefs`) and must never log or emit them.
 */
export interface SecretAccessor {
  get(name: string): Promise<string>;
}

export interface ConnectorLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface ConnectorContext {
  readonly connectorId: string;
  readonly tenantId: string;
  /** Non-secret configuration, validated by the connector's `configSchema`. */
  readonly config: unknown;
  readonly secrets: SecretAccessor;
  readonly logger: ConnectorLogger;
  readonly now: () => Date;
  /**
   * Hands a normalized event to the hub pipeline. Resolves when accepted into the bounded queue;
   * rejects with `BackpressureError` when the queue is full — the connector must then slow down
   * (stop polling, NACK, answer the webhook with 503) instead of dropping events.
   */
  emit(event: InteractionEvent): Promise<void>;
}

export class BackpressureError extends Error {
  override readonly name = 'BackpressureError';
}

export interface CommandTarget {
  /** Platform conversation/interaction id. */
  readonly platformInteractionId: string;
  /** Stable id; connectors must deduplicate it across retries (at-least-once delivery). */
  readonly commandId: string;
}

export const WrapUpSchema = z.strictObject({
  code: z.string().min(1).max(128),
  subCodes: z.array(z.string().max(128)).max(20).default([]),
  note: z.string().max(4_000).optional(),
});
export type WrapUp = z.infer<typeof WrapUpSchema>;

export const AttributesSchema = z.record(
  z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  z.union([z.string().max(1_000), z.number(), z.boolean(), z.null()]),
);
export type Attributes = z.infer<typeof AttributesSchema>;

/**
 * Contract every connector implements (ADR-0008). Lifecycle: `init` → many `health` →
 * `shutdown`. Events flow out through `ctx.emit`; commands flow in. Commands whose feature is not
 * in `capabilities.features` must throw `CommandNotSupportedError` (the contract kit checks it).
 */
export interface Connector {
  readonly type: AdapterType;
  /** Connector kind within the adapter type (e.g. `generic` → `webhook` | `simulator`). */
  readonly kind: string;
  readonly capabilities: ConnectorCapabilities;
  readonly configSchema: z.ZodType;

  init(ctx: ConnectorContext): Promise<void>;
  health(): Promise<ConnectorHealth>;
  shutdown(): Promise<void>;

  writeAttributes(target: CommandTarget, attributes: Attributes): Promise<void>;
  setWrapUp(target: CommandTarget, wrapUp: WrapUp): Promise<void>;
  pauseRecording(target: CommandTarget): Promise<void>;
  resumeRecording(target: CommandTarget): Promise<void>;

  /**
   * Platform-side check for secure launch: is this platform user a *current* participant of this
   * interaction? Must ask the platform (or the connector's authoritative state), never trust the
   * caller. Unknown ⇒ false.
   */
  verifyParticipant(platformUserId: string, platformInteractionId: string): Promise<boolean>;
}

export type ConnectorFactory = () => Connector;

export interface ConnectorDescriptor {
  readonly type: AdapterType;
  readonly kind: string;
  readonly create: ConnectorFactory;
}

export const COMMAND_NAMES: readonly CommandName[] = [
  'writeAttributes',
  'setWrapUp',
  'pauseRecording',
  'resumeRecording',
];
