import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import nock from 'nock';
import { expect, it } from 'vitest';

import { generateSpCredential } from '../../identity/saml/sp-credentials.js';

import { GatewayWorkerConfigSchema, runGatewayWorker } from './worker.js';

it('polls outward with certificate credentials, executes a local HTTP target and returns only a single-use result', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'verbis-worker-'));
  const stop = new AbortController();
  const timer = setTimeout(() => {
    stop.abort();
  }, 5000);
  try {
    const credential = await generateSpCredential('gateway-worker-test');
    const certFile = path.join(root, 'cert.pem'),
      keyFile = path.join(root, 'key.pem');
    writeFileSync(certFile, credential.certificate, { mode: 0o600 });
    writeFileSync(keyFile, credential.privateKey, { mode: 0o600 });
    const clientId = '00000000-0000-4000-8000-000000000001';
    const config = GatewayWorkerConfigSchema.parse({
      apiOrigin: 'https://api.example.test',
      tenantSlug: 'customer',
      clientId,
      certFile,
      keyFile,
      caFile: certFile,
      targets: {
        crm: {
          kind: 'http',
          origin: 'http://10.4.5.6',
          allowHttp: true,
          allowedCidrs: ['10.4.0.0/16'],
        },
      },
    });
    const id = '00000000-0000-4000-8000-000000000002',
      lease = 'a'.repeat(64);
    const grant = nock(config.apiOrigin)
      .post(
        '/oauth2/customer/token',
        `grant_type=client_credentials&client_id=${clientId}&scope=execute%3AIntegration`,
      )
      .reply(200, { access_token: 'certificate-bound-fixture', expires_in: 300 });
    const claim = nock(config.apiOrigin, {
      reqheaders: { authorization: 'Bearer certificate-bound-fixture' },
    })
      .post('/v1/private-egress/jobs/claim', {})
      .reply(200, {
        id,
        lease,
        target: 'crm',
        deadline: Date.now() + 5000,
        maxResponseBytes: 1024,
        command: { kind: 'http', url: 'http://10.4.5.6/customer', method: 'GET', headers: {} },
      });
    const upstream = nock('http://10.4.5.6').get('/customer').reply(200, { status: 'active' });
    let completed: unknown;
    const completion = nock(config.apiOrigin, {
      reqheaders: { authorization: 'Bearer certificate-bound-fixture' },
    })
      .post(`/v1/private-egress/jobs/${id}/complete`, (body: unknown) => {
        completed = body;
        return true;
      })
      .reply(204, () => {
        stop.abort();
        return '';
      });
    await runGatewayWorker(config, stop.signal);
    expect(completed).toEqual({ lease, response: { status: 200, body: '{"status":"active"}' } });
    for (const request of [grant, claim, upstream, completion]) expect(request.isDone()).toBe(true);
  } finally {
    clearTimeout(timer);
    stop.abort();
    nock.cleanAll();
    rmSync(root, { recursive: true, force: true });
  }
});
