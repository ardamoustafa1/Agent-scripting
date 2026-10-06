import { Controller, Get, Post, Put, Inject, Header } from '@nestjs/common';
import { z } from 'zod';

import {
  AiRequestSchema,
  AiSettingsSchema,
  AiConfigSaveSchema,
  AiSuggestionSchema,
  AiUsageSchema,
  type AiRequest,
} from '@verbis/shared-types';

import { NoResponseReplay } from '../../common/idempotency/idempotency.interceptor.js';
import { ZBody } from '../../common/validation/zod.js';
import { OwnTenantTransactions } from '../../infra/database/tenant-transaction.interceptor.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { Can, AnyAuthenticated } from '../authz/permissions.js';

import { AiService } from './ai.service.js';

@ApiTag('ai')
@Controller('v1/ai')
export class AiController {
  constructor(@Inject(AiService) private readonly ai: AiService) {}
  @Get('status')
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Tenant AI availability; disabled by default' })
  @ApiResponse(200, 'Availability', z.object({ enabled: z.boolean(), agentEnabled: z.boolean() }))
  status() {
    return this.ai.status();
  }
  @Get('settings')
  @Can('manage', 'Tenant')
  @ApiOperation({ summary: 'AI provider/residency and secret references; never secret values' })
  @ApiResponse(200, 'Settings', AiSettingsSchema)
  settings() {
    return this.ai.settings();
  }
  @Put('settings')
  @Can('manage', 'Tenant')
  @ApiOperation({ summary: 'Audited tenant AI configuration with optimistic version fencing' })
  @ApiResponse(200, 'Settings', AiSettingsSchema)
  save(@ZBody(AiConfigSaveSchema) input: z.infer<typeof AiConfigSaveSchema>) {
    return this.ai.save(input.version, input.config);
  }
  @Post('reconcile')
  @Can('manage', 'Tenant')
  @ApiOperation({
    summary: 'Release stale concurrency slots without refunding unknown provider spend',
  })
  reconcile() {
    return this.ai.reconcile();
  }
  @Get('usage')
  @Can('manage', 'Tenant')
  @ApiOperation({ summary: 'Tenant monthly AI usage including in-flight reservations' })
  @ApiResponse(200, 'Usage', AiUsageSchema)
  usage() {
    return this.ai.usage();
  }
  @Header('Cache-Control', 'no-store')
  @Post('suggestions')
  @AnyAuthenticated()
  @NoResponseReplay()
  @OwnTenantTransactions()
  @ApiOperation({
    summary:
      'Locally redacted, quota-reserved AI suggestion; SSO and instance permission required; no automatic application',
  })
  @ApiResponse(201, 'Human-review suggestion', AiSuggestionSchema)
  generate(@ZBody(AiRequestSchema) input: AiRequest) {
    return this.ai.generate(input);
  }
}
