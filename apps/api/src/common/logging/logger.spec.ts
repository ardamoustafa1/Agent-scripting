import { Writable } from 'node:stream';

import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { requestContext } from '../context/request-context.js';

import { createLoggerOptions, PinoNestLogger } from './logger.js';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });
  return { logger: pino(createLoggerOptions('trace'), stream), lines };
}

describe('logger', () => {
  it('redacts secrets and PII at any of the first levels', () => {
    const { logger, lines } = capture();
    logger.info(
      {
        req: { headers: { authorization: 'Bearer x', cookie: 'c' } },
        email: 'a@b.c',
        user: { password: 'p', profile: { phone: '555' } },
        ok: 1,
      },
      'm',
    );
    const line = lines[0] ?? {};
    // Pino's numeric timestamp may contain the phone digits; inspect the logged payload.
    expect(
      JSON.stringify({ req: line['req'], email: line['email'], user: line['user'] }),
    ).not.toMatch(/Bearer x|a@b\.c|"p"|555/);
    expect(line).toMatchObject({
      email: '[REDACTED]',
      user: { password: '[REDACTED]', profile: { phone: '[REDACTED]' } },
    });
    expect(line['ok']).toBe(1);
  });

  it('never logs query strings and adds request context', () => {
    const { logger, lines } = capture();
    requestContext.run(
      {
        requestId: 'r',
        correlationId: 'corr-9',
        ip: '',
        userAgent: '',
        principal: { type: 'user', id: 'u', tenantId: 't-1', scopes: [] },
      },
      () => {
        logger.info(
          {
            req: { method: 'GET', url: '/v1/users?email=a@b.c', id: 'corr-9' },
            res: { statusCode: 200 },
          },
          'request',
        );
      },
    );
    expect(lines[0]).toMatchObject({
      correlationId: 'corr-9',
      tenantId: 't-1',
      req: { method: 'GET', url: '/v1/users' },
      res: { statusCode: 200 },
    });
  });

  it('routes Nest log levels', () => {
    const { logger, lines } = capture();
    const nest = new PinoNestLogger(logger);
    nest.log('l', 'Ctx');
    nest.warn('w');
    nest.debug('d');
    nest.verbose('v');
    nest.fatal('f');
    nest.error('e', 'stack', 'Ctx');
    expect(lines.map((line) => line['level'])).toEqual([30, 40, 20, 10, 60, 50, 20]);
    expect(lines[5]).not.toHaveProperty('stack');
  });
});
