import { describe, expect, it } from 'vitest';

import { verifyWebhook } from '@verbis/sdk-connector';

import { RecordingHook, RecordingHookConfigSchema } from './recording-hook.js';

const NOW = new Date('2026-10-01T10:00:00.000Z');

describe('recording hook (secure pause)', () => {
  it('posts a signed, idempotent pause keyed by UCID and sends each commandId once', async () => {
    const calls: { body: string; signature: string | null; key: string | null }[] = [];
    const fetchImpl = ((_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      calls.push({
        body:
          typeof init.body === 'string'
            ? init.body
            : (() => {
                throw new Error('Expected JSON request body');
              })(),
        signature: headers.get('x-verbis-signature'),
        key: headers.get('idempotency-key'),
      });
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;
    const hook = new RecordingHook(
      RecordingHookConfigSchema.parse({ url: 'https://recorder.acme.internal/verbis' }),
      () => Promise.resolve('rec-secret-test'),
      () => NOW,
      fetchImpl,
    );
    await hook.send('pause', 'cmd-1', {
      interactionId: 'conn-1',
      ucid: '00001002011696172345',
      extension: '4001',
    });
    await hook.send('pause', 'cmd-1', { interactionId: 'conn-1', ucid: '00001002011696172345' });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({
      action: 'pause',
      callKey: 'ucid',
      call: '00001002011696172345',
      extension: '4001',
    });
    expect(calls[0]?.key).toBe('cmd-1');
    expect(
      verifyWebhook(
        ['rec-secret-test'],
        calls[0]?.body ?? '',
        calls[0]?.signature ?? undefined,
        Math.floor(NOW.getTime() / 1000),
      ).ok,
    ).toBe(true);
  });

  it('falls back to the interaction id, refuses http URLs and marks 5xx retryable', async () => {
    expect(RecordingHookConfigSchema.safeParse({ url: 'http://recorder' }).success).toBe(false);
    const failing = (() => Promise.resolve(new Response(null, { status: 503 }))) as typeof fetch;
    const hook = new RecordingHook(
      RecordingHookConfigSchema.parse({ url: 'https://r.example/x' }),
      () => Promise.resolve('s'),
      () => NOW,
      failing,
    );
    await expect(hook.send('resume', 'c2', { interactionId: 'conn-2' })).rejects.toMatchObject({
      code: 'recorder_failed',
      retryable: true,
    });
  });
});
