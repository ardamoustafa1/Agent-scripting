import { Inject, Injectable } from '@nestjs/common';

import { IdentityAuthenticator } from '../session/identity-authenticator.js';
import { cookieValue } from '../session/session-cookie.js';

import type { BrowserContext, LoginOutcome } from './login-flow.service.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Shared by the OIDC and SAML controllers: reads the browser binding, writes cookies + redirect. */
@Injectable()
export class BrowserResponder {
  constructor(
    @Inject(IdentityAuthenticator) private readonly authenticator: IdentityAuthenticator,
  ) {}

  get cookie() {
    return this.authenticator.cookie;
  }

  context(request: FastifyRequest): BrowserContext {
    const cookie = cookieValue(request.headers.cookie, this.cookie.transactionName);
    return {
      ip: request.ip,
      userAgent: (request.headers['user-agent'] ?? '').slice(0, 512),
      ...(cookie === undefined ? {} : { transactionCookie: cookie }),
    };
  }

  complete(reply: FastifyReply, outcome: LoginOutcome): void {
    this.cookie.clearTransaction(reply);
    if (outcome.session !== undefined)
      this.cookie.set(reply, outcome.session.token, outcome.session.maxAgeSeconds);
    void reply.header('cache-control', 'no-store').redirect(outcome.redirectUrl, 302);
  }
}
