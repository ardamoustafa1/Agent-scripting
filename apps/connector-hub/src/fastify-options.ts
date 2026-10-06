import { randomUUID } from 'node:crypto';

/** Fastify options: pino logging with redaction (CLAUDE.md §4: no secrets/PII in logs). */
export function createFastifyAdapterOptions(level: string) {
  return {
    logger: {
      level,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-csrf-token"]',
          'res.headers["set-cookie"]',
        ],
        censor: '[REDACTED]',
      },
    },
    genReqId: () => randomUUID(),
    requestIdHeader: 'x-correlation-id',
    trustProxy: false,
  };
}
