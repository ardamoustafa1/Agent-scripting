import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';

import { asSubject } from '@verbis/authz';

import { UuidSchema } from '../../common/dto.js';
import { NotFoundError } from '../../common/errors/domain-errors.js';
import { ZBody, ZParam } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { AuthzService } from '../authz/authz.service.js';
import { Can } from '../authz/permissions.js';

import { ResolverService } from './resolver.service.js';
import {
  ConflictSchema,
  DecisionSchema,
  ResolveRequestSchema,
  type ResolveRequest,
} from './routing.dto.js';

@ApiTag('routing')
@Controller('v1')
export class RoutingController {
  constructor(
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(ResolverService) private readonly resolver: ResolverService,
  ) {}

  @ApiOperation({
    summary: 'Resolve which script version opens for an interaction context (with decision trace)',
    description:
      'Deterministic for (context, time). Does not open a session: the secure launch flow does (SECURITY §4).',
  })
  @ApiResponse(200, 'Decision', DecisionSchema)
  @Can('read', 'Campaign')
  @HttpCode(200)
  @Post('script-resolutions')
  async resolve(@ZBody(ResolveRequestSchema) body: ResolveRequest) {
    const id = await this.resolver.lookupCampaign(body);
    if (!id) throw new NotFoundError('Campaign');
    this.authz.authorize('read', asSubject('Campaign', { id }));
    return this.resolver.resolve(body, id);
  }

  @ApiOperation({ summary: 'Equal-priority assignments of a campaign whose contexts overlap' })
  @ApiResponse(200, 'Conflicts', ConflictSchema)
  @Can('read', 'Campaign')
  @Get('campaigns/:id/assignment-conflicts')
  conflicts(@ZParam('id', UuidSchema) id: string) {
    this.authz.authorize('read', asSubject('Campaign', { id }));
    return this.resolver.conflicts(id);
  }
}
