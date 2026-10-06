import { Inject, Injectable } from '@nestjs/common';

import { DomainError } from '../../../common/errors/domain-errors.js';
import { type ApiEnv, API_ENV } from '../../../env.js';
import { OutboxWriter } from '../../../infra/outbox/outbox.writer.js';
import { AuditService } from '../../audit/audit.service.js';
import { reserveTenantCapacity } from '../../tenancy/quota.js';
import { identityActor, IdentityTx, userActor } from '../core/identity-tx.js';
import { SESSION_STORE } from '../core/identity.tokens.js';
import { mapRoles } from '../idp/role-mapping.js';
import { ssoSessionPolicy } from '../session/session-policy.js';
import {
  ConcurrentSessionLimitError,
  type CreatedSession,
  SessionStore,
} from '../session/session-store.js';

import { RoleSync } from './role-sync.js';

import type { TransactionClient } from '../../../infra/database/prisma.service.js';
import type { LoadedIdp } from '../idp/idp.repository.js';
import type { NewSession, SessionRecord } from '../session/session.types.js';

/** Identity asserted by an IdP after protocol validation (OIDC id_token / SAML assertion). */
export interface ExternalIdentity {
  readonly subject: string;
  readonly email?: string;
  readonly emailVerified: boolean;
  readonly displayName?: string;
  readonly locale?: string;
  /** Full claim/attribute set, input to role mapping. */
  readonly claims: Readonly<Record<string, unknown>>;
}

export interface LoginContext {
  readonly app: string;
  readonly ip: string;
  readonly userAgent: string;
  readonly protocolData: Pick<NewSession, 'oidc' | 'saml' | 'amr' | 'acr'>;
}

/** Reasons recorded in `identity.login.failed` (never PII). */
export type LoginFailureReason =
  | 'user_not_provisioned'
  | 'user_inactive'
  | 'session_limit'
  | 'idp_inactive'
  | 'tenant_inactive'
  | 'protocol_error'
  | 'transaction_invalid'
  | 'unsolicited_response'
  | 'replay';

/** A rejected login whose failure is already audited; `reason` drives the user-facing code. */
export class LoginFailedError extends DomainError {
  override readonly name = 'LoginFailedError';
  constructor(readonly reason: LoginFailureReason) {
    super(
      reason === 'session_limit' ? 'VERBIS_AUTH_SESSION_LIMIT_REACHED' : 'VERBIS_AUTH_LOGIN_FAILED',
    );
  }
}

export class LoginRejectedError extends Error {
  override readonly name = 'LoginRejectedError';
  constructor(readonly reason: LoginFailureReason) {
    super(reason);
  }
}

const LOCALE = /^[a-z]{2}(-[A-Z]{2})?$/;

/**
 * Turns a validated external identity into a Verbis session: finds the linked user, links by
 * verified email, or JIT-provisions; enforces user status; synchronizes IdP-mapped roles; creates
 * the Redis session and records the audit trail, all in one tenant transaction.
 */
@Injectable()
export class LoginService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(IdentityTx) private readonly identityTx: IdentityTx,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Inject(RoleSync) private readonly roles: RoleSync,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
  ) {}

  async completeSsoLogin(
    idp: LoadedIdp,
    external: ExternalIdentity,
    context: LoginContext,
  ): Promise<CreatedSession> {
    const tenantId = idp.tenantId;
    let created: CreatedSession | undefined;
    try {
      return await this.identityTx.run(tenantId, identityActor(tenantId), async (tx) => {
        const tenant = await tx.tenant.findFirst({
          where: { id: tenantId },
          select: { status: true, settings: true },
        });
        if (tenant?.status !== 'active') throw new LoginRejectedError('tenant_inactive');
        const userId = await this.resolveUser(tx, idp, external);
        const user = await tx.user.findFirst({
          where: { id: userId, tenantId },
          select: { status: true },
        });
        if (user?.status !== 'active') throw new LoginRejectedError('user_inactive');

        await this.roles.sync(
          tx,
          tenantId,
          userId,
          `claims:${idp.id}`,
          mapRoles(idp.config.roleMapping, external.claims),
        );
        const now = new Date();
        await tx.user.update({ where: { id: userId }, data: { lastLoginAt: now } });

        try {
          created = await this.sessions.create(
            {
              tenantId,
              userId,
              kind: 'sso',
              protocol: idp.protocol,
              idpId: idp.id,
              app: context.app,
              ip: context.ip.slice(0, 64),
              userAgent: context.userAgent.slice(0, 512),
              ...context.protocolData,
            },
            ssoSessionPolicy(tenant.settings, this.env),
          );
        } catch (error) {
          if (error instanceof ConcurrentSessionLimitError)
            throw new LoginRejectedError('session_limit');
          throw error;
        }
        await this.recordSessionStart(tx, created.record, created.evicted);
        return created;
      });
    } catch (error) {
      // The DB part rolled back: never leave a Redis session behind without its audit record.
      if (created !== undefined)
        await this.sessions.revokeHash(SessionStore.hashToken(created.token));
      if (error instanceof LoginRejectedError) {
        await this.recordFailure(idp, error.reason);
        throw new LoginFailedError(error.reason);
      }
      throw error;
    }
  }

  /** `identity.login.failed` in its own transaction (the login itself rolled back). */
  async recordFailure(
    idp: Pick<LoadedIdp, 'id' | 'tenantId' | 'protocol'>,
    reason: LoginFailureReason,
  ): Promise<void> {
    await this.identityTx.record(idp.tenantId, identityActor(idp.tenantId), {
      action: 'identity.login.failed',
      target: { type: 'IdentityProvider', id: idp.id },
      outcome:
        reason === 'user_not_provisioned' || reason === 'user_inactive' ? 'denied' : 'failure',
      after: { reason, protocol: idp.protocol },
    });
  }

  /** Audit + outbox for a new session, and for sessions it evicted (concurrent limit). */
  async recordSessionStart(
    tx: TransactionClient,
    record: SessionRecord,
    evicted: readonly SessionRecord[],
  ): Promise<void> {
    for (const old of evicted) {
      await this.audit.record(tx, {
        action: 'identity.session.evicted',
        target: { type: 'Session', id: old.id },
        after: { reason: 'concurrent_limit', userId: old.userId },
      });
      await this.sessionEnded(tx, old, 'concurrent_limit');
    }
    await this.identityTx.runAs(
      userActor(record.tenantId, record.userId, record.id, record.kind),
      async () => {
        await this.audit.record(tx, {
          action:
            record.kind === 'break_glass' ? 'identity.breakGlass.used' : 'identity.login.succeeded',
          target: { type: 'User', id: record.userId },
          after: {
            sessionId: record.id,
            protocol: record.protocol,
            idpId: record.idpId ?? null,
            app: record.app,
            amr: record.amr ?? [],
            ...(record.kind === 'break_glass' ? { severity: 'critical' } : {}),
          },
        });
        await this.outbox.record(tx, {
          type: 'verbis.identity.session.started.v1',
          aggregateType: 'Session',
          aggregateId: record.id,
          payload: {
            userId: record.userId,
            kind: record.kind,
            protocol: record.protocol,
            idpId: record.idpId ?? null,
            app: record.app,
          },
        });
      },
    );
  }

  /** Outbox event consumers (secure launch, runtime) use to end dependent work (SECURITY §4.5). */
  async sessionEnded(tx: TransactionClient, record: SessionRecord, reason: string): Promise<void> {
    await this.outbox.record(tx, {
      type: 'verbis.identity.session.ended.v1',
      aggregateType: 'Session',
      aggregateId: record.id,
      payload: { userId: record.userId, kind: record.kind, reason },
    });
  }

  private async resolveUser(
    tx: TransactionClient,
    idp: LoadedIdp,
    external: ExternalIdentity,
  ): Promise<string> {
    const tenantId = idp.tenantId;
    const linked = await tx.userIdentity.findFirst({
      where: { tenantId, idpId: idp.id, subject: external.subject, deletedAt: null },
      select: { id: true, userId: true },
    });
    const actor = `service:identity`;
    if (linked !== null) {
      await tx.userIdentity.update({
        where: { id: linked.id },
        data: { lastLoginAt: new Date(), updatedBy: actor },
      });
      await this.refreshProfile(tx, idp, linked.userId, external);
      return linked.userId;
    }

    const email = external.email?.trim().toLowerCase();
    if (email !== undefined && external.emailVerified && idp.config.linkByVerifiedEmail) {
      const existing = await tx.user.findFirst({
        where: { tenantId, email, deletedAt: null },
        select: { id: true },
      });
      if (existing !== null) {
        await this.link(tx, idp, existing.id, external.subject);
        await this.activateInvited(tx, existing.id);
        return existing.id;
      }
    }

    if (!idp.jitProvisioning || email === undefined || !/^[^\s@]+@[^\s@]+$/.test(email)) {
      throw new LoginRejectedError('user_not_provisioned');
    }
    // JIT provisioning: a user with the same email but no verified link is never taken over.
    if ((await tx.user.count({ where: { tenantId, email, deletedAt: null } })) > 0) {
      throw new LoginRejectedError('user_not_provisioned');
    }
    await reserveTenantCapacity(tx, tenantId, 'users');
    const user = await tx.user.create({
      data: {
        tenantId,
        email,
        displayName: (external.displayName ?? email).slice(0, 256),
        status: 'active',
        ...(external.locale !== undefined && LOCALE.test(external.locale)
          ? { locale: external.locale.slice(0, 2) }
          : {}),
        createdBy: actor,
        updatedBy: actor,
      },
      select: { id: true },
    });
    await this.link(tx, idp, user.id, external.subject);
    await this.audit.record(tx, {
      action: 'identity.user.provisioned',
      target: { type: 'User', id: user.id },
      after: { source: 'jit', idpId: idp.id, status: 'active' },
    });
    await this.outbox.record(tx, {
      type: 'verbis.identity.user.provisioned.v1',
      aggregateType: 'User',
      aggregateId: user.id,
      payload: { source: 'jit', idpId: idp.id },
    });
    return user.id;
  }

  private async link(
    tx: TransactionClient,
    idp: LoadedIdp,
    userId: string,
    subject: string,
  ): Promise<void> {
    const actor = 'service:identity';
    await tx.userIdentity.create({
      data: {
        tenantId: idp.tenantId,
        userId,
        idpId: idp.id,
        subject,
        lastLoginAt: new Date(),
        createdBy: actor,
        updatedBy: actor,
      },
    });
    await this.audit.record(tx, {
      action: 'identity.userIdentity.linked',
      target: { type: 'User', id: userId },
      after: { idpId: idp.id, protocol: idp.protocol },
    });
  }

  private async activateInvited(tx: TransactionClient, userId: string): Promise<void> {
    const updated = await tx.user.updateMany({
      where: { id: userId, status: 'invited' },
      data: { status: 'active', updatedBy: 'service:identity', version: { increment: 1 } },
    });
    if (updated.count > 0) {
      await this.audit.record(tx, {
        action: 'identity.user.activated',
        target: { type: 'User', id: userId },
        before: { status: 'invited' },
        after: { status: 'active' },
      });
    }
  }

  /** JIT users follow the IdP's display name; changes are audited (values redacted). */
  private async refreshProfile(
    tx: TransactionClient,
    idp: LoadedIdp,
    userId: string,
    external: ExternalIdentity,
  ): Promise<void> {
    await this.activateInvited(tx, userId);
    if (!idp.jitProvisioning || external.displayName === undefined) return;
    const user = await tx.user.findFirst({ where: { id: userId }, select: { displayName: true } });
    const displayName = external.displayName.slice(0, 256);
    if (user === null || user.displayName === displayName) return;
    await tx.user.update({
      where: { id: userId },
      data: { displayName, updatedBy: 'service:identity', version: { increment: 1 } },
    });
    await this.audit.record(tx, {
      action: 'identity.user.updated',
      target: { type: 'User', id: userId },
      before: { displayName: user.displayName },
      after: { displayName, source: 'sso' },
    });
  }
}
