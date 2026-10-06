import { Controller, Post, HttpCode, Inject, Req } from '@nestjs/common';
import { z } from 'zod';

import { CollaborationTicketSchema } from '@verbis/shared-types';

import { UuidSchema } from '../../common/dto.js';
import { NoResponseReplay } from '../../common/idempotency/idempotency.interceptor.js';
import { ZParam } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { Can } from '../authz/permissions.js';

import { CollaborationService } from './collaboration.service.js';

import type { FastifyRequest } from 'fastify';

const NumberSchema = z.coerce.number().int().positive();
@ApiTag('collaboration')
@Controller('v1/scripts/:id/versions/:number/collaboration')
export class CollaborationController {
  constructor(@Inject(CollaborationService) private readonly service: CollaborationService) {}
  @ApiOperation({
    summary: 'Issue a one-use 30-second origin-bound collaborative authoring ticket',
  })
  @ApiResponse(200, 'Room ticket', CollaborationTicketSchema)
  @Can('update', 'Script')
  @NoResponseReplay()
  @HttpCode(200)
  @Post('ticket')
  ticket(
    @Req() request: FastifyRequest,
    @ZParam('id', UuidSchema) id: string,
    @ZParam('number', NumberSchema) number: number,
  ) {
    return this.service.issue(request, id, number);
  }
  @ApiOperation({ summary: 'Persist and freeze the room before changing the draft lifecycle' })
  @ApiResponse(200, 'Room closed', z.object({ closed: z.boolean() }))
  @Can('update', 'Script')
  @NoResponseReplay()
  @HttpCode(200)
  @Post('flush')
  flush(@ZParam('id', UuidSchema) id: string, @ZParam('number', NumberSchema) number: number) {
    return this.service.flush(id, number);
  }
}
