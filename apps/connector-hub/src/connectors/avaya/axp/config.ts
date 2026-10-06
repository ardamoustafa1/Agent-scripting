import { z } from 'zod';

import { RecordingHookConfigSchema } from '../../shared/recording-hook.js';

/**
 * Avaya Experience Platform (AXP, formerly OneCloud CCaaS). Hosts are restricted to
 * `*.api.avayacloud.com` (new) or `*.cc.avayacloud.com` (legacy) — no tenant-chosen hosts (SSRF).
 */
export const AxpConfigSchema = z.strictObject({
  kind: z.literal('workspaces'),
  /** e.g. `na.api.avayacloud.com` (new API base) — token realm lives on the same host. */
  host: z.string().regex(/^[a-z0-9-]{1,63}\.(api|cc)\.avayacloud\.com$/),
  /** AXP account id (realm). */
  accountId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  /** Which AXP agent identifier is the platform user id (CTI identity `avaya_axp`). */
  agentIdentity: z.enum(['loginId', 'agentId']).default('loginId'),
  /** Verbis outcome → AXP disposition code (unmapped pass through). */
  dispositionCodes: z.record(z.string().min(1).max(128), z.string().min(1).max(128)).default({}),
  /** REMOVED ⇒ wrapupRequired (AXP After Contact Work is on for the profile). */
  afterContactWork: z.boolean().default(true),
  /** Accept launches while the agent is only invited (default: connected/ACW only). */
  verifyInvited: z.boolean().default(false),
  recording: RecordingHookConfigSchema.optional(),
  secrets: z.record(z.string(), z.uuid()).optional(),
  maxConcurrent: z
    .partialRecord(
      z.enum(['voice', 'chat', 'email', 'sms', 'whatsapp', 'social']),
      z.number().int().min(1).max(50),
    )
    .optional(),
});
export type AxpConfig = z.infer<typeof AxpConfigSchema>;

export const axpUrls = (config: Pick<AxpConfig, 'host' | 'accountId'>) => ({
  token: `https://${config.host}/auth/realms/${config.accountId}/protocol/openid-connect/token`,
  api: `https://${config.host}`,
});
