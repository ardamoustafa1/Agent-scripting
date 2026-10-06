import {
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { from, lastValueFrom, type Observable } from 'rxjs';

import { type ApiEnv, API_ENV } from '../../env.js';
import { Prisma } from '../../generated/prisma/client.js';
import { canonicalJson, sha256Hex } from '../crypto/canonical-json.js';
import { DomainError } from '../errors/domain-errors.js';
import { actorRef } from '../security/principal.js';
import { IS_PUBLIC } from '../security/public.decorator.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

const NO_RESPONSE_REPLAY = 'verbis:no-response-replay';
/** Sensitive transient responses must never be persisted by the replay cache. */
export const NoResponseReplay = () => SetMetadata(NO_RESPONSE_REPLAY, true);

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const KEY = /^[A-Za-z0-9._:-]{8,255}$/;
const REPLAYED_HEADERS = ['location', 'etag'] as const;

/** Fingerprint of the request a key was first used with. */
export function requestFingerprint(method: string, path: string, body: unknown): string {
  return sha256Hex(canonicalJson({ method, path, body: body ?? null }));
}

/**
 * Idempotency-Key for POST (draft-ietf-httpapi-idempotency-key-header). Runs inside the request
 * transaction: a concurrent duplicate blocks on the unique index until the first commits, then
 * replays its stored response; a failed first attempt rolls back and the key can be retried.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (this.reflector.get<boolean>(NO_RESPONSE_REPLAY, context.getHandler())) return next.handle();
    const header = request.headers[IDEMPOTENCY_HEADER];
    if (request.method !== 'POST' || header === undefined) return next.handle();
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return next.handle();
    if (typeof header !== 'string' || !KEY.test(header)) {
      throw new DomainError(
        'VERBIS_IDEMPOTENCY_KEY_INVALID',
        'Idempotency-Key must be 8-255 characters of [A-Za-z0-9._:-]',
      );
    }
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const status =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      HttpStatus.CREATED;
    return from(this.handle(request, reply, header, status, next));
  }

  private async handle(
    request: FastifyRequest,
    reply: FastifyReply,
    key: string,
    status: number,
    next: CallHandler,
  ): Promise<unknown> {
    const ctx = request.verbisContext;
    const tx = ctx.tx;
    const principal = ctx.principal;
    if (tx === undefined || principal === undefined) return lastValueFrom(next.handle());
    const path = request.url.split('?')[0] ?? '/';
    const fingerprint = requestFingerprint(request.method, path, request.body);
    const scope = { tenantId: principal.tenantId, principalId: actorRef(principal), key };

    await tx.idempotencyKey.deleteMany({ where: { ...scope, expiresAt: { lt: new Date() } } });
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO idempotency_keys (id, tenant_id, principal_id, key, method, path, request_hash, state, expires_at)
      VALUES (gen_random_uuid(), ${scope.tenantId}::uuid, ${scope.principalId}, ${key}, ${request.method}, ${path},
              ${fingerprint}, 'in_progress', now() + make_interval(hours => ${this.env.IDEMPOTENCY_TTL_HOURS}::integer))
      ON CONFLICT (tenant_id, principal_id, key) DO NOTHING
      RETURNING id`;

    if (inserted.length === 0) {
      const existing = await tx.idempotencyKey.findFirst({ where: scope });
      if (existing === null) throw new DomainError('VERBIS_IDEMPOTENCY_IN_PROGRESS');
      if (existing.requestHash !== fingerprint || existing.path !== path) {
        throw new DomainError(
          'VERBIS_IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was used with a different request',
        );
      }
      if (existing.state !== 'completed') throw new DomainError('VERBIS_IDEMPOTENCY_IN_PROGRESS');
      const headers = (existing.responseHeaders ?? {}) as Record<string, string>;
      void reply
        .status(existing.responseStatus ?? status)
        .headers(headers)
        .header('idempotent-replayed', 'true');
      return existing.responseBody;
    }

    const body: unknown = await lastValueFrom(next.handle());
    const headers: Record<string, string> = {};
    for (const name of REPLAYED_HEADERS) {
      const value = reply.getHeader(name);
      if (typeof value === 'string') headers[name] = value;
    }
    await tx.idempotencyKey.update({
      where: { id: inserted[0]?.id ?? '' },
      data: {
        state: 'completed',
        responseStatus: status,
        // JSON round-trip: stores exactly what the client received (dates as ISO strings).
        responseBody:
          body === undefined || body === null
            ? Prisma.JsonNull
            : (JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue),
        responseHeaders: headers,
      },
    });
    return body;
  }
}
