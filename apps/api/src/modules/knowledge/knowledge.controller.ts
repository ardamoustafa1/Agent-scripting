import { Controller, Get, HttpCode, Inject, Patch, Post, Req, Res } from '@nestjs/common';

import {
  CreateKnowledgeArticleSchema,
  KnowledgeArticleKeySchema,
  KnowledgeArticleSchema,
  KnowledgeSearchQuerySchema,
  KnowledgeSearchResultSchema,
  UpdateKnowledgeArticleSchema,
  type CreateKnowledgeArticleInput,
  type KnowledgeArticle,
  type KnowledgeSearchQuery,
  type UpdateKnowledgeArticleInput,
} from '@verbis/shared-types';

import { UuidSchema } from '../../common/dto.js';
import { expectedVersion, setEtag } from '../../common/http/if-match.js';
import { ZBody, ZParam, ZQuery } from '../../common/validation/zod.js';
import {
  ApiOperation,
  ApiResponse,
  ApiTag,
  Idempotent,
  RequiresIfMatch,
} from '../../openapi/metadata.js';
import { Can } from '../authz/permissions.js';

import {
  KnowledgeArticleListQuerySchema,
  KnowledgeArticlePageSchema,
  type KnowledgeArticleListQuery,
} from './knowledge.dto.js';
import { KnowledgeService } from './knowledge.service.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

/** Authoring of the in-script knowledge base (ADR-0057); agents read through their session. */
@ApiTag('knowledge')
@Controller('v1/knowledge-articles')
export class KnowledgeController {
  constructor(@Inject(KnowledgeService) private readonly knowledge: KnowledgeService) {}

  @ApiOperation({ summary: 'List knowledge articles in every state' })
  @ApiResponse(200, 'A page of articles', KnowledgeArticlePageSchema)
  @Can('read', 'KnowledgeArticle')
  @Get()
  list(@ZQuery(KnowledgeArticleListQuerySchema) query: KnowledgeArticleListQuery) {
    return this.knowledge.list(query);
  }

  @ApiOperation({
    summary: 'Ranked full-text search over draft and published articles (Turkish-aware)',
  })
  @ApiResponse(200, 'Best matches first', KnowledgeSearchResultSchema)
  @Can('read', 'KnowledgeArticle')
  @Get('search')
  async search(@ZQuery(KnowledgeSearchQuerySchema) query: KnowledgeSearchQuery) {
    return {
      results: await this.knowledge.search(query.q, { publishedOnly: false, limit: query.limit }),
    };
  }

  @ApiOperation({ summary: 'A draft or published article by its key (designer preview)' })
  @ApiResponse(200, 'Article', KnowledgeArticleSchema)
  @Can('read', 'KnowledgeArticle')
  @Get('by-key/:key')
  byKey(@ZParam('key', KnowledgeArticleKeySchema) key: string) {
    return this.knowledge.byKey(key);
  }

  @ApiOperation({ summary: 'Get a knowledge article' })
  @ApiResponse(200, 'Article', KnowledgeArticleSchema, { etag: 'Current version' })
  @Can('read', 'KnowledgeArticle')
  @Get(':id')
  async get(
    @ZParam('id', UuidSchema) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<KnowledgeArticle> {
    const article = await this.knowledge.get(id);
    setEtag(reply, article.version);
    return article;
  }

  @ApiOperation({ summary: 'Create a draft article (the key is immutable afterwards)' })
  @ApiResponse(201, 'Created', KnowledgeArticleSchema, {
    location: 'URL of the article',
    etag: 'Current version',
  })
  @Can('create', 'KnowledgeArticle')
  @Idempotent()
  @HttpCode(201)
  @Post()
  async create(
    @ZBody(CreateKnowledgeArticleSchema) body: CreateKnowledgeArticleInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<KnowledgeArticle> {
    const article = await this.knowledge.create(body);
    setEtag(reply, article.version);
    void reply.header('location', `/v1/knowledge-articles/${article.id}`);
    return article;
  }

  @ApiOperation({
    summary: 'Edit an article (optimistic locking); a published article changes for agents at once',
  })
  @ApiResponse(200, 'Updated', KnowledgeArticleSchema, { etag: 'New version' })
  @Can('update', 'KnowledgeArticle')
  @RequiresIfMatch()
  @Patch(':id')
  async update(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(UpdateKnowledgeArticleSchema) body: UpdateKnowledgeArticleInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<KnowledgeArticle> {
    const article = await this.knowledge.update(id, expectedVersion(request), body);
    setEtag(reply, article.version);
    return article;
  }

  @ApiOperation({ summary: 'Publish a draft or archived article to agents' })
  @ApiResponse(200, 'Published', KnowledgeArticleSchema, { etag: 'New version' })
  @Can('publish', 'KnowledgeArticle')
  @RequiresIfMatch()
  @HttpCode(200)
  @Post(':id/publish')
  publish(
    @ZParam('id', UuidSchema) id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<KnowledgeArticle> {
    return this.transition(id, request, reply, 'publish');
  }

  @ApiOperation({ summary: 'Archive an article; agents no longer see it' })
  @ApiResponse(200, 'Archived', KnowledgeArticleSchema, { etag: 'New version' })
  @Can('publish', 'KnowledgeArticle')
  @RequiresIfMatch()
  @HttpCode(200)
  @Post(':id/archive')
  archive(
    @ZParam('id', UuidSchema) id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<KnowledgeArticle> {
    return this.transition(id, request, reply, 'archive');
  }

  private async transition(
    id: string,
    request: FastifyRequest,
    reply: FastifyReply,
    action: 'publish' | 'archive',
  ): Promise<KnowledgeArticle> {
    const article = await this.knowledge.transition(id, expectedVersion(request), action);
    setEtag(reply, article.version);
    return article;
  }
}
