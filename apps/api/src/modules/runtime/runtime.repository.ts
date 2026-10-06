import { Injectable } from '@nestjs/common';

import { keysetOrderBy, keysetWhere } from '../../common/pagination/pagination.js';

import type { SessionEventListQuery, SessionListQuery } from './runtime.dto.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

const SESSION_SELECT = {
  id: true,
  teamId: true,
  sequence: true,
  interactionId: true,
  userId: true,
  scriptVersionId: true,
  assignmentId: true,
  state: true,
  startedAt: true,
  endedAt: true,
  checksum: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.SessionSelect;
export type SessionRow = Prisma.SessionGetPayload<{ select: typeof SESSION_SELECT }>;

const EVENT_SELECT = {
  id: true,
  seq: true,
  type: true,
  payload: true,
  occurredAt: true,
} satisfies Prisma.SessionEventSelect;
export type SessionEventRow = Prisma.SessionEventGetPayload<{ select: typeof EVENT_SELECT }>;

/** Session creation remains exclusively owned by secure launch redemption. */
@Injectable()
export class RuntimeRepository {
  listSessions(
    tx: TransactionClient,
    tenantId: string,
    query: SessionListQuery,
    liveOnly = false,
  ): Promise<SessionRow[]> {
    const { state, userId } = query.filters;
    const where: Prisma.SessionWhereInput = {
      tenantId,
      deletedAt: null,
      ...(liveOnly ? { state: { in: ['launching', 'active', 'paused', 'wrapup'] } } : {}),
      ...(state === undefined ? {} : { state }),
      ...(userId === undefined ? {} : { userId }),
    };
    const after = keysetWhere(query) as Prisma.SessionWhereInput | undefined;
    return tx.session.findMany({
      where: after === undefined ? where : { AND: [where, after] },
      orderBy: keysetOrderBy(query),
      take: query.limit + 1,
      select: SESSION_SELECT,
    });
  }

  findSession(tx: TransactionClient, tenantId: string, id: string): Promise<SessionRow | null> {
    return tx.session.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: SESSION_SELECT,
    });
  }

  listEvents(
    tx: TransactionClient,
    tenantId: string,
    sessionId: string,
    query: SessionEventListQuery,
  ): Promise<SessionEventRow[]> {
    const where: Prisma.SessionEventWhereInput = { tenantId, sessionId };
    const after = keysetWhere(query) as Prisma.SessionEventWhereInput | undefined;
    return tx.sessionEvent.findMany({
      where: after === undefined ? where : { AND: [where, after] },
      orderBy: keysetOrderBy(query),
      take: query.limit + 1,
      select: EVENT_SELECT,
    });
  }
}
