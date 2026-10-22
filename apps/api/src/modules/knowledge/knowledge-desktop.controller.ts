import { Controller, Get, Header, HttpCode, Inject, Post } from '@nestjs/common';

import {
  KnowledgeArticleKeySchema,
  KnowledgeArticleViewSchema,
  KnowledgeSearchQuerySchema,
  KnowledgeSearchResultSchema,
  type KnowledgeSearchQuery,
} from '@verbis/shared-types';

import { UuidSchema } from '../../common/dto.js';
import { ForbiddenError } from '../../common/errors/domain-errors.js';
import { NoResponseReplay } from '../../common/idempotency/idempotency.interceptor.js';
import { ZBody, ZParam } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { SkipAudit } from '../audit/audit.decorators.js';
import { Can } from '../authz/permissions.js';
import { assertRuntimeOwner } from '../runtime/runtime-data.service.js';
import { RuntimeEngineService } from '../runtime/runtime-engine.service.js';

import { KnowledgeService } from './knowledge.service.js';

/** Session states in which the agent works with the call and may look things up. */
const READABLE_STATES = ['active', 'paused', 'wrapup'];

/**
 * Agents read published knowledge articles through their own interaction session (ADR-0057,
 * as ADR-0056 does for data sources): no `KnowledgeArticle` permission is involved. Search runs
 * as a POST so the agent's words never sit in a URL; they are not stored or audited.
 */
@ApiTag('agent-desktop')
@Controller('v1/sessions')
export class KnowledgeDesktopController {
  constructor(
    @Inject(RuntimeEngineService) private readonly runtime: RuntimeEngineService,
    @Inject(KnowledgeService) private readonly knowledge: KnowledgeService,
  ) {}

  @Post(':id/desktop/knowledge/search')
  @HttpCode(200)
  @Can('read', 'Session')
  @SkipAudit()
  @NoResponseReplay()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Owner-only ranked search over published knowledge articles' })
  @ApiResponse(200, 'Best matches first', KnowledgeSearchResultSchema)
  async search(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(KnowledgeSearchQuerySchema) input: KnowledgeSearchQuery,
  ) {
    await this.requireSession(id);
    return {
      results: await this.knowledge.search(input.q, { publishedOnly: true, limit: input.limit }),
    };
  }

  @Get(':id/desktop/knowledge/:key')
  @Can('read', 'Session')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Owner-only published knowledge article by key' })
  @ApiResponse(200, 'Article', KnowledgeArticleViewSchema)
  async article(
    @ZParam('id', UuidSchema) id: string,
    @ZParam('key', KnowledgeArticleKeySchema) key: string,
  ) {
    await this.requireSession(id);
    return this.knowledge.published(key);
  }

  private async requireSession(id: string): Promise<void> {
    const row = await this.runtime.row(id);
    this.runtime.authorize(row);
    assertRuntimeOwner(row.userId);
    if (row.kind !== 'interaction' || !READABLE_STATES.includes(row.state))
      throw new ForbiddenError();
  }
}
