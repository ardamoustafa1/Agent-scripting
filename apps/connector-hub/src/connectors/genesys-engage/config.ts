import { z } from 'zod';

import {
  AttachedDataMapSchema,
  EngageUserDataKeySchema as UserDataKey,
} from '@verbis/sdk-connector';

import { sidecarSubjects } from '../shared/nats-sidecar-transport.js';

export { AttachedDataMapSchema, type AttachedDataMapping } from '@verbis/sdk-connector';

/** OCS record fields sent as attached data (`GSW_*` + custom `send_attribute` fields). */
export const DEFAULT_OUTBOUND_FIELDS = [
  'GSW_RECORD_HANDLE',
  'GSW_CAMPAIGN_NAME',
  'GSW_CALLING_LIST',
  'GSW_APPLICATION_ID',
  'GSW_CHAIN_ID',
  'GSW_PHONE',
  'GSW_ATTEMPTS',
] as const;

const Common = {
  /** Which Genesys person attribute identifies the agent (matched to Verbis CTI identities). */
  agentIdentity: z.enum(['employeeId', 'userName', 'agentLoginId']).default('employeeId'),
  attachedData: AttachedDataMapSchema.default([]),
  /** Prefix for written-back keys that have no mapping. */
  writeBackPrefix: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_]{0,15}$/)
    .default('Verbis_'),
  disposition: z
    .strictObject({
      /** Business-attribute key Genesys reporting reads (default `DispositionCode`). */
      key: UserDataKey.default('DispositionCode'),
      noteKey: UserDataKey.default('Verbis_Note'),
      /** Verbis outcome code → Genesys disposition value (unmapped codes pass through). */
      codes: z.record(z.string().min(1).max(128), z.string().min(1).max(128)).default({}),
      /** After release the agent owes a disposition (ACW) ⇒ `wrapupRequired` instead of `ended`. */
      requireAfterCall: z.boolean().default(true),
    })
    .prefault({}),
  outbound: z
    .strictObject({
      fields: z
        .array(UserDataKey)
        .max(100)
        .default([...DEFAULT_OUTBOUND_FIELDS]),
      /** Verbis outcome → OCS call result (GSW_CALL_RESULT, Genesys enum value). */
      callResults: z
        .record(z.string().min(1).max(128), z.number().int().min(0).max(100))
        .default({}),
      /** Send RecordProcessed when the disposition is set (otherwise only UpdateCallCompletionStats). */
      recordProcessed: z.boolean().default(true),
    })
    .prefault({}),
  secrets: z.record(z.string(), z.uuid()).optional(),
  maxConcurrent: z
    .partialRecord(
      z.enum(['voice', 'chat', 'email', 'sms', 'whatsapp', 'social']),
      z.number().int().min(1).max(50),
    )
    .optional(),
};

/**
 * (a) Workspace API (GWS 9 / Workspace API v3, REST + CometD) — one session per linked agent,
 * authenticated with the agent's own delegated token (no WDE; ADR-0019).
 */
export const WorkspaceConfigSchema = z.strictObject({
  kind: z.literal('workspace'),
  /** GWS / Workspace API base URL (https; on-prem host allow-listed by the admin). */
  baseUrl: z.url({ protocol: /^https$/ }).max(2_048),
  /** Genesys Authentication Service base URL (Authorization Code, client secret in the vault). */
  authUrl: z.url({ protocol: /^https$/ }).max(2_048),
  /** OAuth client id at Genesys Authentication (secret: vault `authClientSecret`). */
  authClientId: z.string().min(1).max(256),
  /** Verbis callback registered on that client (`…/api/v1/genesys-engage/oauth/callback`). */
  redirectUri: z.url().max(2_048),
  /** Media channels to activate in the agent session (never agent state changes). */
  channels: z
    .array(z.enum(['voice', 'chat', 'email', 'sms', 'workitem']))
    .min(1)
    .default(['voice', 'chat', 'email']),
  /** Delegated link lifetime (read by the API). */
  linkTtlHours: z.number().int().min(1).max(24).default(12),
  ...Common,
});

/** (b) Platform SDK sidecar (Java) → NATS JetStream (events) + request/reply (commands, verify). */
export const SidecarConfigSchema = z.strictObject({
  kind: z.literal('sidecar'),
  nats: z.strictObject({
    servers: z
      .array(z.string().regex(/^(tls|nats):\/\/[A-Za-z0-9.-]+:\d{2,5}$/))
      .min(1)
      .max(10),
    /** JetStream stream holding `verbis.connector.engage.<connectorId>.event.v1`. */
    stream: z
      .string()
      .regex(/^[A-Z0-9_]{1,64}$/)
      .default('VERBIS_ENGAGE'),
    requestTimeoutMs: z.number().int().min(500).max(30_000).default(5_000),
  }),
  ...Common,
});

export const GenesysEngageConfigSchema = z.discriminatedUnion('kind', [
  WorkspaceConfigSchema,
  SidecarConfigSchema,
]);
export type GenesysEngageConfig = z.infer<typeof GenesysEngageConfigSchema>;
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
export type SidecarConfig = z.infer<typeof SidecarConfigSchema>;

/** NATS subjects (CLAUDE.md §5 event naming, connector id as routing token). */
export const engageSubjects = (connectorId: string) => sidecarSubjects('engage', connectorId);
