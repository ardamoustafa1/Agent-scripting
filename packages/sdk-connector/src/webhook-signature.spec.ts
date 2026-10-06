import { describe, expect, it } from 'vitest';

import { signWebhook, verifyWebhook } from './webhook-signature.js';

const body = '{"eventId":"e1"}';
const t = 1_790_000_000;

describe('webhook signatures', () => {
  it('verifies a valid signature and supports rotation', () => {
    const header = signWebhook('new-secret', body, t);
    expect(verifyWebhook(['new-secret'], body, header, t)).toEqual({ ok: true, timestamp: t });
    expect(verifyWebhook(['old-secret', 'new-secret'], body, header, t + 10).ok).toBe(true);
  });
  it('rejects missing, malformed, stale, tampered and wrong-secret requests', () => {
    const header = signWebhook('s', body, t);
    expect(verifyWebhook(['s'], body, undefined, t)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyWebhook(['s'], body, 'garbage', t)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyWebhook(['s'], body, `t=${String(t)}`, t)).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(verifyWebhook(['s'], body, 'x'.repeat(2_000), t)).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(verifyWebhook(['s'], body, header, t + 301)).toEqual({ ok: false, reason: 'stale' });
    expect(verifyWebhook(['s'], `${body} `, header, t)).toEqual({ ok: false, reason: 'mismatch' });
    expect(verifyWebhook(['other'], body, header, t)).toEqual({ ok: false, reason: 'mismatch' });
    expect(verifyWebhook(['s'], body, header.replace(String(t), String(t + 1)), t)).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });
});
