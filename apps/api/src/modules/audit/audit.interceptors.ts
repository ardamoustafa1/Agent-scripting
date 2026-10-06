import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchError, concatMap, from, type Observable, throwError } from 'rxjs';

import { requestContext } from '../../common/context/request-context.js';
import { AuditedDomainError } from '../../common/errors/domain-errors.js';
import { toProblem } from '../../common/errors/to-problem.js';
import { IS_PUBLIC } from '../../common/security/public.decorator.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { OWN_TENANT_TRANSACTIONS } from '../../infra/database/tenant-transaction.interceptor.js';

import { AUDIT_READ, SKIP_AUDIT, type AuditReadOptions } from './audit.decorators.js';
import { AuditService } from './audit.service.js';

import type { FastifyRequest } from 'fastify';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function route(request: FastifyRequest): string {
  return request.routeOptions.url ?? request.url.split('?')[0] ?? '';
}

function resourceOf(request: FastifyRequest, idParam = 'id'): { type: string; id: string } {
  const params = (request.params ?? {}) as Record<string, unknown>;
  const raw = params[idParam];
  // `/v1/campaigns/:id` → `campaigns`
  const type =
    route(request)
      .split('/')
      .find((p) => p !== '' && !p.startsWith(':') && p !== 'v1') ?? 'api';
  return { type, id: typeof raw === 'string' ? raw : '*' };
}

function verbOf(method: string): string {
  if (method === 'POST') return 'created';
  if (method === 'DELETE') return 'deleted';
  return 'updated';
}

/**
 * Inner interceptor (inside the request transaction):
 * - every successful mutation that did not write its own domain audit event gets a generic
 *   `api.<resource>.<verb>` event, atomically with the change;
 * - `@AuditRead` routes audit the successful read (PII reveal, secret metadata, export…).
 */
@Injectable()
export class AuditTrailInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return next.handle();
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const read = this.reflector.getAllAndOverride<AuditReadOptions | undefined>(
      AUDIT_READ,
      targets,
    );
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT, targets);
    const mutating = MUTATING.has(request.method) && !skip;
    if (read === undefined && !mutating) return next.handle();
    const owned = this.reflector.get<boolean>(OWN_TENANT_TRANSACTIONS, context.getHandler());
    const initial = requestContext.get();
    if (initial?.principal === undefined || (initial.tx === undefined && !owned))
      throw new Error('Audited request requires an authenticated tenant transaction');
    const before = initial.auditRecorded ?? 0;

    return next.handle().pipe(
      concatMap((result: unknown) =>
        from(
          (async () => {
            const ctx = requestContext.get();
            if (ctx?.principal === undefined) throw new Error('Audit principal was lost');
            if (ctx.tx === undefined) {
              if (owned && read === undefined && (ctx.auditRecorded ?? 0) > before) return result;
              throw new Error('Owned tenant transaction completed without an audit event');
            }
            if (read !== undefined) {
              await this.audit.record(this.db.current(), {
                action: read.action,
                target: { ...resourceOf(request, read.idParam), type: read.resourceType },
                metadata: { method: request.method, route: route(request) },
              });
            } else if ((ctx.auditRecorded ?? 0) === before) {
              const resource = resourceOf(request);
              await this.audit.record(this.db.current(), {
                action: `api.${resource.type.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())}.${verbOf(request.method)}`,
                target: resource,
                metadata: { method: request.method, route: route(request) },
              });
            }
            return result;
          })(),
        ),
      ),
    );
  }
}

/**
 * Outermost interceptor: when a request fails, its transaction (and any audit written in it) has
 * rolled back. The attempt is recorded in a fresh transaction as `denied` (401/403) or `failure`,
 * so failed and refused mutations are never invisible. Audit-write failures are logged, never
 * masking the original error.
 */
@Injectable()
export class AuditFailureInterceptor implements NestInterceptor {
  readonly #logger = new Logger(AuditFailureInterceptor.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return next.handle();
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const sensitiveRead = this.reflector.getAllAndOverride<AuditReadOptions | undefined>(
      AUDIT_READ,
      targets,
    );
    if (!MUTATING.has(request.method) && sensitiveRead === undefined) return next.handle();

    return next
      .handle()
      .pipe(
        catchError((error: unknown) =>
          from(this.recordFailure(request, error, sensitiveRead)).pipe(
            concatMap(() => throwError(() => error)),
          ),
        ),
      );
  }

  async recordFailure(
    request: FastifyRequest,
    error: unknown,
    read?: AuditReadOptions,
  ): Promise<void> {
    const ctx = request.verbisContext;
    const principal = request.principal;
    if (principal === undefined) return;
    const { problem } = toProblem(error, { url: request.url, correlationId: ctx.correlationId });
    const denied = problem.status === 401 || problem.status === 403;
    const resource = resourceOf(request, read?.idParam);
    try {
      await requestContext.run({ ...ctx, principal, auditRecorded: 0 }, () =>
        this.tenantDb.run(principal.tenantId, async (tx) => {
          if (error instanceof AuditedDomainError) {
            // Specific security events (e.g. launch denials) replace the generic one.
            for (const event of error.events)
              await this.audit.record(tx, {
                action: event.action,
                target: event.target,
                outcome: event.outcome ?? 'denied',
                reason: event.reason,
                ...(event.interactionId === undefined
                  ? {}
                  : { interactionId: event.interactionId }),
                metadata: {
                  ...event.metadata,
                  method: request.method,
                  route: route(request),
                  status: problem.status,
                },
              });
            return;
          }
          await this.audit.record(tx, {
            action: read?.action ?? `api.request.${denied ? 'denied' : 'failed'}`,
            target: read === undefined ? resource : { ...resource, type: read.resourceType },
            outcome: denied ? 'denied' : 'failure',
            reason: problem.code,
            metadata: { method: request.method, route: route(request), status: problem.status },
          });
        }),
      );
    } catch {
      this.#logger.error(`Failed to audit a failed request (correlationId=${ctx.correlationId})`);
    }
  }
}
