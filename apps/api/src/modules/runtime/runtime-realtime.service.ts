import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { requestContext, systemContext } from '../../common/context/request-context.js';
import { ForbiddenError } from '../../common/errors/domain-errors.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { RedisService } from '../../infra/redis/redis.service.js';
import { AbilityFactory } from '../authz/ability.factory.js';
import { IDENTITY_KEYRING, SESSION_STORE } from '../identity/core/identity.tokens.js';
import { Keyring } from '../identity/crypto/keyring.js';
import { SessionStore } from '../identity/session/session-store.js';

import { RuntimeEngineService, tokenHash } from './runtime-engine.service.js';

import type { FastifyRequest } from 'fastify';

const GrantSchema = z.strictObject({
  tenantId: z.uuid(),
  userId: z.uuid(),
  bffId: z.uuid(),
  bffHash: z.string().regex(/^[a-f0-9]{64}$/),
  sessionId: z.uuid(),
  origin: z.url(),
  afterSequence: z.number().int().nonnegative(),
  expiresAt: z.number().int(),
  supervisor: z.boolean(),
});
export type RuntimeGrant = z.infer<typeof GrantSchema>;
export const room = (tenantId: string, id: string): string => `runtime:${tenantId}:${id}`;
/** Gap/duplicates are explicit: consumers replace snapshot then apply only higher sequence events. */
export function reconnectPlan(current: number, after: number, eventSequences: readonly number[]) {
  const complete =
    after <= current &&
    current - after <= 200 &&
    eventSequences.length === current - after &&
    eventSequences.every((sequence, index) => sequence === after + index + 1);
  return { reset: !complete, sequence: current };
}
@Injectable()
export class RuntimeRealtimeService {
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(IDENTITY_KEYRING) private readonly keys: Keyring,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AbilityFactory) private readonly abilities: AbilityFactory,
    @Inject(RuntimeEngineService) private readonly engine: RuntimeEngineService,
  ) {}
  async issue(id: string, afterSequence: number, request: FastifyRequest, supervisor = false) {
    const bff = request.verbisSession,
      origin = request.headers.origin;
    if (bff === undefined || typeof origin !== 'string')
      throw new ForbiddenError('An authenticated browser origin is required');
    const row = await this.engine.row(id);
    this.engine.authorize(row);
    const ticket = randomBytes(32).toString('base64url'),
      key = `runtime:ticket:${tokenHash(ticket)}`;
    const grant: RuntimeGrant = {
      tenantId: row.tenantId,
      userId: bff.record.userId,
      bffId: bff.record.id,
      bffHash: bff.hash,
      sessionId: id,
      origin,
      afterSequence,
      expiresAt: Date.now() + 30_000,
      supervisor,
    };
    await this.redis.client.set(key, this.keys.seal(JSON.stringify(grant), key), 'EX', 30);
    return { ticket, expiresIn: 30, namespace: '/runtime' as const };
  }
  async consume(ticket: unknown, origin: unknown): Promise<RuntimeGrant> {
    if (
      typeof ticket !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(ticket) ||
      typeof origin !== 'string'
    )
      throw new ForbiddenError();
    const key = `runtime:ticket:${tokenHash(ticket)}`,
      sealed = await this.redis.client.getdel(key);
    if (sealed === null) throw new ForbiddenError();
    const grant = GrantSchema.parse(JSON.parse(this.keys.openString(sealed, key)));
    if (grant.expiresAt <= Date.now() || grant.origin !== origin) throw new ForbiddenError();
    await this.validate(grant);
    return grant;
  }
  async validate(grant: RuntimeGrant): Promise<void> {
    const session = await this.sessions.loadHash(grant.bffHash);
    if (
      session?.id !== grant.bffId ||
      session.userId !== grant.userId ||
      session.tenantId !== grant.tenantId ||
      (session.boundOrigin !== undefined && session.boundOrigin !== grant.origin)
    )
      throw new ForbiddenError();
    await this.inContext(grant, async () => {
      const row = await this.engine.row(grant.sessionId);
      this.engine.authorize(row);
    });
  }
  async inContext<T>(grant: RuntimeGrant, fn: () => Promise<T>): Promise<T> {
    const principal = {
      type: 'user' as const,
      id: grant.userId,
      tenantId: grant.tenantId,
      sessionId: grant.bffId,
      scopes: [],
    };
    return requestContext.run(
      { ...systemContext(randomBytes(16).toString('hex'), 'runtime-websocket'), principal },
      () =>
        this.db.run(grant.tenantId, async (tx) => {
          requestContext.require().tx = tx;
          const tenant = await tx.tenant.findUniqueOrThrow({
            where: { id: grant.tenantId },
            select: { settings: true, status: true },
          });
          if (tenant.status !== 'active') throw new ForbiddenError();
          const ability = await this.abilities.forPrincipal(tx, principal, tenant.settings);
          if (ability === undefined) throw new ForbiddenError();
          requestContext.require().authz = ability;
          return fn();
        }),
    );
  }
  async resume(grant: RuntimeGrant) {
    return this.inContext(grant, async () => {
      const view = await this.engine.view(grant.sessionId, grant.supervisor);
      const events = await this.db.current().sessionEvent.findMany({
        where: {
          tenantId: grant.tenantId,
          sessionId: grant.sessionId,
          seq: { gt: grant.afterSequence, lte: view.sequence },
        },
        orderBy: { seq: 'asc' },
        take: 201,
        select: { seq: true, type: true, payload: true, occurredAt: true },
      });
      const plan = reconnectPlan(
        view.sequence,
        grant.afterSequence,
        events.map((event) => event.seq),
      );
      return { ...plan, snapshot: view, events: plan.reset ? [] : events };
    });
  }
}
