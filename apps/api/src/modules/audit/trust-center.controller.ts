import { Controller, Get, Inject } from '@nestjs/common';

import { ZQuery } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { Can } from '../authz/permissions.js';

import { TrustCenterQuerySchema, TrustCenterSchema } from './trust-center.js';
import { TrustCenterService } from './trust-center.service.js';

import type { z } from 'zod';

@ApiTag('audit')
@Controller('v1')
export class TrustCenterController {
  constructor(@Inject(TrustCenterService) private readonly trust: TrustCenterService) {}

  @ApiOperation({
    summary:
      'Trust center: audit-chain verification, launch security counters, sensitive-access counts and privacy request backlog (aggregates only)',
  })
  @ApiResponse(200, 'Trust center summary', TrustCenterSchema)
  @Can('read', 'Audit')
  @Get('trust-center')
  summary(@ZQuery(TrustCenterQuerySchema) query: z.output<typeof TrustCenterQuerySchema>) {
    return this.trust.summary(query.days);
  }
}
