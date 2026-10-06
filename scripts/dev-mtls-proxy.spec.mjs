import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { request } from 'node:https';
import { X509Certificate } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { configureDevEnvironment } from './dev-environment.mjs';
import { createDevMtlsProxy } from './dev-mtls-proxy.mjs';
const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
test('dev mTLS rejects absent certs and replaces forged cert headers before forwarding', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'verbis-mtls-unit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    path.join(root, '.env.example'),
    readFileSync(new URL('../.env.example', import.meta.url)),
  );
  const env = configureDevEnvironment(root);
  const upstream = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        url: req.url,
        certificate: req.headers[env.MTLS_CLIENT_CERT_HEADER],
        proof: req.headers['x-verbis-mtls-proxy-secret'],
      }),
    );
  });
  const upstreamPort = await listen(upstream);
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const edge = createDevMtlsProxy({ ...env, API_INTERNAL_URL: `http://127.0.0.1:${upstreamPort}` });
  const edgePort = await listen(edge);
  t.after(() => new Promise((resolve) => edge.close(resolve)));
  const call = (cert) =>
    new Promise((resolve, reject) => {
      const req = request(
        `https://127.0.0.1:${edgePort}/oauth2/verbis-dev/token`,
        {
          ca: readFileSync(env.HUB_CA_FILE),
          ...(cert
            ? {
                cert: readFileSync(env.HUB_CLIENT_CERT_FILE),
                key: readFileSync(env.HUB_CLIENT_KEY_FILE),
              }
            : {}),
          headers: {
            [env.MTLS_CLIENT_CERT_HEADER]: 'forged',
            'x-verbis-mtls-proxy-secret': 'forged',
          },
          agent: false,
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (text += chunk));
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
        },
      );
      req.on('error', reject);
      req.end();
    });
  await assert.rejects(call(false));
  const result = await call(true);
  assert.equal(result.status, 200);
  assert.equal(result.body.proof, env.MTLS_PROXY_SECRET);
  assert.equal(result.body.url, '/oauth2/verbis-dev/token');
  const forwarded = new X509Certificate(decodeURIComponent(result.body.certificate));
  const expected = new X509Certificate(readFileSync(env.HUB_CLIENT_CERT_FILE));
  assert.equal(forwarded.fingerprint256, expected.fingerprint256);
  assert.throws(() => createDevMtlsProxy({ ...env, NODE_ENV: 'production' }), /development only/);
});
