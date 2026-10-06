import { Inject, Injectable } from '@nestjs/common';

import { currentActor } from '../../../common/actor.js';
import { ConflictError, DomainError, NotFoundError } from '../../../common/errors/domain-errors.js';
import { type ApiEnv, API_ENV } from '../../../env.js';
import { TenantDb } from '../../../infra/database/tenant-db.js';
import { OutboxWriter } from '../../../infra/outbox/outbox.writer.js';
import { AuditService } from '../../audit/audit.service.js';
import { identityActor, IdentityTx } from '../core/identity-tx.js';
import {
  IDENTITY_CLOCK,
  IDENTITY_KEYRING,
  SESSION_STORE,
  type Clock,
} from '../core/identity.tokens.js';
import { TenantResolver } from '../core/tenant-resolver.js';
import {
  dummyPasswordHash,
  hashPassword,
  passwordProblems,
  verifyPassword,
} from '../crypto/password.js';
import { generateTotpSecret, totpUri, verifyTotp } from '../crypto/totp.js';
import { LoginService } from '../login/login.service.js';
import { breakGlassSessionPolicy } from '../session/session-policy.js';
import { SessionStore, type CreatedSession } from '../session/session-store.js';

import type { TransactionClient } from '../../../infra/database/prisma.service.js';
import type { Keyring } from '../crypto/keyring.js';

export interface BreakGlassLoginInput {
  readonly tenant: string;
  readonly email: string;
  readonly password: string;
  readonly code: string;
  readonly origin: string | undefined;
  readonly ip: string;
  readonly userAgent: string;
}

export interface BreakGlassAccountDto {
  readonly userId: string;
  readonly status: 'pending_mfa' | 'active' | 'disabled';
  readonly lockedUntil: string | null;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
}

const totpAad = (tenantId: string, userId: string) => `totp:${tenantId}:${userId}`;

/**
 * Break-glass local administrator (for IdP outages): argon2id password + mandatory TOTP, only
 * from the configured admin-web origins, short single session bound to that origin, account
 * lockout, and a critical audit event for every attempt (success or failure).
 */
@Injectable()
export class BreakGlassService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(TenantResolver) private readonly tenants: TenantResolver,
    @Inject(IdentityTx) private readonly identityTx: IdentityTx,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Inject(LoginService) private readonly logins: LoginService,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(IDENTITY_KEYRING) private readonly keyring: Keyring,
    @Inject(IDENTITY_CLOCK) private readonly now: Clock,
  ) {}

  async login(input: BreakGlassLoginInput): Promise<CreatedSession> {
    if (!this.env.BREAK_GLASS_ENABLED) throw new DomainError('VERBIS_AUTH_BREAK_GLASS_DISABLED');
    const tenant = await this.tenants.bySlug(input.tenant);
    if (tenant?.status !== 'active') {
      await dummyPasswordHash().then((hash) => verifyPassword(hash, input.password));
      throw new DomainError('VERBIS_AUTH_INVALID_CREDENTIALS');
    }
    if (
      input.origin === undefined ||
      !this.env.BREAK_GLASS_ALLOWED_ORIGINS.includes(input.origin)
    ) {
      await this.identityTx.record(tenant.id, identityActor(tenant.id), {
        action: 'identity.breakGlass.failed',
        target: { type: 'Tenant', id: tenant.id },
        outcome: 'denied',
        after: { reason: 'origin_not_allowed', severity: 'critical' },
      });
      throw new DomainError('VERBIS_AUTH_ORIGIN_NOT_ALLOWED');
    }
    const origin = input.origin;
    const nowMs = this.now();
    let created: CreatedSession | undefined;
    const result = await this.identityTx
      .run(tenant.id, identityActor(tenant.id), async (tx) => {
        const user = await tx.user.findFirst({
          where: { tenantId: tenant.id, email: input.email.trim().toLowerCase(), deletedAt: null },
          select: { id: true, status: true, localCredential: true },
        });
        const credential = user?.localCredential ?? null;
        // Verify even for unknown accounts so timing does not reveal which emails exist.
        const passwordOk = await verifyPassword(
          credential?.passwordHash ?? (await dummyPasswordHash()),
          input.password,
        );
        if (user === null || credential?.deletedAt !== null) {
          return this.fail(tx, tenant.id, undefined, 'unknown_account');
        }
        if (credential.status !== 'active')
          return this.fail(tx, tenant.id, user.id, 'credential_inactive');
        if (credential.lockedUntil !== null && credential.lockedUntil.getTime() > nowMs) {
          return this.fail(tx, tenant.id, user.id, 'locked');
        }
        const secret = this.keyring.openString(credential.totpSecret, totpAad(tenant.id, user.id));
        const step = verifyTotp(secret, input.code, nowMs, {
          lastUsedStep: credential.totpLastStep,
        });
        if (!passwordOk || step === null) {
          const attempts = credential.failedAttempts + 1;
          const lock = attempts >= this.env.BREAK_GLASS_MAX_ATTEMPTS;
          await tx.localCredential.update({
            where: { id: credential.id },
            data: {
              failedAttempts: lock ? 0 : attempts,
              ...(lock
                ? { lockedUntil: new Date(nowMs + this.env.BREAK_GLASS_LOCKOUT_MINUTES * 60_000) }
                : {}),
              updatedBy: 'service:identity',
            },
          });
          return this.fail(tx, tenant.id, user.id, !passwordOk ? 'bad_password' : 'bad_totp', lock);
        }
        if (user.status !== 'active') return this.fail(tx, tenant.id, user.id, 'user_inactive');

        await tx.localCredential.update({
          where: { id: credential.id },
          data: {
            failedAttempts: 0,
            lockedUntil: null,
            totpLastStep: step,
            lastUsedAt: new Date(nowMs),
            updatedBy: 'service:identity',
          },
        });
        await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(nowMs) } });
        created = await this.sessions.create(
          {
            tenantId: tenant.id,
            userId: user.id,
            kind: 'break_glass',
            protocol: 'local',
            app: 'admin',
            ip: input.ip.slice(0, 64),
            userAgent: input.userAgent.slice(0, 512),
            boundOrigin: origin,
            amr: ['pwd', 'otp', 'mfa'],
          },
          breakGlassSessionPolicy(this.env),
        );
        await this.logins.recordSessionStart(tx, created.record, created.evicted);
        await this.outbox.record(tx, {
          type: 'verbis.identity.breakGlass.used.v1',
          aggregateType: 'User',
          aggregateId: user.id,
          payload: { sessionId: created.record.id, severity: 'critical' },
        });
        return 'ok' as const;
      })
      .catch(async (error: unknown) => {
        if (created !== undefined)
          await this.sessions.revokeHash(SessionStore.hashToken(created.token));
        throw error;
      });
    if (result !== 'ok' || created === undefined)
      throw new DomainError('VERBIS_AUTH_INVALID_CREDENTIALS');
    return created;
  }

  private async fail(
    tx: TransactionClient,
    tenantId: string,
    userId: string | undefined,
    reason: string,
    locked = false,
  ): Promise<'failed'> {
    await this.audit.record(tx, {
      action: 'identity.breakGlass.failed',
      target: { type: 'User', id: userId ?? 'unknown' },
      outcome: 'denied',
      after: { reason, locked, severity: 'critical' },
    });
    await this.outbox.record(tx, {
      type: 'verbis.identity.breakGlass.failed.v1',
      aggregateType: 'Tenant',
      aggregateId: tenantId,
      payload: { reason, locked, severity: 'critical' },
    });
    return 'failed';
  }

  // ─── Administration (request transaction) ────────────────────────────────────

  async enroll(
    userId: string,
    password: string,
  ): Promise<{ userId: string; totpUri: string; totpSecret: string }> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const user = await tx.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      select: { id: true, email: true, status: true, tenant: { select: { slug: true } } },
    });
    if (user === null) throw new NotFoundError('User');
    const problems = passwordProblems(password, [user.email.split('@')[0] ?? '', user.tenant.slug]);
    if (problems.length > 0) {
      throw new DomainError(
        'VERBIS_IDENTITY_PASSWORD_WEAK',
        'The password does not meet the break-glass policy',
        problems.map((code) => ({ path: '/body/password', message: code, code })),
      );
    }
    const secret = generateTotpSecret();
    const data = {
      passwordHash: await hashPassword(password),
      totpSecret: this.keyring.seal(secret, totpAad(tenantId, userId)),
      totpLastStep: null,
      status: 'pending_mfa' as const,
      failedAttempts: 0,
      lockedUntil: null,
      deletedAt: null,
      updatedBy: currentActor(),
    };
    await tx.localCredential.upsert({
      where: { userId },
      create: { tenantId, userId, ...data, createdBy: currentActor() },
      update: { ...data, version: { increment: 1 } },
    });
    await this.audit.record(tx, {
      action: 'identity.breakGlassAccount.enrolled',
      target: { type: 'User', id: userId },
      after: { status: 'pending_mfa', severity: 'critical' },
    });
    return {
      userId,
      totpSecret: secret,
      totpUri: totpUri(secret, `Verbis ${user.tenant.slug}`, user.email),
    };
  }

  /** Confirms the authenticator: the first valid code activates the credential. */
  async activate(userId: string, code: string): Promise<BreakGlassAccountDto> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const credential = await tx.localCredential.findFirst({
      where: { tenantId, userId, deletedAt: null },
    });
    if (credential === null) throw new NotFoundError('Break-glass account');
    if (credential.status !== 'pending_mfa')
      throw new ConflictError('The account is not awaiting MFA confirmation');
    const step = verifyTotp(
      this.keyring.openString(credential.totpSecret, totpAad(tenantId, userId)),
      code,
      this.now(),
    );
    if (step === null) throw new DomainError('VERBIS_IDENTITY_MFA_INVALID');
    const row = await tx.localCredential.update({
      where: { id: credential.id },
      data: {
        status: 'active',
        totpLastStep: step,
        updatedBy: currentActor(),
        version: { increment: 1 },
      },
    });
    await this.audit.record(tx, {
      action: 'identity.breakGlassAccount.activated',
      target: { type: 'User', id: userId },
      before: { status: 'pending_mfa' },
      after: { status: 'active', severity: 'critical' },
    });
    return this.toDto(row);
  }

  async disable(userId: string): Promise<void> {
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const credential = await tx.localCredential.findFirst({
      where: { tenantId, userId, deletedAt: null },
    });
    if (credential === null) throw new NotFoundError('Break-glass account');
    await tx.localCredential.update({
      where: { id: credential.id },
      data: {
        status: 'disabled',
        deletedAt: new Date(),
        updatedBy: currentActor(),
        version: { increment: 1 },
      },
    });
    await this.audit.record(tx, {
      action: 'identity.breakGlassAccount.disabled',
      target: { type: 'User', id: userId },
      before: { status: credential.status },
      after: { status: 'disabled', severity: 'critical' },
    });
    // Live break-glass sessions of this user end with the credential.
    const sessions = await this.sessions.listForUser(tenantId, userId);
    for (const session of sessions.filter((s) => s.record.kind === 'break_glass')) {
      const record = await this.sessions.revokeHash(session.hash);
      if (record !== undefined) await this.logins.sessionEnded(tx, record, 'credential_disabled');
    }
  }

  async list(): Promise<BreakGlassAccountDto[]> {
    const rows = await this.db.current().localCredential.findMany({
      where: { tenantId: this.db.tenantId(), deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.toDto(row));
  }

  private toDto(row: {
    userId: string;
    status: 'pending_mfa' | 'active' | 'disabled';
    lockedUntil: Date | null;
    lastUsedAt: Date | null;
    createdAt: Date;
  }): BreakGlassAccountDto {
    return {
      userId: row.userId,
      status: row.status,
      lockedUntil: row.lockedUntil?.toISOString() ?? null,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
