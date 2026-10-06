import { z } from 'zod';

/**
 * Avaya envelope v1 — contract between the Avaya sidecar (AES JTAPI/TSAPI, DMCC, AACC CCT/CCMM,
 * POM, Proactive Contact) and the hub. JSON Schema twin:
 * `apps/connector-avaya-aes-sidecar/src/main/resources/contracts/avaya-envelope.v1.json`.
 */
const Str = (max: number) => z.string().max(max);
const Id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:@-]+$/);

export const AVAYA_EVENTS = [
  'delivered', // CallCtlConnDeliveredEv / AACC contact presented
  'established', // CallCtlConnEstablishedEv / AACC contact accepted
  'held',
  'retrieved',
  'transferred',
  'conferenced',
  'cleared', // connection/call cleared (agent left)
  'acwCompleted', // agent left after-call work
  'closed', // AACC multimedia contact closed
  'dataChanged', // UUI / intrinsics changed
] as const;

export const AvayaAgentSchema = z.strictObject({
  loginId: Str(64).optional(),
  extension: Str(32).optional(),
  handle: Str(256).optional(),
});
export type AvayaAgent = z.infer<typeof AvayaAgentSchema>;

const Scalar = z.union([Str(1_000), z.number(), z.boolean(), z.null()]);

export const AvayaEnvelopeSchema = z.strictObject({
  schema: z.literal('verbis.avaya.envelope.v1'),
  eventId: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9._:@-]+$/),
  source: z.enum(['aes', 'aacc']),
  event: z.enum(AVAYA_EVENTS),
  occurredAt: z.iso.datetime({ offset: true }),
  /** Voice: UCID (stable across transfers); AACC multimedia: contact id. */
  interactionId: Id,
  /** CM call id (changes on transfer/conference). */
  callId: Str(32).optional(),
  ucid: z
    .string()
    .regex(/^\d{20}$/)
    .optional(),
  mediaType: z.enum([
    'voice',
    'email',
    'chat',
    'sms',
    'social',
    'im',
    'webcomm',
    'fax',
    'scanned',
    'voicemail',
  ]),
  direction: z.enum(['inbound', 'outbound']).default('inbound'),
  agent: AvayaAgentSchema.optional(),
  transferTo: AvayaAgentSchema.optional(),
  ani: Str(64).optional(),
  dnis: Str(64).optional(),
  /** Aura: VDN the call came through; AACC: CDN/route point. */
  vdn: Str(32).optional(),
  /** Aura split/skill (hunt group); AACC skillset name. */
  skill: Str(128).optional(),
  /** UUI as received: ASCII, or hex for binary/shared UUI. ≤ 96 bytes on CM (hex ≤ 192). */
  uui: Str(256).optional(),
  uuiEncoding: z.enum(['ascii', 'hex']).default('ascii'),
  /** AACC contact intrinsics (key → value). */
  intrinsics: z.record(Str(64), Str(1_000)).default({}),
  /** Agent went to after-call work on clear (wrap-up owed). */
  afterCallWork: z.boolean().default(false),
  outbound: z
    .strictObject({
      system: z.enum(['pom', 'pc']),
      campaign: Str(128),
      /** POM contact list / PC calling list (job). */
      list: Str(128).optional(),
      /** POM contact id / PC record (item) id. */
      recordId: Str(128),
      fields: z.record(Str(64), Scalar).default({}),
    })
    .optional(),
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
export type AvayaEnvelope = z.infer<typeof AvayaEnvelopeSchema>;

/** Hub → sidecar commands (`verbis.connector.avaya.<id>.command.v1`). */
export const AvayaCommandSchema = z.discriminatedUnion('type', [
  /** AACC: update contact intrinsics (CCMM). */
  z.strictObject({
    type: z.literal('setIntrinsics'),
    commandId: z.string().min(1).max(128),
    interactionId: Id,
    intrinsics: z.record(Str(64), Str(1_000)),
  }),
  /** AACC disposition: voice activity code (CCT) or multimedia closed reason (CCMM CloseContact). */
  z.strictObject({
    type: z.literal('disposition'),
    commandId: z.string().min(1).max(128),
    interactionId: Id,
    mediaType: z.string().max(32),
    code: Str(128),
    note: Str(4_000).optional(),
    agent: AvayaAgentSchema.optional(),
  }),
  /** POM completion code / PC finished-item code, plus record fields to update. */
  z.strictObject({
    type: z.literal('outboundResult'),
    commandId: z.string().min(1).max(128),
    interactionId: Id,
    system: z.enum(['pom', 'pc']),
    campaign: Str(128),
    recordId: Str(128),
    completionCode: Str(128),
    fields: z.record(Str(64), z.union([Str(1_000), z.number()])).default({}),
    agent: AvayaAgentSchema.optional(),
  }),
]);
export type AvayaCommand = z.infer<typeof AvayaCommandSchema>;
export type AvayaCommandInput = z.input<typeof AvayaCommandSchema>;
