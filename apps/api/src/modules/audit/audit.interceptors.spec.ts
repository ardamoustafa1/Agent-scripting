import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { requestContext, type RequestContext } from '../../common/context/request-context.js';
import { ConflictError, ForbiddenError } from '../../common/errors/domain-errors.js';
import { OwnTenantTransactions } from '../../infra/database/tenant-transaction.interceptor.js';

import { AuditRead, SkipAudit } from './audit.decorators.js';
import { AuditFailureInterceptor, AuditTrailInterceptor } from './audit.interceptors.js';

import type { AuditService } from './audit.service.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { CallHandler, ExecutionContext } from '@nestjs/common';

const TENANT = '0199a000-0000-7000-8000-000000000001';
const principal = { type: 'user' as const, id: 'u', tenantId: TENANT, scopes: [] };

class Routes {
  @OwnTenantTransactions()
  owned(): void {
    /* Test route owns its transaction. */
  }

  mutate(): void {
    // route stub
  }

  @SkipAudit()
  skipped(): void {
    // route stub
  }

  @AuditRead({ action: 'secret.metadata.viewed', resourceType: 'Secret' })
  sensitive(): void {
    // route stub
  }

  read(): void {
    // route stub
  }
}

function http(handler: keyof Routes, method: string, ctx: RequestContext): ExecutionContext {
  const request = {
    method,
    url: '/v1/campaigns/c-1',
    routeOptions: { url: '/v1/campaigns/:id' },
    params: { id: 'c-1' },
    principal,
    verbisContext: ctx,
  };
  return {
    getHandler: () => (Routes.prototype as unknown as Record<string, unknown>)[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function ctxWithTx(): RequestContext {
  return { requestId: 'r', correlationId: 'c', ip: '', userAgent: '', principal, tx: {} as never };
}

const db = {
  current: () => ({}),
  run: vi.fn((_t: string, fn: (tx: unknown) => unknown) => fn({})),
} as unknown as TenantDb;

describe('AuditTrailInterceptor', () => {
  it('fails before running a mutation if tenant transaction context is missing', () => {
    const record = vi.fn();
    const interceptor = new AuditTrailInterceptor(new Reflector(), db, {
      record,
    } as unknown as AuditService);
    const ctx = ctxWithTx();
    delete ctx.tx;
    const handle = vi.fn(() => of('must not run'));
    requestContext.run(ctx, () => {
      expect(() => interceptor.intercept(http('mutate', 'POST', ctx), { handle })).toThrow(
        /tenant transaction/,
      );
    });
    expect(handle).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
  it.each([0, 1])('owned transactions must emit their own event (events=%i)', async (events) => {
    const interceptor = new AuditTrailInterceptor(new Reflector(), db, {
      record: vi.fn(),
    } as unknown as AuditService);
    const ctx = ctxWithTx();
    delete ctx.tx;
    const promise = requestContext.run(ctx, () =>
      lastValueFrom(
        interceptor.intercept(http('owned', 'POST', ctx), {
          handle: () => {
            ctx.auditRecorded = events;
            return of('result');
          },
        }),
      ),
    );
    if (events) await expect(promise).resolves.toBe('result');
    else await expect(promise).rejects.toThrow(/without an audit event/);
  });
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'does not return success when fallback audit persistence fails (%s)',
    async (method) => {
      const interceptor = new AuditTrailInterceptor(new Reflector(), db, {
        record: () => Promise.reject(new Error('audit persistence failed')),
      } as unknown as AuditService);
      const ctx = ctxWithTx();
      await expect(
        requestContext.run(ctx, () =>
          lastValueFrom(
            interceptor.intercept(http('mutate', method, ctx), { handle: () => of('result') }),
          ),
        ),
      ).rejects.toThrow('audit persistence failed');
    },
  );

  const run = async (handler: keyof Routes, method: string, recordedByHandler = 0) => {
    const record = vi.fn(() => Promise.resolve({ id: 'a', seq: 1n, hash: 'h' }));
    const interceptor = new AuditTrailInterceptor(new Reflector(), db, {
      record,
    } as unknown as AuditService);
    const ctx = ctxWithTx();
    const next: CallHandler = {
      handle: () => {
        ctx.auditRecorded = (ctx.auditRecorded ?? 0) + recordedByHandler;
        return of('result');
      },
    };
    const result = await requestContext.run(ctx, () =>
      lastValueFrom(interceptor.intercept(http(handler, method, ctx), next)),
    );
    return { result, record };
  };

  it('adds a generic event to mutations that wrote no domain audit', async () => {
    const { result, record } = await run('mutate', 'PATCH');
    expect(result).toBe('result');
    expect(record).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        action: 'api.campaigns.updated',
        target: { type: 'campaigns', id: 'c-1' },
      }),
    );
  });

  it('does not duplicate when the handler audited, nor for @SkipAudit or plain reads', async () => {
    expect((await run('mutate', 'POST', 1)).record).not.toHaveBeenCalled();
    expect((await run('skipped', 'POST')).record).not.toHaveBeenCalled();
    expect((await run('read', 'GET')).record).not.toHaveBeenCalled();
  });

  it('audits @AuditRead routes', async () => {
    const { record } = await run('sensitive', 'GET');
    expect(record).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        action: 'secret.metadata.viewed',
        target: { type: 'Secret', id: 'c-1' },
      }),
    );
  });
});

describe('AuditFailureInterceptor', () => {
  const fail = async (error: unknown, handler: keyof Routes = 'mutate', method = 'POST') => {
    const record = vi.fn(() => Promise.resolve({ id: 'a', seq: 1n, hash: 'h' }));
    const interceptor = new AuditFailureInterceptor(new Reflector(), db, {
      record,
    } as unknown as AuditService);
    const ctx = ctxWithTx();
    await expect(
      lastValueFrom(
        interceptor.intercept(http(handler, method, ctx), {
          handle: () => throwError(() => error),
        }),
      ),
    ).rejects.toBe(error);
    return record;
  };

  it('records denied (403) and failed (4xx/5xx) attempts in a fresh transaction, then rethrows', async () => {
    const denied = await fail(new ForbiddenError());
    expect(denied).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        action: 'api.request.denied',
        outcome: 'denied',
        reason: 'VERBIS_AUTHZ_FORBIDDEN',
      }),
    );
    const failed = await fail(new ConflictError());
    expect(failed).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        action: 'api.request.failed',
        outcome: 'failure',
        reason: 'VERBIS_RESOURCE_CONFLICT',
      }),
    );
    const sensitive = await fail(new ForbiddenError(), 'sensitive', 'GET');
    expect(sensitive).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ action: 'secret.metadata.viewed', outcome: 'denied' }),
    );
  });

  it('never masks the original error when auditing fails', async () => {
    const interceptor = new AuditFailureInterceptor(new Reflector(), db, {
      record: () => Promise.reject(new Error('db down')),
    } as unknown as AuditService);
    const error = new ConflictError();
    await expect(
      lastValueFrom(
        interceptor.intercept(http('mutate', 'POST', ctxWithTx()), {
          handle: () => throwError(() => error),
        }),
      ),
    ).rejects.toBe(error);
  });
});
