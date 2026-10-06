import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../common/errors/domain-errors.js';
import { TenantDb } from '../../../infra/database/tenant-db.js';
import { AuditService } from '../../audit/audit.service.js';
import { IdentityTx } from '../core/identity-tx.js';
import { SESSION_STORE } from '../core/identity.tokens.js';
import { LoginService } from '../login/login.service.js';

import { type SessionStore } from './session-store.js';
import { type SessionRecord, type SessionSummary, summarize } from './session.types.js';

import type { Principal } from '../../../common/security/principal.js';

export type EndReason =
  | 'logout'
  | 'admin'
  | 'self'
  | 'backchannel'
  | 'frontchannel'
  | 'saml_slo'
  | 'refresh_rejected'
  | 'user_deactivated'
  | 'idp_disabled';

/** Ending sessions, always with an audit event and a `session.ended` outbox event. */
@Injectable()
export class SessionService {
  constructor(
    @Inject(SESSION_STORE) private readonly store: SessionStore,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(IdentityTx) private readonly identityTx: IdentityTx,
    @Inject(LoginService) private readonly login: LoginService,
  ) {}

  /** Records sessions that were already removed from Redis, in their own transaction. */
  async recordEnded(
    tenantId: string,
    actor: Principal,
    records: readonly SessionRecord[],
    reason: EndReason,
  ): Promise<void> {
    if (records.length === 0) return;
    await this.identityTx.run(tenantId, actor, async (tx) => {
      for (const record of records) {
        await this.audit.record(tx, {
          action: reason === 'logout' ? 'identity.logout.succeeded' : 'identity.session.revoked',
          target: { type: 'Session', id: record.id },
          after: { reason, userId: record.userId, kind: record.kind, protocol: record.protocol },
        });
        await this.login.sessionEnded(tx, record, reason);
      }
    });
  }

  /** Within an authenticated request transaction. */
  async recordEndedInRequest(records: readonly SessionRecord[], reason: EndReason): Promise<void> {
    const tx = this.db.current();
    for (const record of records) {
      await this.audit.record(tx, {
        action: reason === 'logout' ? 'identity.logout.succeeded' : 'identity.session.revoked',
        target: { type: 'Session', id: record.id },
        after: { reason, userId: record.userId, kind: record.kind, protocol: record.protocol },
      });
      await this.login.sessionEnded(tx, record, reason);
    }
  }

  async list(tenantId: string, userId: string): Promise<SessionSummary[]> {
    const sessions = await this.store.listForUser(tenantId, userId);
    return sessions
      .map((session) => summarize(session.record))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async terminate(
    tenantId: string,
    userId: string,
    sessionId: string,
    reason: EndReason,
  ): Promise<void> {
    const record = await this.store.revokeById(tenantId, userId, sessionId);
    if (record === undefined) throw new NotFoundError('Session');
    await this.recordEndedInRequest([record], reason);
  }

  async terminateAll(
    tenantId: string,
    userId: string,
    reason: EndReason,
    exceptId?: string,
  ): Promise<number> {
    const records = await this.store.revokeAllForUser(
      tenantId,
      userId,
      exceptId === undefined ? {} : { exceptId },
    );
    await this.recordEndedInRequest(records, reason);
    return records.length;
  }
}
