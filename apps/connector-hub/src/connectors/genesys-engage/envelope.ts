import { z } from 'zod';

/**
 * Neutral Engage event envelope v1 — the contract between the Java sidecar (Platform SDK) and
 * the hub, and the shape Workspace API notifications are translated into. JSON Schema twin:
 * `apps/connector-genesys-engage-sidecar/src/main/resources/contracts/engage-envelope.v1.json`.
 * Everything is bounded: the sidecar is a separate process and its payloads are untrusted input.
 */
const Str = (max: number) => z.string().max(max);
const Id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:@-]+$/);

export const ENGAGE_EVENTS = [
  'ringing', // T-Server EventRinging / Workspace Ringing / Ixn EventInvite
  'dialing', // outbound preview/progressive dial on the agent DN
  'established', // EventEstablished / Ixn EventAccepted
  'held',
  'retrieved',
  'partyChanged', // transfer completed (previous connId → new owner)
  'released', // EventReleased / Ixn EventPartyRemoved (agent left; ACW may follow)
  'markedDone', // disposition done / Ixn EventProcessingStopped / Workspace Completed
  'abandoned', // EventAbandoned / Ixn EventRevoked before accept
  'attachedDataChanged',
] as const;
export type EngageEventName = (typeof ENGAGE_EVENTS)[number];

export const EngageMediaSchema = z.enum([
  'voice',
  'chat',
  'email',
  'sms',
  'whatsapp',
  'webchat',
  'facebook',
  'twitter',
  'workitem',
]);

export const EngageAgentSchema = z.strictObject({
  employeeId: Str(128).optional(),
  userName: Str(128).optional(),
  agentLoginId: Str(128).optional(),
  dn: Str(64).optional(),
  place: Str(128).optional(),
});
export type EngageAgent = z.infer<typeof EngageAgentSchema>;

const UserDataValue = z.union([Str(4_000), z.number(), z.boolean(), z.null()]);

export const EngageEnvelopeSchema = z.strictObject({
  schema: z.literal('verbis.engage.envelope.v1'),
  /** Stable per platform event (`<server>:<EventSequenceNumber>`, or derived for Workspace). */
  eventId: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9._:@-]+$/),
  source: z.enum(['tserver', 'ixn', 'workspace']),
  event: z.enum(ENGAGE_EVENTS),
  occurredAt: z.iso.datetime({ offset: true }),
  /** Voice: ConnID (hex); multimedia: Interaction Server interaction id. */
  interactionId: Id,
  previousInteractionId: Id.optional(),
  mediaType: EngageMediaSchema,
  callType: z.enum(['Inbound', 'Outbound', 'Internal', 'Consult', 'Unknown']).default('Unknown'),
  agent: EngageAgentSchema.optional(),
  transferTo: EngageAgentSchema.optional(),
  ani: Str(64).optional(),
  dnis: Str(64).optional(),
  /** Routing queue / virtual queue (ThisQueue, `RVQID`, Ixn queue). */
  queue: Str(256).optional(),
  /** Attached data (KVList flattened one level; nested lists dropped by the producer). */
  userData: z.record(Str(128), UserDataValue).default({}),
  email: z
    .strictObject({
      from: Str(320),
      to: z.array(Str(320)).max(50).default([]),
      subject: Str(1_000).default(''),
      body: Str(100_000).default(''),
    })
    .optional(),
  chat: z
    .strictObject({
      customerName: Str(256).optional(),
      messages: z
        .array(
          z.strictObject({
            from: z.enum(['customer', 'agent', 'bot', 'system']),
            text: Str(8_000),
            at: z.iso.datetime({ offset: true }),
          }),
        )
        .max(500)
        .default([]),
    })
    .optional(),
});
export type EngageEnvelope = z.infer<typeof EngageEnvelopeSchema>;
export type EngageEnvelopeInput = z.input<typeof EngageEnvelopeSchema>;

/** Commands the hub sends to a transport (sidecar via NATS request/reply, Workspace via REST). */
export const EngageCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('updateUserData'),
    commandId: z.string().min(1).max(128),
    interactionId: Id,
    mediaType: EngageMediaSchema,
    agent: EngageAgentSchema.optional(),
    userData: z.record(Str(128), z.union([Str(4_000), z.number()])),
  }),
  z.strictObject({
    type: z.literal('ocsRecordProcessed'),
    commandId: z.string().min(1).max(128),
    interactionId: Id,
    agent: EngageAgentSchema.optional(),
    recordHandle: z.number().int().nonnegative(),
    callResult: z.number().int().min(0).max(100).optional(),
    campaignName: Str(256).optional(),
    applicationId: z.number().int().nonnegative().optional(),
    /** Custom record fields to update (OCS `send_attribute` names). */
    fields: z.record(Str(128), z.union([Str(1_000), z.number()])).default({}),
    /** RecordProcessed (final) vs UpdateCallCompletionStats only. */
    final: z.boolean().default(true),
  }),
]);
export type EngageCommand = z.infer<typeof EngageCommandSchema>;
export type EngageCommandInput = z.input<typeof EngageCommandSchema>;
