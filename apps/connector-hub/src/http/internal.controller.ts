import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { type FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  AttributesSchema,
  COMMAND_NAMES,
  WrapUpSchema,
  type CommandName,
} from '@verbis/sdk-connector';

import { SimulatorConnector } from '../connectors/simulator/simulator.connector.js';
import { ConnectorSupervisor, type ConnectorInstance } from '../runtime/connector-supervisor.js';
import { EventPipeline } from '../runtime/event-pipeline.js';

import { toHttpError } from './errors.js';
import { InternalAuthGuard } from './internal-auth.guard.js';

const VerifySchema = z.strictObject({
  platformUserIds: z.array(z.string().min(1).max(256)).min(1).max(20),
  platformInteractionId: z.string().min(1).max(256),
});
const CommandSchema = z.strictObject({
  platformInteractionId: z.string().min(1).max(256),
  commandId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/),
  attributes: AttributesSchema.optional(),
  wrapUp: WrapUpSchema.optional(),
});

/** API → hub: participant verification, runtime commands, status and the simulator control API. */
@Controller('internal/v1')
@UseGuards(InternalAuthGuard)
export class InternalController {
  constructor(
    @Inject(ConnectorSupervisor) private readonly supervisor: ConnectorSupervisor,
    @Inject(EventPipeline) private readonly pipeline: EventPipeline,
  ) {}

  @Get('connectors')
  status(@Req() request: FastifyRequest) {
    return {
      queue: this.pipeline.stats(),
      connectors: this.supervisor
        .list()
        .filter((i) => i.tenantId === request.hubTenantId)
        .map((i) => ({
          connectorId: i.connectorId,
          kind: i.connector?.kind ?? null,
          state: i.state,
          health: i.health ?? null,
          attempts: i.attempts,
        })),
    };
  }

  @Post('connectors/:id/verify-participant')
  @HttpCode(200)
  async verify(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    const input = VerifySchema.safeParse(body);
    if (!input.success) return { verified: false };
    const connector = this.#instance(request, id).connector;
    if (connector === undefined) return { verified: false };
    for (const userId of input.data.platformUserIds)
      if (
        await connector
          .verifyParticipant(userId, input.data.platformInteractionId)
          .catch(() => false)
      )
        return { verified: true };
    return { verified: false };
  }

  @Post('connectors/:id/commands/:name')
  @HttpCode(204)
  async command(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
    @Param('name') name: string,
    @Body() body: unknown,
  ) {
    if (!(COMMAND_NAMES as readonly string[]).includes(name)) throw new NotFoundException();
    const input = CommandSchema.safeParse(body);
    if (!input.success) throw new BadRequestException('Invalid command');
    const connector = this.#instance(request, id).connector;
    if (connector === undefined) throw new NotFoundException();
    const target = {
      platformInteractionId: input.data.platformInteractionId,
      commandId: input.data.commandId,
    };
    try {
      switch (name as CommandName) {
        case 'writeAttributes':
          await connector.writeAttributes(target, input.data.attributes ?? {});
          break;
        case 'setWrapUp':
          if (input.data.wrapUp === undefined) throw new BadRequestException('wrapUp is required');
          await connector.setWrapUp(target, input.data.wrapUp);
          break;
        case 'pauseRecording':
          await connector.pauseRecording(target);
          break;
        case 'resumeRecording':
          await connector.resumeRecording(target);
          break;
      }
    } catch (error) {
      throw toHttpError(error);
    }
  }

  @Get('simulator/:id')
  simulatorState(@Req() request: FastifyRequest, @Param('id') id: string) {
    return { connectorId: id, ...this.#simulator(request, id).snapshot() };
  }

  @Post('simulator/:id/interactions')
  async simulate(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    try {
      return await this.#simulator(request, id).create(body);
    } catch (error) {
      throw toHttpError(error);
    }
  }

  @Post('simulator/:id/interactions/:pid/actions')
  @HttpCode(200)
  async simulateAction(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
    @Param('pid') pid: string,
    @Body() body: unknown,
  ) {
    try {
      return await this.#simulator(request, id).act(pid, body);
    } catch (error) {
      throw toHttpError(error);
    }
  }

  #instance(request: FastifyRequest, id: string): ConnectorInstance {
    const instance =
      request.hubTenantId === undefined ? undefined : this.supervisor.get(request.hubTenantId, id);
    if (instance === undefined) throw new NotFoundException();
    return instance;
  }

  #simulator(request: FastifyRequest, id: string): SimulatorConnector {
    const connector = this.#instance(request, id).connector;
    if (!(connector instanceof SimulatorConnector)) throw new NotFoundException();
    return connector;
  }
}
