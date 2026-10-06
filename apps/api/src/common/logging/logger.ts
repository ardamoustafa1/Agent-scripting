import { trace } from '@opentelemetry/api';
import { pino, type Logger, type LoggerOptions } from 'pino';

import { requestContext } from '../context/request-context.js';

import type { LoggerService } from '@nestjs/common';

/**
 * Keys never logged in clear (CLAUDE.md §4). Covers headers and the common PII/secret field names
 * at the first two nesting levels; request/response bodies are never logged at all.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-verbis-mtls-proxy-secret"]',
  '["x-verbis-mtls-proxy-secret"]',
  '*["x-verbis-mtls-proxy-secret"]',
  'req.headers["x-runtime-session-token"]',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'req.headers["idempotency-key"]',
  'res.headers["set-cookie"]',
  ...[
    'writeToken',
    'ticket',
    'receipt',
    'bffHash',
    'sealedData',
    'password',
    'token',
    'secret',
    'ciphertext',
    'authorization',
    'cookie',
    'email',
    'phone',
    'msisdn',
    'ani',
    'dnis',
    'displayName',
    'notes',
    'note',
    'participants',
    'attributes',
    'iban',
    'pan',
    'cardNumber',
    'cvv',
    'cvc',
    'track1',
    'track2',
    'pinBlock',
    'nationalId',
  ].flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
];

export function createLoggerOptions(level: string): LoggerOptions {
  return {
    level,
    base: { service: 'verbis-api' },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    // Correlates every line with the request, tenant and trace.
    mixin() {
      const ctx = requestContext.get();
      const span = trace.getActiveSpan()?.spanContext();
      return {
        ...(ctx === undefined
          ? {}
          : {
              correlationId: ctx.correlationId,
              ...(ctx.principal === undefined ? {} : { tenantId: ctx.principal.tenantId }),
            }),
        ...(span === undefined ? {} : { traceId: span.traceId, spanId: span.spanId }),
      };
    },
    serializers: {
      // Never log query strings (they may carry PII) or bodies.
      req: (req: { method?: string; url?: string; id?: string }) => ({
        method: req.method,
        url: req.url?.split('?')[0],
        id: req.id,
      }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
  };
}

export function createLogger(level: string): Logger {
  return pino(createLoggerOptions(level));
}

/** Routes Nest's own logs into the same pino instance. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, context?: string): void {
    this.logger.info({ context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string): void {
    // Stack traces may contain data; keep them at debug level only.
    this.logger.error({ context }, String(message));
    if (trace !== undefined) this.logger.debug({ context, stack: trace }, 'error stack');
  }
  warn(message: unknown, context?: string): void {
    this.logger.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string): void {
    this.logger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string): void {
    this.logger.trace({ context }, String(message));
  }
  fatal(message: unknown, context?: string): void {
    this.logger.fatal({ context }, String(message));
  }
}
