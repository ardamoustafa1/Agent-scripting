import type { FastifyInstance } from 'fastify';

/** ASVS V14.4.2: JSON is data, including error responses; preserve explicit export filenames. */
export function registerJsonSecurity(app: FastifyInstance): void {
  app.addHook('onSend', (_request, reply, payload, done) => {
    const contentType = reply.getHeader('content-type');
    if (
      typeof contentType === 'string' &&
      /^application\/(?:[\w.-]+\+)?json(?:;|$)/i.test(contentType)
    ) {
      if (!reply.hasHeader('content-disposition'))
        reply.header('content-disposition', 'attachment; filename="api.json"');
      reply.header('cache-control', 'private, no-store');
    }
    done(null, payload);
  });
}
