import { Controller, Get, Inject, Patch, Post, Req, Res } from '@nestjs/common';
import { z } from 'zod';

import { expectedVersion, setEtag } from '../../common/http/if-match.js';
import { ZBody } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag, RequiresIfMatch } from '../../openapi/metadata.js';
import { AnyAuthenticated, RequirePermissions } from '../authz/permissions.js';

import {
  OnboardingService,
  OnboardingInputSchema,
  OnboardingResultSchema,
} from './onboarding.service.js';
import {
  TenantSchema,
  UpdateTenantSettingsSchema,
  type TenantDto,
  type UpdateTenantSettingsInput,
} from './tenancy.dto.js';
import { TenancyService } from './tenancy.service.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

@ApiTag('tenancy')
@Controller('v1/tenant')
export class TenancyController {
  constructor(
    @Inject(TenancyService) private readonly tenancy: TenancyService,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
  ) {}

  @Post('onboarding')
  @RequirePermissions('manage:Tenant', 'create:Campaign', 'create:Script', 'create:Connector')
  @ApiOperation({
    summary:
      'Idempotently create a draft onboarding campaign/script and disabled simulator; never approve or publish',
  })
  @ApiResponse(
    201,
    'Onboarding resource identifiers; created=false on repeat',
    OnboardingResultSchema.extend({ created: z.boolean() }),
  )
  bootstrap(@ZBody(OnboardingInputSchema) body: z.infer<typeof OnboardingInputSchema>) {
    return this.onboarding.bootstrap(body);
  }

  @ApiOperation({ summary: "The caller's tenant" })
  @ApiResponse(200, 'The tenant', TenantSchema)
  @AnyAuthenticated()
  @Get()
  async current(@Res({ passthrough: true }) reply: FastifyReply): Promise<TenantDto> {
    const tenant = await this.tenancy.current();
    setEtag(reply, tenant.version);
    return tenant;
  }

  @ApiOperation({ summary: 'Update tenant settings (e.g. CORS allowed origins)' })
  @ApiResponse(200, 'Updated', TenantSchema)
  @RequirePermissions('manage:Tenant')
  @RequiresIfMatch()
  @Patch('settings')
  async updateSettings(
    @ZBody(UpdateTenantSettingsSchema) body: UpdateTenantSettingsInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TenantDto> {
    const tenant = await this.tenancy.updateSettings(expectedVersion(request), body);
    setEtag(reply, tenant.version);
    return tenant;
  }
}
