import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';

import { PROBLEM_CONTENT_TYPE } from '@verbis/shared-types';

import { toProblem } from './to-problem.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

/** Maps every error to RFC 7807 problem+json (CLAUDE.md §7). 5xx never leak internals. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  readonly #logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    sendProblem(exception, request, reply, this.#logger);
  }
}

export function sendProblem(
  exception: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
  logger: Pick<Logger, 'error'>,
): void {
  const { problem, headers, unexpected } = toProblem(exception, {
    url: request.url,
    correlationId: request.id,
  });
  if (unexpected) {
    // Messages may carry secrets/PII (CLAUDE.md §4): log only the error type and correlation id.
    const errorType = exception instanceof Error ? exception.name : typeof exception;
    logger.error(`Unhandled ${errorType} (correlationId=${request.id}, status=${problem.status})`);
  }
  void reply
    .status(problem.status)
    .headers(headers)
    .header('content-type', PROBLEM_CONTENT_TYPE)
    .send(problem);
}
