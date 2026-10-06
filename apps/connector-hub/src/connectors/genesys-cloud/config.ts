import { z } from 'zod';

import { GenesysCloudRegionSchema } from '@verbis/sdk-connector';

const Uuid = z.uuid();

/**
 * Non-secret Genesys Cloud connector configuration (`connectors.config`, adapter `genesys_cloud`).
 * Secrets (`clientId`, `clientSecret` of the Client Credentials OAuth client) come from the vault.
 */
export const GenesysCloudConfigSchema = z.strictObject({
  kind: z.literal('cloud'),
  /** Region key (`eu-central-1`) or domain (`mypurecloud.de`). Hosts derive from an allow-list. */
  region: GenesysCloudRegionSchema,
  /** The Genesys org this connector serves; user links (PKCE) from another org are refused. */
  organizationId: Uuid,
  /** Queues whose conversations are watched (`v2.routing.queues.{id}.conversations`). */
  queueIds: z.array(Uuid).max(2_000).default([]),
  /** Agents watched directly (`v2.users.{id}.conversations`). */
  userIds: z.array(Uuid).max(10_000).default([]),
  /** Also subscribe every member of `queueIds` (listed once at start and on each renewal). */
  subscribeQueueMembers: z.boolean().default(false),
  /** Verbis outcome/wrap-up code → Genesys wrap-up code id. A UUID code is passed through. */
  wrapUpCodes: z.record(z.string().min(1).max(128), Uuid).default({}),
  /** Prefix for participant attributes written back (Architect/Scripts read them). */
  attributePrefix: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_.-]{0,31}$/)
    .default('Verbis.'),
  /** Outbound dialer (preview/predictive/progressive): copy contact-list columns into attributes. */
  dialer: z
    .strictObject({
      enabled: z.boolean().default(true),
      /** Allow-listed columns (data minimisation). Empty + `importAll=false` ⇒ ids only. */
      contactColumns: z.array(z.string().min(1).max(128)).max(200).default([]),
      importAll: z.boolean().default(false),
    })
    .prefault({}),
  /** Accept launches while the agent's communication is still alerting (default: connected only). */
  verifyAlerting: z.boolean().default(false),
  /** Public PKCE OAuth client for agent identity linking — used by the API (BFF), not the hub. */
  userAuth: z.strictObject({ clientId: Uuid, redirectUri: z.url().max(2_048) }).optional(),
  secrets: z.record(z.string(), z.uuid()).optional(),
  maxConcurrent: z
    .partialRecord(
      z.enum(['voice', 'chat', 'email', 'sms', 'whatsapp', 'social', 'callback']),
      z.number().int().min(1).max(50),
    )
    .optional(),
});
export type GenesysCloudConfig = z.infer<typeof GenesysCloudConfigSchema>;

/** Notification topics for a config (+ queue members resolved at runtime). */
export function topicsFor(
  config: Pick<GenesysCloudConfig, 'queueIds' | 'userIds'>,
  extraUserIds: readonly string[] = [],
): string[] {
  return [
    ...config.queueIds.map((id) => `v2.routing.queues.${id}.conversations`),
    ...[...new Set([...config.userIds, ...extraUserIds])].map(
      (id) => `v2.users.${id}.conversations`,
    ),
  ];
}
