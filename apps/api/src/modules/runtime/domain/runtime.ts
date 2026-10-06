import { z } from 'zod';

import { JsonValueSchema, type Variable, type JsonValue } from '@verbis/script-schema';

import {
  ConflictError,
  ValidationError,
  VersionMismatchError,
} from '../../../common/errors/domain-errors.js';

export const RuntimeStateSchema = z.enum([
  'launching',
  'active',
  'paused',
  'wrapup',
  'completed',
  'abandoned',
  'expired',
]);
export type RuntimeState = z.infer<typeof RuntimeStateSchema>;
export const TERMINAL = new Set<RuntimeState>(['completed', 'abandoned', 'expired']);
const transitions: Record<RuntimeState, readonly RuntimeState[]> = {
  launching: ['active', 'abandoned', 'expired'],
  active: ['paused', 'wrapup', 'abandoned', 'expired'],
  paused: ['active', 'wrapup', 'abandoned', 'expired'],
  wrapup: ['completed', 'abandoned', 'expired'],
  completed: [],
  abandoned: [],
  expired: [],
};
export function transition(
  from: RuntimeState,
  to: RuntimeState,
  outcomeRecorded = false,
): RuntimeState {
  if (!transitions[from].includes(to) || (to === 'completed' && !outcomeRecorded))
    throw new ConflictError('Invalid runtime state transition');
  return to;
}
export function assertSequence(actual: number, expected: number): void {
  if (actual !== expected) throw new VersionMismatchError(actual);
}
export const SnapshotSchema = z.strictObject({
  variables: z.record(z.string(), JsonValueSchema).default({}),
  currentPage: z.string().nullable().default(null),
  history: z.array(z.string()).max(100).default([]),
  timers: z.record(z.string(), z.number().int().nonnegative()).default({}),
});
export type RuntimeSnapshot = z.infer<typeof SnapshotSchema>;
export function emptySnapshot(): RuntimeSnapshot {
  return SnapshotSchema.parse({});
}
export function persistedSnapshot(
  snapshot: RuntimeSnapshot,
  variables: readonly Variable[],
): RuntimeSnapshot {
  const allowed = new Set(
    variables.filter((v) => v.persist && v.classification !== 'pci').map((v) => v.key),
  );
  return {
    ...snapshot,
    variables: Object.fromEntries(
      Object.entries(snapshot.variables).filter(([key]) => allowed.has(key)),
    ),
  };
}
export function safeSnapshot(
  snapshot: RuntimeSnapshot,
  variables: readonly Variable[],
  supervisor = false,
): RuntimeSnapshot {
  const definitions = new Map(variables.map((v) => [v.key, v]));
  return {
    ...snapshot,
    variables: Object.fromEntries(
      Object.entries(snapshot.variables).map(([key, value]) => {
        const definition = definitions.get(key);
        return [
          key,
          definition === undefined ||
          definition.classification === 'pci' ||
          (supervisor && (definition.pii || definition.classification === 'pii'))
            ? '[REDACTED]'
            : value,
        ];
      }),
    ),
  };
}
export function validateVariable(definition: Variable | undefined, value: JsonValue): void {
  if (
    definition === undefined ||
    definition.scope === 'global' ||
    definition.classification === 'pci'
  )
    throw new ValidationError([{ path: '/variable', message: 'Variable is not writable' }]);
  const valid =
    value === null ||
    {
      string: typeof value === 'string',
      number: typeof value === 'number' && Number.isFinite(value),
      boolean: typeof value === 'boolean',
      date:
        typeof value === 'string' &&
        /^\d{4}-\d\d-\d\dT/.test(value) &&
        Number.isFinite(Date.parse(value)),
      object: typeof value === 'object' && !Array.isArray(value),
      array: Array.isArray(value),
      enum: typeof value === 'string' && definition.enumValues?.includes(value) === true,
    }[definition.type];
  if (!valid || JSON.stringify(value).length > 32_768)
    throw new ValidationError([{ path: '/value', message: 'Invalid variable value' }]);
}
const Id = z.uuid();
const Name = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
  .max(128);
export const LeaseSchema = z.strictObject({
  tabId: Id,
  writeToken: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .optional(),
});
const concurrency = {
  expectedSequence: z.number().int().nonnegative(),
  tabId: Id,
  writeToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
};
export const CommandSchema = z.strictObject({
  ...concurrency,
  command: z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('transition'),
      state: RuntimeStateSchema.exclude(['launching', 'completed']),
    }),
    z.strictObject({ type: z.literal('field'), variable: Name, value: JsonValueSchema }),
    z.strictObject({
      type: z.literal('page'),
      pageId: Name,
      history: z.array(Name).max(100).optional(),
    }),
    z.strictObject({
      type: z.literal('timer'),
      timerId: Name,
      durationMs: z.number().int().min(0).max(86_400_000),
    }),
  ]),
});
export const OutcomeInputSchema = z.strictObject({
  ...concurrency,
  code: z.string().max(64),
  subCodes: z.array(z.string().max(64)).max(50).default([]),
  note: z.string().max(4_000).optional(),
  fields: z.record(Name, JsonValueSchema).default({}),
  callbackAt: z.iso.datetime().optional(),
});
export const SecureFieldSchema = z.strictObject({
  ...concurrency,
  variable: Name,
  receipt: z
    .string()
    .max(8192)
    .regex(/^(?:tok_[A-Za-z0-9_-]{16,512}|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/),
});
export const RecordingSchema = z.strictObject({ ...concurrency, paused: z.boolean() });
export const TransferSchema = z.strictObject({
  ...concurrency,
  targetSessionId: Id,
  targetSequence: z.number().int().nonnegative(),
  variables: z.array(Name).max(100),
});
export const TicketInputSchema = z.strictObject({
  afterSequence: z.number().int().nonnegative().default(0),
});
export const RuntimeViewSchema = z.object({
  id: Id,
  state: RuntimeStateSchema,
  sequence: z.number().int(),
  readOnly: z.boolean(),
  snapshot: SnapshotSchema,
});
export const LeaseViewSchema = RuntimeViewSchema.extend({
  writeToken: z.string().optional(),
  leaseUntil: z.iso.datetime().nullable(),
});
export const TicketViewSchema = z.object({
  ticket: z.string(),
  expiresIn: z.number().int(),
  namespace: z.literal('/runtime'),
});
export const InteractionSchema = z.strictObject({
  id: Id,
  platform: z.string().min(1).max(64),
  platformInteractionId: z.string().min(1).max(256),
  connectorId: Id,
  channel: z.enum(['voice', 'chat', 'email', 'sms', 'whatsapp', 'social', 'video', 'callback']),
  direction: z.enum(['inbound', 'outbound']),
  ani: z.string().max(256).optional(),
  dnis: z.string().max(256).optional(),
  customerId: z.string().max(256).optional(),
  queue: z.string().max(256).optional(),
  campaignId: Id.optional(),
  attachedData: z.record(z.string(), JsonValueSchema).default({}),
  participantData: z.array(JsonValueSchema).max(100).default([]),
  status: z.enum(['alerting', 'connected', 'held', 'transferred', 'wrapup', 'ended']),
  agentId: Id.optional(),
  platformAgentId: z.string().min(1).max(256).optional(),
});
export type Interaction = z.infer<typeof InteractionSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type WriteClaim = z.infer<typeof CommandSchema>;
