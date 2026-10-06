import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';

import { DomainError, ValidationError } from '../../../common/errors/domain-errors.js';

import { SCIM_CONTENT_TYPE, SCIM_ERROR_SCHEMA, ScimError } from './scim.errors.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * SCIM endpoints answer with RFC 7644 §3.12 errors instead of RFC 7807: SCIM clients (Entra ID,
 * Okta, OneLogin) parse that format. Documented exception in ADR-0012.
 */
@Catch()
export class ScimExceptionFilter implements ExceptionFilter {
  readonly #logger = new Logger(ScimExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    let status = 500;
    let detail = 'Internal error';
    let scimType: string | undefined;
    if (exception instanceof ScimError) {
      status = exception.status;
      detail = exception.detail;
      scimType = exception.scimType;
    } else if (exception instanceof ValidationError) {
      status = 400;
      detail =
        (exception.errors ?? []).map((e) => `${e.path}: ${e.message}`).join('; ') ||
        'Invalid request';
      scimType = 'invalidValue';
    } else if (exception instanceof DomainError) {
      const codes: Record<string, number> = {
        VERBIS_AUTH_UNAUTHENTICATED: 401,
        VERBIS_AUTHZ_FORBIDDEN: 403,
        VERBIS_TENANT_INACTIVE: 403,
      };
      status = codes[exception.code] ?? 400;
      detail = exception.detail ?? exception.code;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      detail =
        status === 429 ? 'Too many requests' : status < 500 ? 'Request rejected' : 'Internal error';
      if (status === 429) scimType = 'tooMany';
    } else if (typeof exception === 'object' && exception !== null && 'statusCode' in exception) {
      const code = exception.statusCode;
      if (typeof code === 'number' && code >= 400 && code < 500) {
        status = code;
        detail = code === 429 ? 'Too many requests' : 'Request rejected';
        if (code === 400) scimType = 'invalidSyntax';
      }
    }
    if (status >= 500) {
      const errorType = exception instanceof Error ? exception.name : typeof exception;
      this.#logger.error(`Unhandled ${errorType} in SCIM (correlationId=${request.id})`);
    }
    if (status === 401) void reply.header('www-authenticate', 'Bearer realm="scim"');
    void reply
      .status(status)
      .header('content-type', SCIM_CONTENT_TYPE)
      .send({
        schemas: [SCIM_ERROR_SCHEMA],
        status: String(status),
        ...(scimType === undefined ? {} : { scimType }),
        detail,
      });
  }
}
