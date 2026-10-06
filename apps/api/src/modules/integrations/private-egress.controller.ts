import { Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { z } from 'zod';

import { UuidSchema } from '../../common/dto.js';
import { NoResponseReplay } from '../../common/idempotency/idempotency.interceptor.js';
import { ZBody, ZParam } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { SkipAudit } from '../audit/audit.decorators.js';
import { Can } from '../authz/permissions.js';

import {
  GatewayCompletionSchema,
  GatewayJobSchema,
  type GatewayCompletion,
} from './engine/gateway-contracts.js';
import { PrivateEgressService } from './private-egress.service.js';

@ApiTag('private-egress')
@Controller('v1/private-egress/jobs')
export class PrivateEgressController {
  constructor(@Inject(PrivateEgressService) private readonly gateway: PrivateEgressService) {}
  @Post('claim')
  @HttpCode(200)
  @Can('execute', 'Integration')
  @SkipAudit()
  @NoResponseReplay()
  @ApiOperation({
    summary: 'Certificate-bound gateway: claim a transient job for this service client',
  })
  @ApiResponse(200, 'Job or no work', GatewayJobSchema.nullable())
  claim(@ZBody(z.strictObject({})) _body: Record<string, never>) {
    return this.gateway.claim();
  }

  @Post(':id/complete')
  @HttpCode(204)
  @Can('execute', 'Integration')
  @SkipAudit()
  @NoResponseReplay()
  @ApiOperation({ summary: 'Gateway: complete one claimed job with its single-use lease' })
  @ApiResponse(204, 'Delivered')
  complete(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(GatewayCompletionSchema) body: GatewayCompletion,
  ) {
    return this.gateway.complete(id, body);
  }
}
