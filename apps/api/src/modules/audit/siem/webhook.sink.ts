import { createHmac, timingSafeEqual } from 'node:crypto';

import { toWireEvent } from '../core/formats.js';

import { PermanentDeliveryError, type SiemSink, type WebhookConfig } from './sink.js';

import type { StoredAuditRow } from '../core/audit-event.js';

export const SIGNATURE_HEADER = 'x-verbis-signature';
export const TIMESTAMP_HEADER = 'x-verbis-timestamp';
export const DELIVERY_HEADER = 'x-verbis-delivery';

/**
 * Signature over `<unix seconds>.<raw body>` with HMAC-SHA256 (`v1=<hex>`). Receivers reject
 * timestamps older than their tolerance (replay) and compare in constant time.
 */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `v1=${createHmac('sha256', secret)
    .update(`${String(timestamp)}.${body}`)
    .digest('hex')}`;
}

export function verifyWebhookSignature(
  secret: string,
  timestamp: number,
  body: string,
  signature: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): boolean {
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const expected = Buffer.from(signWebhook(secret, timestamp, body));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export class WebhookSink implements SiemSink {
  constructor(
    private readonly config: WebhookConfig,
    private readonly secret: string,
    private readonly fetcher: Fetcher = fetch,
    private readonly nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async deliver(rows: readonly StoredAuditRow[]): Promise<void> {
    if (rows.length === 0) return;
    const first = rows[0];
    const last = rows[rows.length - 1];
    if (first === undefined || last === undefined) return;
    const body = JSON.stringify({ events: rows.map((row) => toWireEvent(row)) });
    const timestamp = this.nowSeconds();
    const response = await this.fetcher(this.config.url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(this.config.timeoutMs),
      headers: {
        'content-type': 'application/json',
        [TIMESTAMP_HEADER]: String(timestamp),
        [SIGNATURE_HEADER]: signWebhook(this.secret, timestamp, body),
        // Stable per batch content: receivers dedupe redeliveries with it.
        [DELIVERY_HEADER]: `${first.tenantId}:${first.seq.toString()}-${last.seq.toString()}`,
      },
      body,
    });
    if (response.ok) return;
    const status = response.status;
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
      throw new PermanentDeliveryError(`webhook rejected the batch (${String(status)})`);
    }
    throw new Error(`webhook responded ${String(status)}`);
  }

  async close(): Promise<void> {
    // Stateless.
  }
}
