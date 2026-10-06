import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { ForbiddenError } from '../../common/errors/domain-errors.js';
import { RedisService } from '../../infra/redis/redis.service.js';
import { IDENTITY_KEYRING, SESSION_STORE } from '../identity/core/identity.tokens.js';
import { Keyring } from '../identity/crypto/keyring.js';
import { SessionStore } from '../identity/session/session-store.js';

import type { FastifyRequest } from 'fastify';

const GrantSchema = z.strictObject({
  tenantId: z.uuid(),
  userId: z.uuid(),
  bffId: z.uuid(),
  bffHash: z.string().regex(/^[a-f0-9]{64}$/),
  origin: z.url(),
  expiresAt: z.number().int(),
});
export type LaunchGrant = z.infer<typeof GrantSchema>;

export const TICKET_TTL_SECONDS = 30;
export const userRoom = (tenantId: string, userId: string): string =>
  `launch:${tenantId}:${userId}`;
const ticketKey = (ticket: string) =>
  `launch:ticket:${createHash('sha256').update(ticket).digest('hex')}`;

/**
 * "New interaction" channel (Mode A). Read-only: a socket only ever *receives* offers for the
 * cookie-authenticated user that requested the ticket. Tickets are single-use, origin-bound and
 * expire in 30 s; nothing is accepted from the WebSocket URL.
 */
@Injectable()
export class LaunchRealtime {
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(IDENTITY_KEYRING) private readonly keys: Keyring,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
  ) {}

  async issue(request: FastifyRequest) {
    const bff = request.verbisSession;
    const origin = request.headers.origin;
    if (bff === undefined || typeof origin !== 'string')
      throw new ForbiddenError('An authenticated browser origin is required');
    const ticket = randomBytes(32).toString('base64url');
    const key = ticketKey(ticket);
    const grant: LaunchGrant = {
      tenantId: bff.record.tenantId,
      userId: bff.record.userId,
      bffId: bff.record.id,
      bffHash: bff.hash,
      origin,
      expiresAt: Date.now() + TICKET_TTL_SECONDS * 1000,
    };
    await this.redis.client.set(
      key,
      this.keys.seal(JSON.stringify(grant), key),
      'EX',
      TICKET_TTL_SECONDS,
    );
    return { ticket, expiresIn: TICKET_TTL_SECONDS, namespace: '/launch' as const };
  }

  async consume(ticket: unknown, origin: unknown): Promise<LaunchGrant> {
    if (
      typeof ticket !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(ticket) ||
      typeof origin !== 'string'
    )
      throw new ForbiddenError();
    const key = ticketKey(ticket);
    const sealed = await this.redis.client.getdel(key);
    if (sealed === null) throw new ForbiddenError();
    const grant = GrantSchema.parse(JSON.parse(this.keys.openString(sealed, key)));
    if (grant.expiresAt <= Date.now() || grant.origin !== origin) throw new ForbiddenError();
    await this.validate(grant);
    return grant;
  }

  /** The BFF session must still be alive and unchanged (logout/SCIM deprovision ⇒ disconnect). */
  async validate(grant: LaunchGrant): Promise<void> {
    const session = await this.sessions.loadHash(grant.bffHash);
    if (
      session?.id !== grant.bffId ||
      session.userId !== grant.userId ||
      session.tenantId !== grant.tenantId
    )
      throw new ForbiddenError();
  }
}
