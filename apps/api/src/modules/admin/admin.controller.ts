import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';

import { UuidSchema } from '../../common/dto.js';
import { ZParam } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { RequirePermissions } from '../authz/permissions.js';

import { OutboxStatusSchema, RequeueResultSchema } from './admin.dto.js';
import { AdminService } from './admin.service.js';

@ApiTag('admin')
@Controller('v1/admin')
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @ApiOperation({ summary: "Outbox status of the caller's tenant" })
  @ApiResponse(200, 'Counts and dead-lettered events', OutboxStatusSchema)
  @RequirePermissions('manage:Outbox')
  @Get('outbox')
  outbox() {
    return this.admin.outboxStatus();
  }

  @ApiOperation({ summary: 'Requeue a dead-lettered outbox event' })
  @ApiResponse(200, 'Requeued', RequeueResultSchema)
  @RequirePermissions('manage:Outbox')
  @HttpCode(200)
  @Post('outbox/:id/requeue')
  requeue(@ZParam('id', UuidSchema) id: string) {
    return this.admin.requeue(id);
  }
}
