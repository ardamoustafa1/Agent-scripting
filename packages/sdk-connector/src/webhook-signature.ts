import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-SHA256 webhook signatures (Generic Webhook Connector). Header format, Stripe-like:
 *   `X-Verbis-Signature: t=<unix seconds>,v1=<hex hmac of "<t>.<raw body>">[,v1=<hex>]`
 * Several `v1` values allow secret rotation. Timestamps outside the tolerance are rejected so a
 * captured request cannot be replayed later; the hub additionally deduplicates `eventId`.
 */
export const SIGNATURE_HEADER = 'x-verbis-signature';
export const DEFAULT_TOLERANCE_SECONDS = 300;

export function signWebhook(secret: string, rawBody: string | Buffer, timestamp: number): string {
  const mac = createHmac('sha256', secret)
    .update(`${String(timestamp)}.`)
    .update(rawBody)
    .digest('hex');
  return `t=${String(timestamp)},v1=${mac}`;
}

export type SignatureFailure = 'missing' | 'malformed' | 'stale' | 'mismatch';

export function verifyWebhook(
  secrets: readonly string[],
  rawBody: string | Buffer,
  header: string | undefined,
  nowSeconds: number,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
): { ok: true; timestamp: number } | { ok: false; reason: SignatureFailure } {
  if (header === undefined || header === '') return { ok: false, reason: 'missing' };
  if (header.length > 1_024) return { ok: false, reason: 'malformed' };
  let timestamp: number | undefined;
  const signatures: Buffer[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=', 2);
    if (key === 't' && value !== undefined && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    else if (key === 'v1' && value !== undefined && /^[a-f0-9]{64}$/.test(value))
      signatures.push(Buffer.from(value, 'hex'));
  }
  if (timestamp === undefined || signatures.length === 0) return { ok: false, reason: 'malformed' };
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return { ok: false, reason: 'stale' };
  for (const secret of secrets) {
    const expected = createHmac('sha256', secret)
      .update(`${String(timestamp)}.`)
      .update(rawBody)
      .digest();
    if (
      signatures.some(
        (candidate) => candidate.length === expected.length && timingSafeEqual(candidate, expected),
      )
    )
      return { ok: true, timestamp };
  }
  return { ok: false, reason: 'mismatch' };
}
