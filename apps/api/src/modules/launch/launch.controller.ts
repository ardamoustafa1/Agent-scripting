import { Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';

import { requestContext } from '../../common/context/request-context.js';
import { NoResponseReplay } from '../../common/idempotency/idempotency.interceptor.js';
import { ZBody } from '../../common/validation/zod.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { SkipAudit } from '../audit/audit.decorators.js';
import { AuditService } from '../audit/audit.service.js';
import { RequirePermissions } from '../authz/permissions.js';

import { FORBIDDEN_LAUNCH_PARAMS } from './domain/launch.js';
import { LaunchRealtime } from './launch-realtime.js';
import {
  CreateIntentSchema,
  EmbeddedLaunchSchema,
  JwsLaunchSchema,
  LaunchIntentCreatedSchema,
  LaunchResultSchema,
  LaunchTicketSchema,
  ParamSignalSchema,
  PreviewSchema,
  RedeemSchema,
  type CreateIntentInput,
  type EmbeddedLaunchInput,
  type PreviewInput,
} from './launch.dto.js';
import { LaunchService } from './launch.service.js';

import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';

/**
 * Secure launch (SECURITY §4). Sessions are created only here, never from URL parameters.
 * Every handler writes its own audit events (successes in the transaction, denials after it).
 */
@ApiTag('launch')
@Controller('v1')
export class LaunchController {
  constructor(
    @Inject(LaunchService) private readonly launch: LaunchService,
    @Inject(LaunchRealtime) private readonly realtime: LaunchRealtime,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TenantDb) private readonly db: TenantDb,
  ) {}

  @Post('launch-intents')
  @RequirePermissions('create:Session')
  @SkipAudit()
  @NoResponseReplay()
  @ApiOperation({
    summary:
      'Connector-hub: create a short-lived single-use launch intent (client credentials + mTLS)',
  })
  @ApiResponse(
    201,
    'Intent created; the code is pushed to the agent or returned for a fragment URL',
    LaunchIntentCreatedSchema,
  )
  create(@ZBody(CreateIntentSchema) input: CreateIntentInput) {
    return this.launch.createIntent(input);
  }

  @Post('launch/redeem')
  @HttpCode(201)
  @RequirePermissions('create:Session')
  @SkipAudit()
  @NoResponseReplay()
  @ApiOperation({ summary: 'Agent: exchange a launch code for a session bound to this sign-in' })
  @ApiResponse(201, 'Session created', LaunchResultSchema)
  redeem(@ZBody(RedeemSchema) input: z.infer<typeof RedeemSchema>) {
    return this.launch.redeem(input.code);
  }

  @Post('launch/embedded')
  @HttpCode(201)
  @RequirePermissions('create:Session')
  @SkipAudit()
  @NoResponseReplay()
  @ApiOperation({
    summary: 'Agent (embedded): launch from a platform hint, verified with the platform API',
  })
  @ApiResponse(201, 'Session created', LaunchResultSchema)
  embedded(@ZBody(EmbeddedLaunchSchema) input: EmbeddedLaunchInput) {
    return this.launch.embedded(input);
  }

  @Post('launch/jws')
  @HttpCode(201)
  @RequirePermissions('create:Session')
  @SkipAudit()
  @NoResponseReplay()
  @ApiOperation({
    summary: 'Agent (CTI-less): launch from a tenant-signed JWS (exp ≤ 60 s, single-use jti)',
  })
  @ApiResponse(201, 'Session created', LaunchResultSchema)
  jws(@ZBody(JwsLaunchSchema) input: z.infer<typeof JwsLaunchSchema>) {
    return this.launch.jws(input.token);
  }

  @Post('launch/preview')
  @HttpCode(201)
  @RequirePermissions('update:Script')
  @SkipAudit()
  @NoResponseReplay()
  @ApiOperation({ summary: 'Designer: start a preview session on a mock interaction' })
  @ApiResponse(201, 'Preview session created', LaunchResultSchema)
  preview(@ZBody(PreviewSchema) input: PreviewInput) {
    return this.launch.preview(input);
  }

  @Post('launch/socket-ticket')
  @HttpCode(201)
  @RequirePermissions('create:Session')
  @NoResponseReplay()
  @ApiOperation({
    summary: 'Agent: one-time ticket for the launch-offer socket (/launch namespace)',
  })
  @ApiResponse(201, 'Socket ticket', LaunchTicketSchema)
  ticket(@Req() request: FastifyRequest) {
    return this.realtime.issue(request);
  }

  /** agent-web reports ignored identifying query parameters (a security signal, never content). */
  @Post('launch/param-signals')
  @HttpCode(204)
  @RequirePermissions('create:Session')
  @SkipAudit()
  @ApiOperation({ summary: 'Agent: report ignored identifying URL parameters' })
  @ApiResponse(204, 'Recorded')
  async signal(@ZBody(ParamSignalSchema) input: z.infer<typeof ParamSignalSchema>): Promise<void> {
    const known = input.params
      .map((p) => p.toLowerCase())
      .filter((p) => (FORBIDDEN_LAUNCH_PARAMS as readonly string[]).includes(p));
    if (known.length === 0) return;
    const principal = requestContext.require().principal;
    await this.audit.record(this.db.current(), {
      action: 'launch.urlParams.rejected',
      target: { type: 'User', id: principal?.id ?? 'unknown' },
      outcome: 'denied',
      reason: 'identifying_url_parameters',
      metadata: { params: [...new Set(known)].sort(), security: true },
    });
  }
}
