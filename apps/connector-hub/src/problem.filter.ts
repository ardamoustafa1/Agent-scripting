import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { type FastifyReply, type FastifyRequest } from 'fastify';

import {
  PROBLEM_CONTENT_TYPE,
  problemForStatus,
  isProblemCode,
  problemForCode,
} from '@verbis/shared-types';

/** Maps every error to RFC 7807 problem+json (CLAUDE.md §7). 5xx never leak internals. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  readonly #logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) {
      // Messages may carry secrets/PII (CLAUDE.md §4): log only the error type and correlation id.
      const errorType = exception instanceof Error ? exception.name : typeof exception;
      this.#logger.error(`Unhandled ${errorType} (correlationId=${request.id})`);
    }
    const detail = exception instanceof HttpException ? exception.message : undefined;
    const problem = problemForStatus(status, {
      instance: request.url.split('?')[0] ?? '/',
      correlationId: request.id,
      ...(detail !== undefined ? { detail } : {}),
    });

    const payload = exception instanceof HttpException ? exception.getResponse() : undefined;
    if (
      payload &&
      typeof payload === 'object' &&
      'code' in payload &&
      typeof payload.code === 'string' &&
      isProblemCode(payload.code)
    ) {
      Object.assign(
        problem,
        problemForCode(payload.code, {
          instance: request.url.split('?')[0] ?? '/',
          correlationId: request.id,
          detail: problemForCode(payload.code).title,
        }),
      );
    }
    void reply.status(problem.status).header('content-type', PROBLEM_CONTENT_TYPE).send(problem);
  }
}
