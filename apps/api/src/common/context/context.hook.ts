import { randomUUID } from 'node:crypto';

import { type RequestContext, requestContext } from './request-context.js';

import type { FastifyInstance, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    verbisContext: RequestContext;
  }
}

/** Accepted inbound correlation ids: short, printable, no separators that could forge log lines. */
const CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function correlationIdFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value !== undefined && CORRELATION_ID.test(value) ? value : randomUUID();
}

/**
 * Opens the request context first thing (callback-style hook so the AsyncLocalStorage scope
 * covers the rest of the lifecycle) and echoes correlation headers on every response.
 */
export function registerContextHook(app: FastifyInstance): void {
  app.decorateRequest('verbisContext', null as unknown as RequestContext);
  app.addHook('onRequest', (request: FastifyRequest, reply, done) => {
    const context: RequestContext = {
      requestId: randomUUID(),
      // Fastify's request.id is the correlation id (see genReqId in fastify-options).
      correlationId: request.id,
      ip: request.ip,
      userAgent: (request.headers['user-agent'] ?? '').slice(0, 512),
    };
    request.verbisContext = context;
    void reply
      .header('x-correlation-id', context.correlationId)
      .header('x-request-id', context.requestId);
    requestContext.run(context, done);
  });
}
