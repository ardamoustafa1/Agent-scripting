import { LogController, type FastifyServerOptions } from 'fastify';

import { correlationIdFrom } from './common/context/context.hook.js';

import type { Logger } from 'pino';

/** Fastify options. request.id is the (validated or generated) correlation id. */
export function createFastifyAdapterOptions(
  logger: Logger,
  trustedProxies: readonly string[] = [],
): FastifyServerOptions {
  return {
    loggerInstance: logger,
    genReqId: (req) => correlationIdFrom(req.headers['x-correlation-id']),
    requestIdHeader: false,
    logController: new LogController({
      requestIdLogLabel: 'correlationId',
      disableRequestLogging: false,
    }),
    // Only the listed proxies may set the client IP via X-Forwarded-For (empty = trust none).
    trustProxy: trustedProxies.length === 0 ? false : [...trustedProxies],
    bodyLimit: 1024 * 1024,
  };
}
