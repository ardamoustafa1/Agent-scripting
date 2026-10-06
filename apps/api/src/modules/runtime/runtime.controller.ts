import { Controller, Get, Inject } from '@nestjs/common';

import { UuidSchema } from '../../common/dto.js';
import { ZParam, ZQuery } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { RequirePermissions } from '../authz/permissions.js';

import {
  SessionEventListQuerySchema,
  SessionEventPageSchema,
  SessionListQuerySchema,
  SessionPageSchema,
  SessionSchema,
  type SessionEventListQuery,
  type SessionListQuery,
} from './runtime.dto.js';
import { RuntimeService } from './runtime.service.js';

@ApiTag('runtime')
@Controller('v1/sessions')
export class RuntimeController {
  constructor(@Inject(RuntimeService) private readonly runtime: RuntimeService) {}

  @ApiOperation({ summary: 'List runtime sessions' })
  @ApiResponse(200, 'A page of sessions', SessionPageSchema)
  @RequirePermissions('read:Session')
  @Get()
  list(@ZQuery(SessionListQuerySchema) query: SessionListQuery) {
    return this.runtime.listSessions(query);
  }

  @ApiOperation({ summary: 'Get a session' })
  @ApiResponse(200, 'The session', SessionSchema)
  @RequirePermissions('read:Session')
  @Get(':id')
  get(@ZParam('id', UuidSchema) id: string) {
    return this.runtime.getSession(id);
  }

  @ApiOperation({ summary: 'List session events in order' })
  @ApiResponse(200, 'A page of session events', SessionEventPageSchema)
  @RequirePermissions('read:Session')
  @Get(':id/events')
  events(
    @ZParam('id', UuidSchema) id: string,
    @ZQuery(SessionEventListQuerySchema) query: SessionEventListQuery,
  ) {
    return this.runtime.listEvents(id, query);
  }
}
