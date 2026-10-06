import { randomBytes } from 'node:crypto';
import { createServer as createHttps, request as httpsRequest } from 'node:https';
import { createServer as createTls } from 'node:tls';

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from '../../apps/api/node_modules/vitest/dist/index.js';
import { storedRow } from '../../apps/api/src/modules/audit/core/audit-event.spec.js';
import {
  SyslogConfigSchema,
  WebhookConfigSchema,
} from '../../apps/api/src/modules/audit/siem/sink.js';
import { SyslogTlsSink } from '../../apps/api/src/modules/audit/siem/syslog.sink.js';
import {
  WebhookSink,
  verifyWebhookSignature,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  DELIVERY_HEADER,
} from '../../apps/api/src/modules/audit/siem/webhook.sink.js';
import { generateSpCredential } from '../../apps/api/src/modules/identity/saml/sp-credentials.js';

import type { StoredAuditRow } from '../../apps/api/src/modules/audit/core/audit-event.js';

let tls: ReturnType<typeof createTls>, https: ReturnType<typeof createHttps>, ca: string;
const secret = randomBytes(32).toString('hex'),
  chunks: Buffer[] = [],
  received: { body: string; headers: Record<string, string | string[] | undefined> }[] = [];
const rows: StoredAuditRow[] = [storedRow({ seq: 1n }), storedRow({ seq: 2n })];
function port(server: ReturnType<typeof createTls> | ReturnType<typeof createHttps>) {
  const a = server.address();
  if (!a || typeof a === 'string') throw new Error('No address');
  return a.port;
}
beforeAll(async () => {
  const credential = await generateSpCredential('localhost');
  ca = credential.certificate;
  tls = createTls({ key: credential.privateKey, cert: ca, minVersion: 'TLSv1.2' }, (socket) =>
    socket.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk))),
  );
  https = createHttps(
    { key: credential.privateKey, cert: ca, minVersion: 'TLSv1.2' },
    (req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += String(chunk);
      });
      req.on('end', () => {
        received.push({ body, headers: req.headers });
        res.writeHead(202);
        res.end();
      });
    },
  );
  await Promise.all([
    new Promise<void>((r) => tls.listen(0, '127.0.0.1', r)),
    new Promise<void>((r) => https.listen(0, '127.0.0.1', r)),
  ]);
});
afterAll(async () => {
  await Promise.all([
    new Promise<void>((r, j) =>
      tls.close((e) => {
        if (e) j(e);
        else r();
      }),
    ),
    new Promise<void>((r, j) =>
      https.close((e) => {
        if (e) j(e);
        else r();
      }),
    ),
  ]);
});
describe('V2 SIEM real TLS network output', () => {
  it('syslog verifies a pinned certificate and transmits RFC5425 octet framed RFC5424 events', async () => {
    const sink = new SyslogTlsSink(
      SyslogConfigSchema.parse({
        host: '127.0.0.1',
        port: port(tls),
        servername: 'localhost',
        caPem: ca,
      }),
      { format: 'rfc5424', productVersion: 'audit' },
    );
    await sink.deliver(rows);
    await sink.close();
    await expect.poll(() => chunks.length).toBeGreaterThan(0);
    const data = Buffer.concat(chunks).toString();
    expect(data).toMatch(/^\d+ <110>1 /);
    expect(data.match(/<110>1 /g)).toHaveLength(2);
  });
  it('webhook transmits through real verified HTTPS with HMAC timestamp and stable delivery id', async () => {
    // Per-request trust of our disposable CA; certificate verification remains enabled.
    const sink = new WebhookSink(
      WebhookConfigSchema.parse({ url: `https://localhost:${port(https)}/ingest` }),
      secret,
      async (url, init) => {
        const res = await new Promise<Response>((resolve, reject) => {
          const req = requireHttps()(
            url,
            { method: init.method, headers: init.headers as Record<string, string>, ca },
            (r) => {
              r.resume();
              r.on('end', () => {
                resolve(new Response(null, { status: r.statusCode ?? 500 }));
              });
            },
          );
          req.on('error', reject);
          req.end(init.body as string);
        });
        return res;
      },
    );
    await sink.deliver(rows);
    expect(received).toHaveLength(1);
    const message = received[0]!;
    const timestamp = Number(message.headers[TIMESTAMP_HEADER]);
    expect(
      verifyWebhookSignature(
        secret,
        timestamp,
        message.body,
        String(message.headers[SIGNATURE_HEADER]),
        Math.floor(Date.now() / 1000),
      ),
    ).toBe(true);
    expect(message.headers[DELIVERY_HEADER]).toBe(`${rows[0]!.tenantId}:1-2`);
    expect(JSON.parse(message.body)).toMatchObject({ events: [{ seq: '1' }, { seq: '2' }] });
  });
});
function requireHttps() {
  return httpsRequest;
}
