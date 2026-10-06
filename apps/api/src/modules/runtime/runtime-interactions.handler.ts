import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { RoutingContextSchema } from '@verbis/sdk-connector';

import { requestContext } from '../../common/context/request-context.js';
import { ForbiddenError } from '../../common/errors/domain-errors.js';
import { actorRef } from '../../common/security/principal.js';
import { DomainEventHandler } from '../../infra/events/event-consumers.service.js';
import { AuditService } from '../audit/audit.service.js';

import {
  InteractionSchema,
  TERMINAL,
  type Interaction,
  type RuntimeState,
} from './domain/runtime.js';
import { RuntimeCipher } from './runtime-cipher.js';
import { RuntimeEngineService } from './runtime-engine.service.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';
import type { EventHandler } from '../../infra/events/event-consumer.js';
import type { EventEnvelope } from '../../infra/outbox/outbox.types.js';

@Injectable()
@DomainEventHandler()
export class RuntimeInteractionsHandler implements EventHandler {
  readonly name = 'runtime-interactions';
  readonly stream = 'INTERACTION';
  readonly filterSubjects = ['verbis.interaction.contact.changed.v1'];
  constructor(
    @Inject(RuntimeEngineService) private readonly engine: RuntimeEngineService,
    @Inject(RuntimeCipher) private readonly keys: RuntimeCipher,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}
  /** Authenticated connector-hub publishes normalized events; never exposed as a browser command. */
  async handle(event: EventEnvelope, tx: TransactionClient): Promise<void> {
    requestContext.require().tx = tx;
    // PII is encrypted before entering the transactional outbox/NATS/DLQ.
    const delivery = z
      .strictObject({
        interactionId: z.uuid(),
        connectorId: z.uuid(),
        sealed: z.string().max(250_000),
      })
      .parse(event.payload);
    const input: Interaction = InteractionSchema.parse(
      JSON.parse(
        this.keys.openString(
          delivery.sealed,
          `runtime:interaction:${event.tenantId}:${delivery.interactionId}`,
        ),
      ),
    );
    if (input.id !== delivery.interactionId || input.connectorId !== delivery.connectorId)
      throw new ForbiddenError();
    const connector = await tx.connector.findFirst({
      where: { id: input.connectorId, tenantId: event.tenantId, deletedAt: null },
    });
    if (connector?.adapterType !== input.platform || event.aggregate.id !== input.id)
      throw new ForbiddenError();
    if (
      input.agentId !== undefined &&
      (await tx.user.count({
        where: { id: input.agentId, tenantId: event.tenantId, deletedAt: null },
      })) !== 1
    )
      throw new ForbiddenError();
    if (
      input.campaignId !== undefined &&
      (await tx.campaign.count({
        where: { id: input.campaignId, tenantId: event.tenantId, deletedAt: null },
      })) !== 1
    )
      throw new ForbiddenError();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${event.tenantId}:${input.id}`}, 0))`;
    await tx.$queryRaw`SELECT id FROM interactions WHERE id = ${input.id}::uuid AND tenant_id = ${event.tenantId}::uuid FOR UPDATE`;
    const existing = await tx.interaction.findFirst({
      where: { id: input.id, tenantId: event.tenantId },
    });
    // Ignore stale platform delivery using the normalized event occurrence watermark.
    if ((existing?.updatedAt.getTime() ?? -Infinity) >= Date.parse(event.occurredAt)) return;
    const principal = requestContext.require().principal;
    if (principal === undefined) throw new ForbiddenError();
    const actor = actorRef(principal);
    const previousEnvelope = z.object({ sealed: z.string() }).safeParse(existing?.attributes);
    const previous = previousEnvelope.success
      ? z
          .object({
            routing: RoutingContextSchema.optional(),
            customerId: z.string().optional(),
          })
          .parse(
            JSON.parse(
              this.keys.openString(
                previousEnvelope.data.sealed,
                `runtime:interaction:${event.tenantId}:${input.id}`,
              ),
            ),
          )
      : {};
    const data = {
      platform: input.platform,
      externalId: input.platformInteractionId,
      connectorId: input.connectorId,
      channelType: input.channel,
      direction: input.direction,
      status: input.status,
      agentId: input.agentId ?? null,
      queue: input.queue ?? null,
      campaignId: input.campaignId ?? null,
      attributes: {
        sealed: this.keys.seal(
          JSON.stringify({
            platformAgentId: input.platformAgentId,
            routing: input.routing ?? previous.routing,
            ani: input.ani,
            dnis: input.dnis,
            customerId: input.customerId ?? previous.customerId,
            attachedData: input.attachedData,
            participantData: input.participantData,
          }),
          `runtime:interaction:${event.tenantId}:${input.id}`,
        ),
      },
      participants: [],
      updatedAt: new Date(event.occurredAt),
      updatedBy: actor,
      ...(input.status === 'ended' ? { endedAt: new Date(event.occurredAt) } : {}),
    };
    if (existing === null)
      await tx.interaction.create({
        data: {
          ...data,
          id: input.id,
          tenantId: event.tenantId,
          createdBy: actor,
          startedAt: new Date(event.occurredAt),
        },
      });
    else {
      if (
        existing.connectorId !== input.connectorId ||
        existing.externalId !== input.platformInteractionId
      )
        throw new ForbiddenError();
      await tx.interaction.update({
        where: { id: input.id, tenantId: event.tenantId },
        data: { ...data, version: { increment: 1 } },
      });
    }
    // An ended interaction can no longer be launched (SECURITY §4.5 revocation).
    if (input.status === 'ended' || input.status === 'wrapup')
      await tx.launchIntent.updateMany({
        where: { tenantId: event.tenantId, interactionId: input.id, state: 'pending' },
        data: {
          state: 'revoked',
          updatedBy: 'system:runtime-interactions',
          version: { increment: 1 },
        },
      });
    await this.audit.record(tx, {
      action: 'runtime.interaction.normalized',
      target: { type: 'Interaction', id: input.id },
      metadata: { status: input.status, platform: input.platform },
    });
    const sessions = await tx.session.findMany({
      where: { tenantId: event.tenantId, interactionId: input.id, deletedAt: null },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    for (const session of sessions) {
      const row = await this.engine.row(session.id, true);
      if (TERMINAL.has(row.state)) continue;
      const next = platformSessionState(row.state, input.status, row.userId, input.agentId);
      await this.engine.save(
        row,
        await this.engine.snapshot(row),
        next,
        'platform.changed',
        { interactionId: input.id, status: input.status },
        tx,
      );
    }
  }
}

/** Platform lifecycle drives agent editability; a transferred interaction cannot retain its old writer. */
export function platformSessionState(
  state: RuntimeState,
  status: Interaction['status'],
  owner: string,
  agent?: string,
): RuntimeState {
  if (TERMINAL.has(state)) return state;
  if (status === 'transferred' && agent !== owner) return 'abandoned';
  if (status === 'ended' || status === 'wrapup')
    return state === 'launching' ? 'abandoned' : 'wrapup';
  if (status === 'held' && state === 'active') return 'paused';
  if (status === 'connected' && state === 'paused') return 'active';
  return state;
}
