import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { z } from 'zod';

import { requestContext } from '../../common/context/request-context.js';
import { UuidSchema } from '../../common/dto.js';
import { DomainError } from '../../common/errors/domain-errors.js';
import { ZBody, ZParam } from '../../common/validation/zod.js';
import { type ApiEnv, API_ENV } from '../../env.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { SkipAudit } from '../audit/audit.decorators.js';
import { AuditService } from '../audit/audit.service.js';
import { RequirePermissions } from '../authz/permissions.js';

import { HubClient } from './hub-client.js';

const Channel = z.enum([
  'voice',
  'chat',
  'email',
  'sms',
  'whatsapp',
  'social',
  'video',
  'callback',
]);
export const SimulatedInteractionSchema = z
  .strictObject({
    channel: Channel,
    direction: z.enum(['inbound', 'outbound']).default('inbound'),
    /** Platform user id of the agent (mapped like any platform user). */
    agentPlatformUserId: z.string().min(1).max(256),
    agentEmail: z.email().max(320).optional(),
    queue: z.string().max(128).optional(),
    customerName: z.string().max(256).optional(),
    customerAddress: z.string().max(320).optional(),
    subject: z.string().max(1_000).optional(),
    message: z.string().max(8_000).optional(),
    attributes: z
      .record(
        z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
        z.union([z.string().max(256), z.number(), z.boolean()]),
      )
      .default({}),
    autoConnect: z.boolean().default(false),
  })
  .meta({ id: 'SimulatedInteraction' });
export const SimulatorActionSchema = z
  .strictObject({
    action: z.enum(['connect', 'hold', 'resume', 'transfer', 'customerMessage', 'wrapup', 'end']),
    message: z.string().max(8_000).optional(),
    transferToPlatformUserId: z.string().min(1).max(256).optional(),
  })
  .meta({ id: 'SimulatorAction' });
const SimulatorStateSchema = z
  .object({
    connectorId: z.string(),
    interactions: z.array(z.record(z.string(), z.unknown())),
    commands: z.array(z.record(z.string(), z.unknown())),
  })
  .meta({ id: 'SimulatorState' });

/**
 * admin-web "Interaction Simulator" (dev/demo). The browser talks only to the API (BFF); the API
 * forwards to the simulator connector in the hub. Disabled in production and unless
 * SIMULATOR_ENABLED; every generated interaction is audited.
 */
@ApiTag('simulator')
@Controller('v1/simulator/connectors/:id')
export class SimulatorController {
  constructor(
    @Inject(HubClient) private readonly hub: HubClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TenantDb) private readonly db: TenantDb,
  ) {}

  @Get()
  @RequirePermissions('manage:Connector')
  @ApiOperation({ summary: 'Simulator state: interactions and received commands' })
  @ApiResponse(200, 'State', SimulatorStateSchema)
  state(@ZParam('id', UuidSchema) id: string) {
    return this.forward(id, 'GET', '');
  }

  @Post('interactions')
  @RequirePermissions('manage:Connector')
  @SkipAudit()
  @ApiOperation({ summary: 'Simulate a new call/chat/email… offered to an agent' })
  @ApiResponse(201, 'Simulated interaction', z.record(z.string(), z.unknown()))
  async create(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(SimulatedInteractionSchema) input: z.infer<typeof SimulatedInteractionSchema>,
  ) {
    const result = await this.forward(id, 'POST', '/interactions', input);
    await this.record(id, 'connector.simulator.interactionCreated', { channel: input.channel });
    return result;
  }

  @Post('interactions/:platformInteractionId/actions')
  @HttpCode(200)
  @RequirePermissions('manage:Connector')
  @SkipAudit()
  @ApiOperation({ summary: 'Drive a simulated interaction (connect, hold, transfer, end…)' })
  @ApiResponse(200, 'Updated simulated interaction', z.record(z.string(), z.unknown()))
  async act(
    @ZParam('id', UuidSchema) id: string,
    @ZParam('platformInteractionId', z.string().regex(/^sim-[A-Za-z0-9-]{1,64}$/))
    platformInteractionId: string,
    @ZBody(SimulatorActionSchema) input: z.infer<typeof SimulatorActionSchema>,
  ) {
    const result = await this.forward(
      id,
      'POST',
      `/interactions/${platformInteractionId}/actions`,
      input,
    );
    await this.record(id, 'connector.simulator.actionApplied', { action: input.action });
    return result;
  }

  private async forward(id: string, method: 'GET' | 'POST', path: string, body?: unknown) {
    if (!this.env.SIMULATOR_ENABLED || this.env.NODE_ENV === 'production')
      throw new DomainError('VERBIS_RESOURCE_NOT_FOUND', 'The simulator is not enabled');
    const connector = await this.db.current().connector.findFirst({
      where: { id, tenantId: this.db.tenantId(), deletedAt: null, adapterType: 'generic' },
      select: { config: true },
    });
    if ((connector?.config as { kind?: unknown } | null | undefined)?.kind !== 'simulator')
      throw new DomainError('VERBIS_RESOURCE_NOT_FOUND', 'Simulator connector not found');
    return this.hub.call(
      this.db.tenantId(),
      method,
      `/internal/v1/simulator/${id}${path}`,
      z.record(z.string(), z.unknown()),
      body,
    );
  }

  private async record(id: string, action: string, metadata: Record<string, unknown>) {
    await this.audit.record(this.db.current(), {
      action,
      target: { type: 'Connector', id },
      metadata: {
        ...metadata,
        actor: requestContext.require().principal?.id ?? null,
        simulated: true,
      },
    });
  }
}
