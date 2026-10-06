import { type ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ProblemDetailsFilter } from './problem.filter.js';

function createHost(url: string) {
  const reply = {
    status: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ url, id: 'req-1' }),
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost;
  return { host, reply };
}

describe('ProblemDetailsFilter', () => {
  it('hides internals of unexpected errors behind a 500 problem', () => {
    const logSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, reply } = createHost('/v1/things?token=abc');
    new ProblemDetailsFilter().catch(new Error('db password is hunter2'), host);
    expect(logSpy).toHaveBeenCalledWith('Unhandled Error (correlationId=req-1)');
    logSpy.mockRestore();
    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.header).toHaveBeenCalledWith('content-type', 'application/problem+json');
    const body = reply.send.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toMatchObject({
      status: 500,
      code: 'VERBIS_HTTP_INTERNAL',
      instance: '/v1/things',
    });
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(JSON.stringify(body)).not.toContain('token');
  });

  it('handles non-Error throwables', () => {
    const logSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, reply } = createHost('/x');
    new ProblemDetailsFilter().catch('boom', host);
    expect(reply.status).toHaveBeenCalledWith(500);
    expect(logSpy).toHaveBeenCalledWith('Unhandled string (correlationId=req-1)');
    logSpy.mockRestore();
  });

  it('keeps safe detail and correlation id for client errors', () => {
    const { host, reply } = createHost('/v1/things');
    new ProblemDetailsFilter().catch(new BadRequestException('name is required'), host);
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send.mock.calls[0]?.[0]).toMatchObject({
      code: 'VERBIS_HTTP_BAD_REQUEST',
      detail: 'name is required',
      correlationId: 'req-1',
    });
  });
});
