import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { requestContext } from '../context/request-context.js';
import { DomainError, UnauthenticatedError } from '../errors/domain-errors.js';

import { IS_PUBLIC } from './public.decorator.js';

import type { FastifyRequest } from 'fastify';

/** Global guard: every route requires a verified principal unless marked @Public(). */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.csrfRejected === true) {
      throw new DomainError(
        'VERBIS_AUTH_CSRF_FAILED',
        'The request did not pass cross-site request forgery checks',
      );
    }
    if (request.principal === undefined || request.authRejected === true)
      throw new UnauthenticatedError();
    const ctx = requestContext.get();
    if (ctx !== undefined) ctx.principal = request.principal;
    return true;
  }
}
