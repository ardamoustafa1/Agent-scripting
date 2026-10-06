import { z } from 'zod';

import { sidecarSubjects } from '../shared/nats-sidecar-transport.js';
import { RecordingHookConfigSchema } from '../shared/recording-hook.js';

const Code = z.string().min(1).max(128);

/** UUI decoding (docs/connectors/avaya.md §UUI). */
export const UuiConfigSchema = z
  .strictObject({
    /**
     * `raw`: one variable `uui.raw`; `kv`: `k=v|k2=v2` pairs → `uui.<k>`;
     * `shared`: CM shared UUI (hex `id len data …`) → `uui.<name>` via `sharedIds`.
     */
    format: z.enum(['raw', 'kv', 'shared']).default('raw'),
    pairSeparator: z.string().min(1).max(3).default('|'),
    keyValueSeparator: z.string().min(1).max(3).default('='),
    /** Shared UUI element id (2 hex digits) → variable name. */
    sharedIds: z
      .record(z.string().regex(/^[0-9A-Fa-f]{2}$/), z.string().regex(/^[A-Za-z0-9_.-]{1,48}$/))
      .default({}),
    /** Only these UUI keys become variables (empty = all decoded keys). */
    allow: z
      .array(z.string().regex(/^[A-Za-z0-9_.-]{1,48}$/))
      .max(50)
      .default([]),
  })
  .prefault({});

const Common = {
  /** Which agent identifier is the platform user id (CTI identity `avaya_aes`/`avaya_aacc`). */
  agentIdentity: z.enum(['loginId', 'extension', 'handle']).default('loginId'),
  uui: UuiConfigSchema,
  /** Verbis outcome → platform code (AACC activity code / closed reason). Unmapped pass through. */
  dispositionCodes: z.record(Code, Code).default({}),
  outbound: z
    .strictObject({
      /** Verbis outcome → POM completion code / PC completion code. */
      completionCodes: z.record(Code, Code).default({}),
      /** Record fields exposed as `outbound.<field>` (empty = all fields the sidecar sends). */
      fields: z.array(z.string().max(64)).max(200).default([]),
    })
    .prefault({}),
  /** Secure pause via the recording system (secret `recorderSecret`). */
  recording: RecordingHookConfigSchema.optional(),
  secrets: z.record(z.string(), z.uuid()).optional(),
  maxConcurrent: z
    .partialRecord(
      z.enum(['voice', 'chat', 'email', 'sms', 'social']),
      z.number().int().min(1).max(50),
    )
    .optional(),
};

/** Avaya Aura AES / AACC through the Java sidecar (ADR-0020). */
export const AvayaSidecarConfigSchema = z.strictObject({
  kind: z.literal('sidecar'),
  nats: z.strictObject({
    servers: z
      .array(z.string().regex(/^(tls|nats):\/\/[A-Za-z0-9.-]+:\d{2,5}$/))
      .min(1)
      .max(10),
    stream: z
      .string()
      .regex(/^[A-Z0-9_]{1,64}$/)
      .default('VERBIS_AVAYA'),
    requestTimeoutMs: z.number().int().min(500).max(30_000).default(5_000),
  }),
  /** AACC: only these intrinsic keys become variables (`intrinsic.<key>`). */
  intrinsics: z.array(z.string().max(64)).max(100).default([]),
  ...Common,
});
export type AvayaSidecarConfig = z.infer<typeof AvayaSidecarConfigSchema>;

export const avayaSubjects = (connectorId: string) => sidecarSubjects('avaya', connectorId);
