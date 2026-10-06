import { createHash } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';

import { instruments } from '@verbis/observability';

import { requestContext } from '../../common/context/request-context.js';
import { uuidv7 } from '../../common/crypto/uuid.js';
import {
  AuditedDomainError,
  DomainError,
  NotFoundError,
  type DeferredAuditEvent,
} from '../../common/errors/domain-errors.js';
import { actorRef, type Principal } from '../../common/security/principal.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import { RedisService } from '../../infra/redis/redis.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthzService } from '../authz/authz.service.js';
import { ResolverService } from '../routing/resolver.service.js';
import { ResolveRequestSchema } from '../routing/routing.dto.js';
import { RuntimeEngineService } from '../runtime/runtime-engine.service.js';
import { reserveSessionCapacity } from '../tenancy/quota.js';

import { peekIssuer, PublicJwksSchema, verifyLaunchJws } from './domain/launch-jws.js';
import {
  checkInteraction,
  checkRedemption,
  intentExpiry,
  LAUNCH_CODE,
  launchCodeHash,
  LaunchDeniedError,
  newLaunchCode,
  type LaunchDenial,
} from './domain/launch.js';
import { LaunchAttempts } from './launch-attempts.js';
import { LaunchPorts } from './launch-ports.js';
import { LaunchReplayGuard } from './launch-replay.js';

import type { CreateIntentInput, EmbeddedLaunchInput, PreviewInput } from './launch.dto.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

export const LAUNCH_CLOCK = Symbol('LAUNCH_CLOCK');
export const LAUNCH_OFFER_SUBJECT = 'verbis.runtime.launch.offered.v1';
/** The pushed code waits here (≤ TTL) for the agent's socket; never in the outbox or the DB. */
export const offerKey = (intentId: string): string => `launch:offer:${intentId}`;

type Flow = 's2s' | 'embedded' | 'jws';

export interface LaunchResult {
  readonly sessionId: string;
  /** Fixed client route; the id alone is useless to anyone but the bound user. */
  readonly path: string;
}

@Injectable()
export class LaunchService {
  readonly #now: () => Date;

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ResolverService) private readonly resolver: ResolverService,
    @Inject(RuntimeEngineService) private readonly engine: RuntimeEngineService,
    @Inject(LaunchPorts) private readonly ports: LaunchPorts,
    @Inject(LaunchAttempts) private readonly attempts: LaunchAttempts,
    @Inject(LaunchReplayGuard) private readonly replay: LaunchReplayGuard,
    @Optional() @Inject(LAUNCH_CLOCK) now?: () => Date,
  ) {
    this.#now = now ?? (() => new Date());
  }

  // ─── (a) server-to-server: connector-hub → POST /v1/launch-intents ──────────

  async createIntent(input: CreateIntentInput) {
    const principal = this.principal();
    return this.guarded(
      'launch.intent.create',
      { type: 'Interaction', id: input.interactionId },
      async () => {
        // Only a certificate-bound service client (client credentials + mTLS, RFC 8705).
        if (principal.type !== 'service') throw new LaunchDeniedError('not_service');
        if (principal.certificateThumbprint === undefined)
          throw new LaunchDeniedError('mtls_required');
        const tx = this.db.current();
        const tenantId = principal.tenantId;
        const connector = await tx.connector.findFirst({
          where: { id: input.connectorId, tenantId, deletedAt: null, status: 'active' },
          select: { id: true },
        });
        if (connector === null) throw new LaunchDeniedError('connector_unavailable');
        const interaction = await tx.interaction.findFirst({
          where: { id: input.interactionId, tenantId, connectorId: connector.id, deletedAt: null },
          select: { id: true, status: true, endedAt: true, agentId: true },
        });
        await this.activeUser(tx, tenantId, input.userId);
        const denial = checkInteraction(interaction, input.userId);
        if (denial !== undefined) throw new LaunchDeniedError(denial);
        if (input.delivery === 'push') {
          // Cross-replica/restart dedupe; serialize only this interaction/user pair.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${input.interactionId}:${input.userId}`}, 0))`;
          const prior = await tx.launchIntent.findFirst({
            where: {
              tenantId,
              interactionId: input.interactionId,
              userId: input.userId,
              flow: 's2s',
              OR: [{ state: 'redeemed' }, { state: 'pending', expiresAt: { gt: this.#now() } }],
            },
            select: { id: true, expiresAt: true },
          });
          if (prior)
            return {
              intentId: prior.id,
              expiresAt: prior.expiresAt.toISOString(),
              delivery: 'push' as const,
            };
        }
        const { intentId, code, expiresAt } = await this.insertIntent(tx, {
          tenantId,
          userId: input.userId,
          interactionId: input.interactionId,
          connectorId: connector.id,
          flow: 's2s',
          ttlSeconds: input.ttlSeconds,
        });
        if (input.delivery === 'push') {
          // Mode A: the agent's authenticated socket receives the code; the connector never does.
          await this.redis.client.set(offerKey(intentId), code, 'EX', input.ttlSeconds ?? 60);
          await this.outbox.record(tx, {
            type: LAUNCH_OFFER_SUBJECT,
            aggregateType: 'LaunchIntent',
            aggregateId: intentId,
            payload: {
              intentId,
              userId: input.userId,
              interactionId: input.interactionId,
              expiresAt: expiresAt.toISOString(),
            },
          });
          return { intentId, expiresAt: expiresAt.toISOString(), delivery: 'push' as const };
        }
        // Mode B: the platform opens the fixed /launch path with the code in the URL fragment.
        return {
          intentId,
          expiresAt: expiresAt.toISOString(),
          delivery: 'fragment' as const,
          code,
        };
      },
    );
  }

  // ─── redeem: agent-web → POST /v1/launch/redeem ─────────────────────────────

  async redeem(code: string): Promise<LaunchResult> {
    const principal = this.principal();
    return this.guarded(
      'launch.code.redeem',
      { type: 'LaunchIntent', id: 'unknown' },
      async (target) => {
        if (!LAUNCH_CODE.test(code)) throw new LaunchDeniedError('code_malformed');
        return this.redeemCode(code, principal, target);
      },
    );
  }

  // ─── (b) embedded: the platform context is only a hint ──────────────────────

  async embedded(input: EmbeddedLaunchInput): Promise<LaunchResult> {
    const principal = this.principal();
    return this.guarded(
      'launch.embedded.redeem',
      { type: 'Connector', id: input.connectorId },
      async (target) => {
        this.assertAgentSession(principal);
        const tx = this.db.current();
        const tenantId = principal.tenantId;
        const user = await this.activeUser(tx, tenantId, principal.id);
        const interaction = await tx.interaction.findFirst({
          where: {
            tenantId,
            connectorId: input.connectorId,
            externalId: input.conversationId,
            deletedAt: null,
          },
          select: {
            id: true,
            status: true,
            endedAt: true,
            agentId: true,
            externalId: true,
            platform: true,
            attributes: true,
          },
        });
        const denial = checkInteraction(interaction, principal.id);
        if (denial !== undefined || interaction === null)
          throw new LaunchDeniedError(denial ?? 'interaction_inactive');
        target.interactionId = interaction.id;
        // Ask the platform itself, with the connector's credentials, using the user's stored CTI ids.
        await this.ports.verify({
          tenantId,
          connectorId: input.connectorId,
          externalId: interaction.externalId,
          ctiIdentities: user.ctiIdentities,
          platform: interaction.platform,
          platformUserId: this.engine.mappedPlatformIdentity(interaction, tenantId),
        });
        const { code } = await this.insertIntent(tx, {
          tenantId,
          userId: principal.id,
          interactionId: interaction.id,
          connectorId: input.connectorId,
          flow: 'embedded',
        });
        return this.redeemCode(code, principal, target, { platformVerified: true });
      },
    );
  }

  // ─── (c) CTI-less: tenant-signed JWS ────────────────────────────────────────

  async jws(token: string): Promise<LaunchResult> {
    const principal = this.principal();
    return this.guarded(
      'launch.jws.redeem',
      { type: 'LaunchTrustedIssuer', id: 'unknown' },
      async (target) => {
        this.assertAgentSession(principal);
        const tx = this.db.current();
        const tenantId = principal.tenantId;
        const issuerName = peekIssuer(token);
        const issuer = await tx.launchTrustedIssuer.findFirst({
          where: { tenantId, issuer: issuerName, status: 'active', deletedAt: null },
          select: { id: true, issuer: true, jwks: true },
        });
        if (issuer === null) throw new LaunchDeniedError('issuer_unknown');
        target.id = issuer.id;
        const jwks = PublicJwksSchema.safeParse(issuer.jwks);
        if (!jwks.success) throw new LaunchDeniedError('issuer_unknown');
        const claims = await verifyLaunchJws(token, {
          jwks: jwks.data,
          issuer: issuer.issuer,
          tenantId,
          now: this.#now(),
        });
        target.interactionId = claims.interactionId;
        if (claims.agentId !== principal.id) throw new LaunchDeniedError('user_mismatch');
        await this.replay.consume(tenantId, issuer.issuer, claims.jti);
        await this.activeUser(tx, tenantId, principal.id);
        const interaction = await tx.interaction.findFirst({
          where: { id: claims.interactionId, tenantId, deletedAt: null },
          select: { id: true, status: true, endedAt: true, agentId: true },
        });
        const denial = checkInteraction(interaction, principal.id);
        if (denial !== undefined) throw new LaunchDeniedError(denial);
        const { code } = await this.insertIntent(tx, {
          tenantId,
          userId: principal.id,
          interactionId: claims.interactionId,
          connectorId: null,
          flow: 'jws',
          jti: claims.jti,
          expiresAt: new Date(Math.min(claims.exp * 1000, intentExpiry(this.#now()).getTime())),
        });
        // The tenant-registered trusted launcher replaces the platform check (SECURITY §4.4 item 7).
        return this.redeemCode(code, principal, target, { platformVerified: true });
      },
    );
  }

  // ─── designer preview: separate kind, separate permission, mock interaction ──

  async preview(input: PreviewInput): Promise<LaunchResult> {
    const principal = this.principal();
    if (principal.type !== 'user')
      throw new DomainError('VERBIS_AUTHZ_FORBIDDEN', 'Preview needs a user');
    const tx = this.db.current();
    const tenantId = principal.tenantId;
    const version = await tx.scriptVersion.findFirst({
      where: { id: input.scriptVersionId, tenantId },
      select: { id: true, checksum: true, scriptId: true },
    });
    if (version === null) throw new NotFoundError('ScriptVersion');
    const liveDataSources = input.liveDataSources && this.authz.can('execute', 'Integration');
    if (input.liveDataSources && !liveDataSources)
      throw new DomainError(
        'VERBIS_AUTHZ_FORBIDDEN',
        'Live data sources need integration execute permission',
      );
    const sessionId = uuidv7(this.#now().getTime());
    await reserveSessionCapacity(this.db, principal.tenantId, sessionId);
    await tx.session.create({
      data: {
        id: sessionId,
        tenantId,
        kind: 'preview',
        interactionId: null,
        userId: principal.id,
        scriptVersionId: version.id,
        checksum: version.checksum,
        decisionTrace: { preview: true, liveDataSources, mockInteraction: input.mockInteraction },
        createdBy: actorRef(principal),
        updatedBy: actorRef(principal),
      },
    });
    await this.engine.initialize(sessionId);
    await this.audit.record(tx, {
      action: 'launch.preview.started',
      target: { type: 'Session', id: sessionId },
      metadata: { scriptVersionId: version.id, liveDataSources, preview: true },
    });
    return { sessionId, path: `/s/${sessionId}` };
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private async redeemCode(
    code: string,
    principal: Principal,
    target: { type: string; id: string; interactionId?: string },
    options: { platformVerified?: boolean } = {},
  ): Promise<LaunchResult> {
    const tx = this.db.current();
    const now = this.#now();
    // RLS confines the lookup to the caller's tenant; another tenant's code is simply unknown.
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM launch_intents WHERE code_hash = ${launchCodeHash(code)} FOR UPDATE`;
    if (locked === undefined) throw new LaunchDeniedError('code_unknown');
    const intent = await tx.launchIntent.findUniqueOrThrow({ where: { id: locked.id } });
    target.type = 'LaunchIntent';
    target.id = intent.id;
    target.interactionId = intent.interactionId;
    const denial = checkRedemption(
      intent,
      {
        tenantId: principal.tenantId,
        userId: principal.id,
        bffSessionId: principal.type === 'user' ? principal.sessionId : undefined,
        authMethod: principal.authMethod,
      },
      now,
    );
    if (denial !== undefined) throw new LaunchDeniedError(denial);
    const user = await this.activeUser(tx, principal.tenantId, principal.id);
    const interaction = await tx.interaction.findFirst({
      where: { id: intent.interactionId, tenantId: principal.tenantId, deletedAt: null },
    });
    const live = checkInteraction(interaction, principal.id);
    if (live !== undefined || interaction === null)
      throw new LaunchDeniedError(live ?? 'interaction_inactive');
    // Re-verify on the platform at redemption time (an s2s intent may be up to 60 s old).
    if (!options.platformVerified && intent.connectorId !== null)
      await this.ports.verify({
        tenantId: principal.tenantId,
        connectorId: intent.connectorId,
        externalId: interaction.externalId,
        ctiIdentities: user.ctiIdentities,
        platform: interaction.platform,
        platformUserId: this.engine.mappedPlatformIdentity(interaction, principal.tenantId),
      });

    // Script is resolved server-side from verified interaction attributes (never by the client).
    if (interaction.campaignId === null)
      throw new DomainError('VERBIS_LAUNCH_NO_ASSIGNMENT', 'The interaction has no campaign');
    const context = this.engine.routingInput(interaction, principal.tenantId);
    const request = ResolveRequestSchema.safeParse({
      campaignId: interaction.campaignId,
      channel: interaction.channelType,
      ...(interaction.queue === null ? {} : { queue: interaction.queue }),
      ...context.routing,
      attributes: flatAttributes(context.attributes),
      agent: { id: principal.id },
      interactionId: interaction.id,
      stickyKey:
        context.routing.stickyKey ??
        (context.customerId
          ? createHash('sha256').update(`${principal.tenantId}:${context.customerId}`).digest('hex')
          : interaction.id),
    });
    if (!request.success)
      throw new DomainError(
        'VERBIS_LAUNCH_NO_ASSIGNMENT',
        'Interaction attributes are not routable',
      );
    const decision = await this.resolver.resolve(request.data);
    if (decision.outcome !== 'resolved' || decision.version === undefined)
      throw new DomainError(
        'VERBIS_LAUNCH_NO_ASSIGNMENT',
        'No script is assigned to this interaction',
      );

    const team = await tx.groupMember.findFirst({
      where: { tenantId: principal.tenantId, userId: principal.id, deletedAt: null },
      orderBy: { groupId: 'asc' },
      select: { groupId: true },
    });
    const sessionId = uuidv7(now.getTime());
    await reserveSessionCapacity(this.db, principal.tenantId, sessionId);
    await tx.session.create({
      data: {
        id: sessionId,
        tenantId: principal.tenantId,
        kind: 'interaction',
        interactionId: interaction.id,
        userId: principal.id,
        teamId: team?.groupId ?? null,
        scriptVersionId: decision.version.id,
        assignmentId: decision.assignmentId ?? null,
        checksum: decision.version.checksum,
        decisionTrace: {
          ...decision.trace,
          analyticsVariant: decision.variant?.key ?? null,
        } as unknown as Prisma.InputJsonObject,
        createdBy: actorRef(principal),
        updatedBy: actorRef(principal),
      },
    });
    // Single use: the forward-only trigger makes a second redemption impossible even on a race.
    const consumed = await tx.launchIntent.updateMany({
      where: { id: intent.id, state: 'pending' },
      data: {
        state: 'redeemed',
        redeemedAt: now,
        sessionId,
        updatedBy: actorRef(principal),
        version: { increment: 1 },
      },
    });
    if (consumed.count !== 1) throw new LaunchDeniedError('code_replayed');
    await this.engine.initialize(sessionId);
    await this.audit.record(tx, {
      action: 'launch.code.redeemed',
      target: { type: 'LaunchIntent', id: intent.id },
      interactionId: interaction.id,
      metadata: {
        flow: intent.flow,
        sessionId,
        scriptVersionId: decision.version.id,
        assignmentId: decision.assignmentId ?? null,
      },
    });
    await this.outbox.record(tx, {
      type: 'verbis.runtime.session.started.v1',
      aggregateType: 'Session',
      aggregateId: sessionId,
      payload: {
        sessionId,
        interactionId: interaction.id,
        userId: principal.id,
        flow: intent.flow,
      },
    });
    return { sessionId, path: `/s/${sessionId}` };
  }

  private async insertIntent(
    tx: TransactionClient,
    input: {
      tenantId: string;
      userId: string;
      interactionId: string;
      connectorId: string | null;
      flow: Flow;
      jti?: string;
      ttlSeconds?: number | undefined;
      expiresAt?: Date;
    },
  ) {
    const principal = this.principal();
    const now = this.#now();
    const code = newLaunchCode();
    const intentId = uuidv7(now.getTime());
    const expiresAt = input.expiresAt ?? intentExpiry(now, input.ttlSeconds);
    await tx.launchIntent.create({
      data: {
        id: intentId,
        tenantId: input.tenantId,
        userId: input.userId,
        interactionId: input.interactionId,
        connectorId: input.connectorId,
        flow: input.flow,
        codeHash: launchCodeHash(code),
        ...(input.jti === undefined ? {} : { jti: input.jti }),
        expiresAt,
        createdAt: now,
        createdBy: actorRef(principal),
        updatedBy: actorRef(principal),
      },
    });
    await this.audit.record(tx, {
      action: 'launch.intent.created',
      target: { type: 'LaunchIntent', id: intentId },
      interactionId: input.interactionId,
      metadata: {
        flow: input.flow,
        userId: input.userId,
        connectorId: input.connectorId,
        expiresAt: expiresAt.toISOString(),
      },
    });
    return { intentId, code, expiresAt };
  }

  private async activeUser(tx: TransactionClient, tenantId: string, userId: string) {
    const user = await tx.user.findFirst({
      where: { id: userId, tenantId, status: 'active', deletedAt: null },
      select: { id: true, ctiIdentities: true },
    });
    if (user === null) throw new LaunchDeniedError('user_inactive');
    return {
      id: user.id,
      ctiIdentities: Array.isArray(user.ctiIdentities) ? user.ctiIdentities : [],
    };
  }

  private assertAgentSession(principal: Principal): void {
    if (principal.type !== 'user') throw new LaunchDeniedError('user_mismatch');
    if (principal.authMethod === 'break_glass') throw new LaunchDeniedError('break_glass');
    if (principal.sessionId === undefined) throw new LaunchDeniedError('session_missing');
  }

  private principal(): Principal {
    const principal = requestContext.get()?.principal;
    if (principal === undefined) throw new Error('No principal in the current context');
    return principal;
  }

  /**
   * Runs one launch attempt: refuses blocked callers up front, and turns every LaunchDeniedError
   * into one generic RFC 7807 problem plus deferred security audit events (written after the
   * request transaction rolls back) and an anomaly event when failures pile up.
   */
  private async guarded<T>(
    action: string,
    initialTarget: { type: string; id: string },
    fn: (target: { type: string; id: string; interactionId?: string }) => Promise<T>,
  ): Promise<T> {
    const ctx = requestContext.require();
    const principal = this.principal();
    const key = { tenantId: principal.tenantId, userId: principal.id, ip: ctx.ip };
    const target: { type: string; id: string; interactionId?: string } = { ...initialTarget };
    if (await this.attempts.blocked(key)) throw this.denied(action, target, 'rate_limited', true);
    try {
      const result = await fn(target);
      instruments.launch.add(1, { action, outcome: 'success' });
      return result;
    } catch (error) {
      if (!(error instanceof LaunchDeniedError)) throw error;
      const { anomaly, count } = await this.attempts.fail(key);
      throw this.denied(action, target, error.reason, false, anomaly ? count : undefined);
    }
  }

  private denied(
    action: string,
    target: { type: string; id: string; interactionId?: string },
    reason: LaunchDenial,
    limited: boolean,
    anomalyCount?: number,
  ): AuditedDomainError {
    instruments.launch.add(1, { action, outcome: 'denied' });
    if (anomalyCount !== undefined) instruments.anomaly.add(1);
    const base = {
      target: { type: target.type, id: target.id },
      ...(target.interactionId === undefined ? {} : { interactionId: target.interactionId }),
    };
    const events: DeferredAuditEvent[] = [
      {
        ...base,
        action: 'launch.attempt.denied',
        reason,
        metadata: { attempt: action, security: true },
      },
    ];
    if (anomalyCount !== undefined)
      events.push({
        ...base,
        action: 'launch.anomaly.detected',
        reason: 'repeated_launch_failures',
        metadata: { failures: anomalyCount, windowSeconds: 300, security: true, alert: true },
      });
    return limited
      ? new AuditedDomainError(
          'VERBIS_LAUNCH_RATE_LIMITED',
          'Too many failed launch attempts',
          events,
          {
            'retry-after': '300',
          },
        )
      : new AuditedDomainError('VERBIS_LAUNCH_DENIED', 'This launch is not valid', events);
  }
}

/** Routing accepts only flat scalar attributes; anything nested is dropped, never interpreted. */
function flatAttributes(raw: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[A-Za-z0-9_]{1,64}$/.test(key)) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
      out[key] =
        typeof value === 'string' ? value.slice(0, 1000) : (value as number | boolean | null);
  }
  return out;
}
