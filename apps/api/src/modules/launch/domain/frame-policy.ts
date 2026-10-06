import { z } from 'zod';

/**
 * Embedding policy (SECURITY §4.5): agent-web may be framed only by origins the tenant allow-lists
 * (Genesys, Avaya, CRM hosts). Everything else — and every API response — is `DENY`.
 */
export const FrameAncestorSchema = z
  .string()
  .max(253)
  .regex(
    /^https:\/\/(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+(:\d{1,5})?$/,
    'must be https://host[:port] or https://*.domain (no paths, no bare wildcard)',
  )
  .refine((value) => {
    // `https://*.com` would allow the whole TLD; require at least two labels after the wildcard.
    if (!value.startsWith('https://*.')) return true;
    return value.slice('https://*.'.length).split(':')[0]?.split('.').length !== 1;
  }, 'wildcards need a registrable domain');

export const EmbeddingSettingsSchema = z
  .strictObject({ frameAncestors: z.array(FrameAncestorSchema).max(20).optional() })
  .meta({ id: 'EmbeddingSettings' });
export type EmbeddingSettings = z.infer<typeof EmbeddingSettingsSchema>;

export interface FrameHeaders {
  readonly 'content-security-policy': string;
  readonly 'x-frame-options'?: 'DENY';
}

/** Headers for an agent-web document response of this tenant. */
export function frameHeaders(settings: unknown): FrameHeaders {
  const parsed = EmbeddingSettingsSchema.safeParse(
    (settings as { embedding?: unknown } | null | undefined)?.embedding ?? {},
  );
  const ancestors = parsed.success ? [...new Set(parsed.data.frameAncestors ?? [])].sort() : [];
  if (ancestors.length === 0)
    return { 'content-security-policy': "frame-ancestors 'none'", 'x-frame-options': 'DENY' };
  // X-Frame-Options cannot express an allow-list; CSP frame-ancestors is authoritative here.
  return { 'content-security-policy': `frame-ancestors ${ancestors.join(' ')}` };
}
