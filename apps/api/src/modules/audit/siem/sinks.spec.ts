import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { storedRow } from '../core/audit-event.spec.js';

import { KafkaSink, type KafkaProducer } from './kafka.sink.js';
import { PermanentDeliveryError, SyslogConfigSchema, WebhookConfigSchema } from './sink.js';
import { SyslogTlsSink, type TlsConnector } from './syslog.sink.js';
import {
  DELIVERY_HEADER,
  SIGNATURE_HEADER,
  signWebhook,
  TIMESTAMP_HEADER,
  verifyWebhookSignature,
  WebhookSink,
} from './webhook.sink.js';

const rows = [storedRow({ seq: 1n }), storedRow({ seq: 2n })];

describe('webhook sink (HMAC)', () => {
  const config = WebhookConfigSchema.parse({ url: 'https://siem.example.test/ingest' });

  it('signs timestamp.body with HMAC-SHA256 and sends a stable delivery id', async () => {
    const fetcher = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response(null, { status: 202 })),
    );
    await new WebhookSink(config, 'shh', fetcher, () => 1_790_000_000).deliver(rows);
    const [url, init] = fetcher.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    const body = init.body as string;
    expect(url).toBe('https://siem.example.test/ingest');
    expect(init.redirect).toBe('error');
    expect(headers[TIMESTAMP_HEADER]).toBe('1790000000');
    expect(headers[SIGNATURE_HEADER]).toBe(signWebhook('shh', 1_790_000_000, body));
    expect(headers[DELIVERY_HEADER]).toBe(`${rows[0]!.tenantId}:1-2`);
    expect(
      verifyWebhookSignature('shh', 1_790_000_000, body, headers[SIGNATURE_HEADER]!, 1_790_000_100),
    ).toBe(true);
    expect(
      verifyWebhookSignature(
        'other',
        1_790_000_000,
        body,
        headers[SIGNATURE_HEADER]!,
        1_790_000_100,
      ),
    ).toBe(false);
    expect(
      verifyWebhookSignature(
        'shh',
        1_790_000_000,
        `${body} `,
        headers[SIGNATURE_HEADER]!,
        1_790_000_100,
      ),
    ).toBe(false);
    // Replay outside the tolerance window.
    expect(
      verifyWebhookSignature('shh', 1_790_000_000, body, headers[SIGNATURE_HEADER]!, 1_790_001_000),
    ).toBe(false);
    expect(JSON.parse(body)).toMatchObject({ events: [{ seq: '1' }, { seq: '2' }] });
  });

  it.each([
    [500, Error],
    [503, Error],
    [408, Error],
    [429, Error],
    [400, PermanentDeliveryError],
    [401, PermanentDeliveryError],
    [404, PermanentDeliveryError],
  ])('status %i → %s', async (status, type) => {
    const sink = new WebhookSink(config, 'k', () =>
      Promise.resolve(new Response(null, { status })),
    );
    await expect(sink.deliver(rows)).rejects.toBeInstanceOf(type);
  });

  it('skips empty batches and requires https', async () => {
    const fetcher = vi.fn();
    await new WebhookSink(config, 'k', fetcher).deliver([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(WebhookConfigSchema.safeParse({ url: 'http://siem.example.test' }).success).toBe(false);
  });
});

class FakeTlsSocket extends EventEmitter {
  destroyed = false;
  written: Buffer[] = [];
  failWrite = false;
  write(data: Buffer, cb: (error?: Error | null) => void): boolean {
    if (this.failWrite) cb(new Error('EPIPE'));
    else {
      this.written.push(data);
      cb(null);
    }
    return true;
  }
  end(cb: () => void): void {
    this.destroyed = true;
    cb();
  }
  destroy(error?: Error): void {
    this.destroyed = true;
    if (error !== undefined) this.emit('error', error);
  }
}

describe('syslog TLS sink', () => {
  const config = SyslogConfigSchema.parse({ host: 'siem.example.test' });

  it('connects with TLS ≥ 1.2 and certificate verification, writes octet-counted frames', async () => {
    const socket = new FakeTlsSocket();
    const connector = vi.fn(() => {
      setImmediate(() => socket.emit('secureConnect'));
      return socket;
    });
    const sink = new SyslogTlsSink(
      config,
      { format: 'rfc5424', productVersion: '1' },
      connector as unknown as TlsConnector,
    );
    await sink.deliver(rows);
    await sink.deliver(rows);
    expect(connector).toHaveBeenCalledTimes(1);
    expect(connector.mock.calls[0]).toEqual([
      expect.objectContaining({
        host: 'siem.example.test',
        port: 6514,
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
      }),
    ]);
    const text = Buffer.concat(socket.written).toString('utf8');
    expect(text).toMatch(/^\d+ <110>1 /);
    expect(text.match(/<110>1 /g)).toHaveLength(4);
    await sink.close();
    expect(socket.destroyed).toBe(true);
  });

  it('fails the batch on write errors and connection errors', async () => {
    const socket = new FakeTlsSocket();
    socket.failWrite = true;
    const ok = vi.fn(() => {
      setImmediate(() => socket.emit('secureConnect'));
      return socket;
    });
    await expect(
      new SyslogTlsSink(
        config,
        { format: 'cef', productVersion: '1' },
        ok as unknown as TlsConnector,
      ).deliver(rows),
    ).rejects.toThrow('EPIPE');
    const broken = new FakeTlsSocket();
    const bad = vi.fn(() => {
      setImmediate(() => broken.emit('error', new Error('certificate has expired')));
      return broken;
    });
    await expect(
      new SyslogTlsSink(
        config,
        { format: 'json', productVersion: '1' },
        bad as unknown as TlsConnector,
      ).deliver(rows),
    ).rejects.toThrow('expired');
  });
});

describe('kafka sink', () => {
  it('sends keyed by tenant with acks=all', async () => {
    const send = vi.fn(() => Promise.resolve());
    const disconnect = vi.fn(() => Promise.resolve());
    const producer: KafkaProducer = { send, disconnect };
    const sink = new KafkaSink({ topic: 'verbis.audit' }, producer);
    await sink.deliver(rows);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'verbis.audit',
        acks: -1,
        messages: [
          expect.objectContaining({
            key: rows[0]!.tenantId,
            headers: { seq: '1', hash: rows[0]!.hash },
          }),
          expect.anything(),
        ],
      }),
    );
    await sink.close();
    expect(disconnect).toHaveBeenCalled();
  });
});
