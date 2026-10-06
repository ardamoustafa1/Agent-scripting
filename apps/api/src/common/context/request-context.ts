import { AsyncLocalStorage } from 'node:async_hooks';

import type { TransactionClient } from '../../infra/database/prisma.service.js';
import type { ResolvedAbility } from '../../modules/authz/ability.factory.js';
import type { Principal } from '../security/principal.js';

/** Per-request state, propagated through async calls (logging, audit, tenant transaction). */
export interface RequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly ip: string;
  readonly userAgent: string;
  principal?: Principal;
  /** Effective type-level permissions (`action:Subject`) resolved for the principal. */
  permissions?: ReadonlySet<string>;
  /** CASL ability of the principal in its tenant (resolved by the AccessGuard). */
  authz?: ResolvedAbility;
  /** Audit events recorded in this request (the audit interceptor skips generic events then). */
  auditRecorded?: number;
  /** The open tenant-scoped transaction, when inside one. */
  tx?: TransactionClient;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  require(): RequestContext {
    const context = storage.getStore();
    if (context === undefined) throw new Error('No request context');
    return context;
  },
  enterWith(context: RequestContext): void {
    storage.enterWith(context);
  },
};

/** Context for work that does not originate from an HTTP request (workers, consumers). */
export function systemContext(correlationId: string, actor: string): RequestContext {
  return { requestId: correlationId, correlationId, ip: '', userAgent: actor };
}
