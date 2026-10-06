import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { createFastifyAdapterOptions } from './fastify-options.js';

import type { Logger } from 'pino';

const logger = { level: 'silent' } as unknown as Logger;
describe('createFastifyAdapterOptions trust proxy', () => {
  it('trusts no proxy by default', () => {
    expect(createFastifyAdapterOptions(logger).trustProxy).toBe(false);
  });
  it('resolves the client behind a trusted proxy and ignores spoofed headers from others', async () => {
    const options = { ...createFastifyAdapterOptions(logger, ['10.0.0.0/8']) };
    const { loggerInstance: _l, logController: _c, ...rest } = options;
    const app = Fastify(rest);
    app.get('/ip', (request) => Promise.resolve(request.ip));
    const behind = await app.inject({
      url: '/ip',
      remoteAddress: '10.1.2.3',
      headers: { 'x-forwarded-for': '198.51.100.7' },
    });
    expect(behind.body).toBe('198.51.100.7');
    const direct = await app.inject({
      url: '/ip',
      remoteAddress: '203.0.113.5',
      headers: { 'x-forwarded-for': '198.51.100.7' },
    });
    expect(direct.body).toBe('203.0.113.5');
    await app.close();
  });
});
