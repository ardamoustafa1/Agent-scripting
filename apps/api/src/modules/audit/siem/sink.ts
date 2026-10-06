import { z } from 'zod';

import type { StoredAuditRow } from '../core/audit-event.js';

/** A SIEM sink delivers an ordered batch; it resolves only when the receiver acknowledged it. */
export interface SiemSink {
  deliver(rows: readonly StoredAuditRow[]): Promise<void>;
  close(): Promise<void>;
}

/** Thrown for failures retrying cannot fix (bad config, 4xx except 408/429). */
export class PermanentDeliveryError extends Error {
  override readonly name = 'PermanentDeliveryError';
}

export const SyslogConfigSchema = z.strictObject({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535).default(6514),
  facility: z.number().int().min(0).max(23).default(13),
  appName: z.string().min(1).max(48).default('verbis'),
  hostname: z.string().min(1).max(255).default('verbis-audit'),
  enterpriseId: z.number().int().min(1).default(32473),
  /** PEM CA bundle for the receiver; system roots when absent. */
  caPem: z.string().max(20_000).optional(),
  servername: z.string().max(253).optional(),
  timeoutMs: z.number().int().min(1000).max(60_000).default(10_000),
});

export const WebhookConfigSchema = z.strictObject({
  url: z.url().refine((u) => u.startsWith('https://'), 'webhooks must use https'),
  timeoutMs: z.number().int().min(1000).max(60_000).default(10_000),
  batchSize: z.number().int().min(1).max(1000).default(100),
});

export const KafkaConfigSchema = z.strictObject({
  topic: z
    .string()
    .min(1)
    .max(249)
    .regex(/^[a-zA-Z0-9._-]+$/),
});

export type SyslogConfig = z.infer<typeof SyslogConfigSchema>;
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;
export type KafkaConfig = z.infer<typeof KafkaConfigSchema>;
