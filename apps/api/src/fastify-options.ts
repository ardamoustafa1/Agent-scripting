import { LogController, type FastifyServerOptions } from 'fastify';

import { correlationIdFrom } from './common/context/context.hook.js';

import type { Logger } from 'pino';

/** Fastify options. request.id is the (validated or generated) correlation id. */
export function createFastifyAdapterOptions(logger: Logger): FastifyServerOptions {
  return {
    loggerInstance: logger,
    genReqId: (req) => correlationIdFrom(req.headers['x-correlation-id']),
    requestIdHeader: false,
    logController: new LogController({
      requestIdLogLabel: 'correlationId',
      disableRequestLogging: false,
    }),
    trustProxy: false,
    bodyLimit: 1024 * 1024,
  };
}
