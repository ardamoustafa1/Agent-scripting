import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';

import { ZBody } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { SkipAudit } from '../audit/audit.decorators.js';
import { RequirePermissions } from '../authz/permissions.js';

import {
  DeadLetterStatsSchema,
  DeadLettersService,
  ReplayRequestSchema,
  ReplayResultSchema,
  type ReplayRequest,
} from './dead-letters.service.js';

/** Admin operations on the connector hub's durable dead-letter queue (ADR-0041). */
@ApiTag('connectors')
@Controller('v1/connector-dead-letters')
export class DeadLettersController {
  constructor(@Inject(DeadLettersService) private readonly deadLetters: DeadLettersService) {}

  @Get()
  @RequirePermissions('read:Connector')
  @ApiOperation({ summary: 'Connector hub dead-letter queue statistics' })
  @ApiResponse(200, 'Dead-letter counters', DeadLetterStatsSchema)
  stats() {
    return this.deadLetters.stats();
  }

  @Post('replay')
  @HttpCode(200)
  @RequirePermissions('manage:Connector')
  @SkipAudit()
  @ApiOperation({ summary: 'Re-offer this tenant dead-lettered connector events' })
  @ApiResponse(200, 'Number of events re-offered', ReplayResultSchema)
  replay(@ZBody(ReplayRequestSchema) input: ReplayRequest) {
    return this.deadLetters.replay(input.limit);
  }
}
