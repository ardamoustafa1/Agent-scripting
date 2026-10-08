import { Controller, Get, HttpCode, Inject, Patch, Post, Put, Req, Res } from '@nestjs/common';
import { z } from 'zod';

import { IdentifierSchema } from '@verbis/script-schema';
import {
  RegressionReportSchema,
  PreviewLiveCallSchema,
  PreviewLiveResultSchema,
} from '@verbis/shared-types';

import { UuidSchema } from '../../common/dto.js';
import { expectedVersion, setEtag } from '../../common/http/if-match.js';
import { NoResponseReplay } from '../../common/idempotency/idempotency.interceptor.js';
import { ZBody, ZParam, ZQuery } from '../../common/validation/zod.js';
import {
  ApiOperation,
  ApiResponse,
  ApiTag,
  Idempotent,
  RequiresIfMatch,
} from '../../openapi/metadata.js';
import { Can, RequirePermissions } from '../authz/permissions.js';

import { PreviewService } from './preview.service.js';
import {
  CreatedVersionSchema,
  CreateScriptSchema,
  CreateVersionSchema,
  ScriptListQuerySchema,
  ScriptPageSchema,
  ScriptSchema,
  ScriptVersionSchema,
  UpdateScriptSchema,
  VersionListQuerySchema,
  VersionPageSchema,
  ReviewSchema,
  ReviewVersionSchema,
  ScriptVersionSummarySchema,
  SubmitVersionSchema,
  UpdateDraftSchema,
  MergePreviewRequestSchema,
  MergePreviewSchema,
  VersionDiffSchema,
  type ReviewVersionInput,
  type SubmitVersionInput,
  type CreateScriptInput,
  type CreateVersionInput,
  type ScriptDto,
  type ScriptListQuery,
  type UpdateScriptInput,
  type VersionListQuery,
} from './scripts.dto.js';
import { ScriptsService } from './scripts.service.js';
import { VersionLifecycleService } from './version-lifecycle.service.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

const VersionNumber = z.coerce.number().int().min(1).max(1_000_000);

@ApiTag('scripts')
@Controller('v1/scripts')
export class ScriptsController {
  constructor(
    @Inject(PreviewService) private readonly preview: PreviewService,
    @Inject(ScriptsService) private readonly scripts: ScriptsService,
    @Inject(VersionLifecycleService) private readonly lifecycle: VersionLifecycleService,
  ) {}

  @ApiOperation({ summary: 'Run saved synthetic scenarios with core-runtime; no external effects' })
  @ApiResponse(200, 'Regression report for the saved document checksum', RegressionReportSchema)
  @Can('read', 'Script')
  @HttpCode(200)
  @Post(':id/versions/:number/regression')
  regression(
    @ZParam('id', UuidSchema) id: string,
    @ZParam('number', VersionNumber) number: number,
  ) {
    return this.preview.regression(id, number);
  }

  @ApiOperation({
    summary: 'Execute a pinned data source in an explicit test profile for designer preview',
  })
  @ApiResponse(
    200,
    'Secret-scrubbed runtime value; never cached as a replay response',
    PreviewLiveResultSchema,
  )
  @Can('execute', 'Integration')
  @NoResponseReplay()
  @HttpCode(200)
  @Post(':id/versions/:number/preview/data-sources/:source')
  livePreview(
    @ZParam('id', UuidSchema) id: string,
    @ZParam('number', VersionNumber) number: number,
    @ZParam('source', IdentifierSchema) source: string,
    @ZBody(PreviewLiveCallSchema) body: z.infer<typeof PreviewLiveCallSchema>,
  ) {
    return this.preview.live(id, number, source, body);
  }

  @ApiOperation({ summary: 'List scripts' })
  @ApiResponse(200, 'A page of scripts', ScriptPageSchema)
  @RequirePermissions('read:Script')
  @Get()
  list(@ZQuery(ScriptListQuerySchema) query: ScriptListQuery) {
    return this.scripts.list(query);
  }

  @ApiOperation({ summary: 'Get a script' })
  @ApiResponse(200, 'The script', ScriptSchema)
  @RequirePermissions('read:Script')
  @Get(':id')
  async get(
    @ZParam('id', UuidSchema) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ScriptDto> {
    const script = await this.scripts.get(id);
    setEtag(reply, script.version);
    return script;
  }

  @ApiOperation({ summary: 'Create a script' })
  @ApiResponse(201, 'Created', ScriptSchema)
  @RequirePermissions('create:Script')
  @Idempotent()
  @HttpCode(201)
  @Post()
  async create(
    @ZBody(CreateScriptSchema) body: CreateScriptInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ScriptDto> {
    const script = await this.scripts.create(body);
    setEtag(reply, script.version);
    void reply.header('location', `/v1/scripts/${script.id}`);
    return script;
  }

  @ApiOperation({ summary: 'Update script metadata' })
  @ApiResponse(200, 'Updated', ScriptSchema)
  @RequirePermissions('update:Script')
  @RequiresIfMatch()
  @Patch(':id')
  async update(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(UpdateScriptSchema) body: UpdateScriptInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ScriptDto> {
    const script = await this.scripts.update(id, expectedVersion(request), body);
    setEtag(reply, script.version);
    return script;
  }

  @ApiOperation({
    summary: 'Create a draft version',
    description:
      'The document is validated with @verbis/script-schema; errors return 422 with `errors[].code`.',
  })
  @ApiResponse(201, 'Created', CreatedVersionSchema)
  @RequirePermissions('create:ScriptVersion')
  @Idempotent()
  @HttpCode(201)
  @Post(':id/versions')
  async createVersion(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(CreateVersionSchema) body: CreateVersionInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const version = await this.scripts.createVersion(id, body);
    void reply.header('location', `/v1/scripts/${id}/versions/${String(version.number)}`);
    return version;
  }

  @ApiOperation({ summary: 'List versions of a script' })
  @ApiResponse(200, 'A page of versions', VersionPageSchema)
  @RequirePermissions('read:ScriptVersion')
  @Get(':id/versions')
  listVersions(
    @ZParam('id', UuidSchema) id: string,
    @ZQuery(VersionListQuerySchema) query: VersionListQuery,
  ) {
    return this.scripts.listVersions(id, query);
  }

  @ApiOperation({ summary: 'Get a version with its document' })
  @ApiResponse(200, 'The version', ScriptVersionSchema)
  @RequirePermissions('read:ScriptVersion')
  @Get(':id/versions/:number')
  getVersion(
    @ZParam('id', UuidSchema) id: string,
    @ZParam('number', VersionNumber) number: number,
  ) {
    return this.scripts.getVersion(id, number);
  }

  @ApiOperation({
    summary: 'Replace the document of a DRAFT version (approved/published are immutable)',
  })
  @ApiResponse(200, 'Updated', CreatedVersionSchema, { etag: 'New version' })
  @Can('update', 'Script')
  @RequiresIfMatch()
  @Put(':id/versions/:number/document')
  async updateDraft(
    @ZParam('id', UuidSchema) id: string,
    @ZParam('number', VersionNumber) number: number,
    @ZBody(UpdateDraftSchema) body: CreateVersionInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const version = await this.scripts.updateDraft(id, number, expectedVersion(request), body);
    setEtag(reply, version.version);
    return version;
  }

  @ApiOperation({ summary: 'Submit a draft for review with a semantic version and change note' })
  @ApiResponse(200, 'In review', ScriptVersionSummarySchema)
  @Can('update', 'Script')
  @HttpCode(200)
  @Post(':id/versions/:number/submit')
  submit(
    @ZParam('id', UuidSchema) id: string,
    @ZParam('number', VersionNumber) number: number,
    @ZBody(SubmitVersionSchema.partial({ semver: true })) body: Partial<SubmitVersionInput>,
  ) {
    return this.lifecycle.submit(id, number, body);
  }

  @ApiOperation({ summary: 'Withdraw a version from review (back to draft)' })
  @ApiResponse(200, 'Draft', ScriptVersionSummarySchema)
  @Can('update', 'Script')
  @HttpCode(200)
  @Post(':id/versions/:number/withdraw')
  withdraw(@ZParam('id', UuidSchema) id: string, @ZParam('number', VersionNumber) number: number) {
    return this.lifecycle.withdraw(id, number);
  }

  @ApiOperation({
    summary: 'Approve, reject (with reason) or comment on a version in review (SoD enforced)',
  })
  @ApiResponse(200, 'Version after the review', ScriptVersionSummarySchema)
  @Can('read', 'Script')
  @HttpCode(200)
  @Post(':id/versions/:number/reviews')
  review(
    @ZParam('id', UuidSchema) id: string,
    @ZParam('number', VersionNumber) number: number,
    @ZBody(ReviewVersionSchema) body: ReviewVersionInput,
  ) {
    return this.lifecycle.review(id, number, body);
  }

  @ApiOperation({ summary: 'Review trail of a version' })
  @ApiResponse(200, 'Reviews', ReviewSchema)
  @Can('read', 'Script')
  @Get(':id/versions/:number/reviews')
  reviews(@ZParam('id', UuidSchema) id: string, @ZParam('number', VersionNumber) number: number) {
    return this.lifecycle.listReviews(id, number);
  }

  @ApiOperation({ summary: 'Reopen an approved version for editing (discards the approval)' })
  @ApiResponse(200, 'Draft', ScriptVersionSummarySchema)
  @Can('update', 'Script')
  @HttpCode(200)
  @Post(':id/versions/:number/reopen')
  reopen(@ZParam('id', UuidSchema) id: string, @ZParam('number', VersionNumber) number: number) {
    return this.lifecycle.reopen(id, number);
  }

  @ApiOperation({ summary: 'Publish an approved version (immutable afterwards)' })
  @ApiResponse(200, 'Published', ScriptVersionSummarySchema)
  @Can('publish', 'Script')
  @HttpCode(200)
  @Post(':id/versions/:number/publish')
  publish(@ZParam('id', UuidSchema) id: string, @ZParam('number', VersionNumber) number: number) {
    return this.lifecycle.publish(id, number);
  }

  @ApiOperation({ summary: 'Retire a published version (refused while assignments pin it)' })
  @ApiResponse(200, 'Retired', ScriptVersionSummarySchema)
  @Can('publish', 'Script')
  @HttpCode(200)
  @Post(':id/versions/:number/retire')
  retire(@ZParam('id', UuidSchema) id: string, @ZParam('number', VersionNumber) number: number) {
    return this.lifecycle.retire(id, number);
  }

  @ApiOperation({
    summary:
      'Three-way structural merge preview of three versions (base, ours, theirs); stores nothing, conflicts are reported, never hidden',
  })
  @ApiResponse(200, 'Merge preview', MergePreviewSchema)
  @Can('read', 'Script')
  @HttpCode(200)
  @Post(':id/merge-preview')
  mergePreview(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(MergePreviewRequestSchema) body: z.output<typeof MergePreviewRequestSchema>,
  ) {
    return this.lifecycle.mergePreview(id, body);
  }

  @ApiOperation({ summary: 'Diff two versions: RFC 6902 patch + human-readable summary' })
  @ApiResponse(200, 'Diff', VersionDiffSchema)
  @Can('read', 'Script')
  @Get(':id/versions/:from/diff/:to')
  diff(
    @ZParam('id', UuidSchema) id: string,
    @ZParam('from', VersionNumber) from: number,
    @ZParam('to', VersionNumber) to: number,
  ) {
    return this.lifecycle.diff(id, from, to);
  }
}
