import { Controller, Get, Inject, Post, Req } from '@nestjs/common';

import { UuidSchema } from '../../common/dto.js';
import { NoResponseReplay } from '../../common/idempotency/idempotency.interceptor.js';
import { ZBody, ZParam, ZQuery } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { RequirePermissions } from '../authz/permissions.js';

import {
  CommandSchema,
  LeaseSchema,
  LeaseViewSchema,
  OutcomeInputSchema,
  RecordingSchema,
  RuntimeViewSchema,
  SecureFieldSchema,
  TicketInputSchema,
  TicketViewSchema,
  TransferSchema,
} from './domain/runtime.js';
import { RuntimeEngineService } from './runtime-engine.service.js';
import { RuntimeRealtimeService } from './runtime-realtime.service.js';
import { SessionListQuerySchema, SessionPageSchema, type SessionListQuery } from './runtime.dto.js';
import { RuntimeService } from './runtime.service.js';

import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';

@ApiTag('runtime')
@Controller('v1/sessions')
export class RuntimeCommandsController {
  constructor(
    @Inject(RuntimeEngineService) private readonly engine: RuntimeEngineService,
    @Inject(RuntimeRealtimeService) private readonly realtime: RuntimeRealtimeService,
  ) {}
  @Get(':id/state')
  @RequirePermissions('read:Session')
  @ApiOperation({ summary: 'Recover runtime state; PCI values are never returned' })
  @ApiResponse(200, 'Runtime state', RuntimeViewSchema)
  state(@ZParam('id', UuidSchema) id: string) {
    return this.engine.view(id);
  }
  @Post(':id/attach')
  @RequirePermissions('update:Session')
  @NoResponseReplay()
  @ApiOperation({
    summary: 'Acquire or renew the first-tab writer lease; another tab receives read-only state',
  })
  @ApiResponse(201, 'Writer lease', LeaseViewSchema)
  attach(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(LeaseSchema) input: z.infer<typeof LeaseSchema>,
  ) {
    return this.engine.attach(id, input);
  }
  @Post(':id/takeover')
  @RequirePermissions('update:Session')
  @NoResponseReplay()
  @ApiOperation({
    summary: 'Owner takes over the writer lease; previous capability is revoked and audited',
  })
  @ApiResponse(201, 'Writer lease', LeaseViewSchema)
  takeover(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(LeaseSchema.pick({ tabId: true })) input: { tabId: string },
  ) {
    return this.engine.attach(id, input, true);
  }
  @Post(':id/release')
  @RequirePermissions('update:Session')
  @NoResponseReplay()
  @ApiOperation({ summary: 'Release the current BFF-bound writer lease' })
  @ApiResponse(201, 'Read-only state', RuntimeViewSchema)
  release(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(LeaseSchema.required()) input: z.infer<typeof LeaseSchema>,
  ) {
    return this.engine.release(id, input);
  }
  @Post(':id/commands')
  @RequirePermissions('update:Session')
  @NoResponseReplay()
  @ApiOperation({ summary: 'Apply a sequenced runtime command' })
  @ApiResponse(201, 'Updated state', RuntimeViewSchema)
  command(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(CommandSchema) input: z.infer<typeof CommandSchema>,
  ) {
    return this.engine.command(id, input);
  }
  @Post(':id/outcome')
  @RequirePermissions('update:Session')
  @NoResponseReplay()
  @ApiOperation({ summary: 'Validate campaign disposition and enqueue connector writeback' })
  @ApiResponse(201, 'Completed state', RuntimeViewSchema)
  outcome(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(OutcomeInputSchema) input: z.infer<typeof OutcomeInputSchema>,
  ) {
    return this.engine.outcome(id, input);
  }
  @Post(':id/secure-field')
  @RequirePermissions('update:Session')
  @NoResponseReplay()
  @ApiOperation({ summary: 'Accept a provider-verified token receipt for a PCI field' })
  @ApiResponse(201, 'Updated state', RuntimeViewSchema)
  secure(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(SecureFieldSchema) input: z.infer<typeof SecureFieldSchema>,
  ) {
    return this.engine.secureField(id, input);
  }
  @Post(':id/recording')
  @RequirePermissions('update:Session')
  @NoResponseReplay()
  @ApiOperation({ summary: 'Queue connector recording pause or resume' })
  @ApiResponse(201, 'Updated state', RuntimeViewSchema)
  recording(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(RecordingSchema) input: z.infer<typeof RecordingSchema>,
  ) {
    return this.engine.recording(id, input);
  }
  @Post(':id/transfer')
  @RequirePermissions('update:Session')
  @NoResponseReplay()
  @ApiOperation({
    summary: 'Transfer allow-listed context to a securely launched recipient session',
  })
  @ApiResponse(201, 'Source state', RuntimeViewSchema)
  transfer(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(TransferSchema) input: z.infer<typeof TransferSchema>,
  ) {
    return this.engine.transfer(id, input);
  }
  @Post(':id/socket-ticket')
  @RequirePermissions('read:Session')
  @NoResponseReplay()
  @ApiOperation({ summary: 'Issue an origin-bound, single-use WebSocket ticket' })
  @ApiResponse(201, '30-second ticket', TicketViewSchema)
  ticket(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(TicketInputSchema) input: z.infer<typeof TicketInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.realtime.issue(id, input.afterSequence, request);
  }
}
@ApiTag('runtime')
@Controller('v1/supervisor/sessions')
export class RuntimeSupervisorController {
  constructor(
    @Inject(RuntimeService) private readonly runtime: RuntimeService,
    @Inject(RuntimeEngineService) private readonly engine: RuntimeEngineService,
    @Inject(RuntimeRealtimeService) private readonly realtime: RuntimeRealtimeService,
  ) {}
  @Get()
  @RequirePermissions('read:Session')
  @ApiOperation({ summary: 'List live sessions within the caller team scope' })
  @ApiResponse(200, 'Live sessions', SessionPageSchema)
  list(@ZQuery(SessionListQuerySchema) query: SessionListQuery) {
    return this.runtime.listSessions(query, true);
  }
  @Get(':id/state')
  @RequirePermissions('read:Session')
  @ApiOperation({ summary: 'Observe a scoped session in read-only mode with PII redacted' })
  @ApiResponse(200, 'Supervisor view', RuntimeViewSchema)
  state(@ZParam('id', UuidSchema) id: string) {
    return this.engine.view(id, true);
  }
  @Post(':id/socket-ticket')
  @RequirePermissions('read:Session')
  @NoResponseReplay()
  @ApiOperation({ summary: 'Issue a scoped read-only supervisor watch ticket' })
  @ApiResponse(201, '30-second ticket', TicketViewSchema)
  ticket(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(TicketInputSchema) input: z.infer<typeof TicketInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.realtime.issue(id, input.afterSequence, request, true);
  }
}
