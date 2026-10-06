import { request } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWorkerHealthServer } from './health.js';

import type { INestApplicationContext } from '@nestjs/common';
import type { Server } from 'node:http';

let server: Server | undefined;
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) =>
      server?.close(() => {
        resolve();
      }),
    );
});

async function get(path: string, fail: boolean) {
  const ping = fail
    ? vi.fn().mockRejectedValue(new Error('private connection detail'))
    : vi.fn().mockResolvedValue(undefined);
  const app = { get: () => ({ ping }) } as unknown as INestApplicationContext;
  server = createWorkerHealthServer(app);
  const current = server;
  await new Promise<void>((resolve) => current.listen(0, '127.0.0.1', resolve));
  const address = current.address();
  if (!address || typeof address === 'string') throw new Error('missing test listener');
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: address.port, path }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('audit worker health boundary', () => {
  it('is ready when every dependency is available', async () => {
    expect(await get('/health/ready', false)).toEqual({ status: 200, body: '{"status":"ok"}' });
  });
  it('fails readiness without leaking dependency details', async () => {
    expect(await get('/health/ready', true)).toEqual({ status: 503, body: '{"status":"error"}' });
  });
  it('keeps liveness independent of dependency outages', async () => {
    expect((await get('/health/live', true)).status).toBe(200);
  });
  it('exposes no worker administration routes', async () => {
    expect((await get('/admin', false)).status).toBe(404);
  });
});
