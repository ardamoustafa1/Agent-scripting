import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import nock from 'nock';
import { expect, it } from 'vitest';

import { GatewayJobSchema } from '../engine/gateway-contracts.js';

import { executeGatewayJob, GatewayTargetsSchema } from './execute-job.js';

const job = () =>
  GatewayJobSchema.parse({
    id: '00000000-0000-4000-8000-000000000001',
    lease: 'a'.repeat(64),
    target: 'crm',
    deadline: Date.now() + 5000,
    maxResponseBytes: 1024,
    command: {
      kind: 'http',
      url: 'http://10.4.5.6/customer',
      method: 'GET',
      headers: { Authorization: 'forged' },
    },
  });
it('injects local credentials, scrubs echoes and never follows redirects', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'verbis-private-http-'));
  try {
    const file = path.join(root, 'bearer');
    writeFileSync(file, 'worker-local-secret', { mode: 0o600 });
    const targets = GatewayTargetsSchema.parse({
      crm: {
        kind: 'http',
        origin: 'http://10.4.5.6',
        allowHttp: true,
        allowedCidrs: ['10.4.0.0/16'],
        bearerTokenFile: file,
      },
    });
    nock('http://10.4.5.6', { reqheaders: { authorization: 'Bearer worker-local-secret' } })
      .get('/customer')
      .reply(200, { echo: 'worker-local-secret' });
    const result = await executeGatewayJob(job(), targets, AbortSignal.timeout(5000));
    expect(JSON.parse(result.body)).toEqual({ echo: '[REDACTED]' });
    nock('http://10.4.5.6')
      .get('/customer')
      .reply(302, '', { Location: 'http://127.0.0.1/private' });
    await expect(executeGatewayJob(job(), targets, AbortSignal.timeout(5000))).rejects.toThrow(
      'REDIRECT_DENIED',
    );
  } finally {
    nock.cleanAll();
    rmSync(root, { recursive: true, force: true });
  }
});
it('denies changed origins, absent targets, expired jobs and response overflow', async () => {
  const targets = GatewayTargetsSchema.parse({
    crm: {
      kind: 'http',
      origin: 'http://10.4.5.6',
      allowHttp: true,
      allowedCidrs: ['10.4.0.0/16'],
    },
  });
  const altered = job();
  if (altered.command.kind === 'http') altered.command.url = 'http://10.4.5.7/customer';
  await expect(executeGatewayJob(altered, targets, AbortSignal.timeout(5000))).rejects.toThrow(
    'EGRESS_DENIED',
  );
  await expect(executeGatewayJob(job(), {}, AbortSignal.timeout(5000))).rejects.toThrow(
    'GATEWAY_TARGET_DENIED',
  );
  await expect(
    executeGatewayJob({ ...job(), deadline: Date.now() - 1 }, targets, AbortSignal.timeout(5000)),
  ).rejects.toThrow('GATEWAY_TARGET_DENIED');
  nock('http://10.4.5.6').get('/customer').reply(200, '12345');
  await expect(
    executeGatewayJob({ ...job(), maxResponseBytes: 4 }, targets, AbortSignal.timeout(5000)),
  ).rejects.toThrow('RESPONSE_TOO_LARGE');
  nock.cleanAll();
});
