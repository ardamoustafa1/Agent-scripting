import { Controller, Get, HttpCode, Inject, Post, Query, Res } from '@nestjs/common';
import { z } from 'zod';

import { PackageImportRequestSchema } from '@verbis/shared-types';

import { UuidSchema } from '../../common/dto.js';
import { ZBody, ZParam, ZQuery } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { Can } from '../authz/permissions.js';

import { PackageSchema } from './domain/package-format.js';
import {
  ExportPackageSchema,
  PackagesService,
  type ExportPackageInput,
} from './packages.service.js';
import {
  CreateSharedScreenSchema,
  PublishSharedScreenVersionSchema,
  SharedScreensService,
  type CreateSharedScreenInput,
  type PublishSharedScreenVersionInput,
} from './shared-screens.service.js';
import {
  CreateTemplateSchema,
  InstantiateTemplateSchema,
  TEMPLATE_CATEGORIES,
  TemplatesService,
  type CreateTemplateInput,
} from './templates.service.js';

import type { FastifyReply } from 'fastify';

@ApiTag('screens')
@Controller('v1/shared-screens')
export class SharedScreensController {
  constructor(@Inject(SharedScreensService) private readonly screens: SharedScreensService) {}

  @ApiOperation({ summary: 'Shared (reusable) screens with their latest version' })
  @ApiResponse(200, 'Shared screens')
  @Can('read', 'Screen')
  @Get()
  list() {
    return this.screens.list();
  }

  @ApiOperation({ summary: 'Create a shared screen (version 1)' })
  @ApiResponse(201, 'Created')
  @Can('create', 'Screen')
  @HttpCode(201)
  @Post()
  create(@ZBody(CreateSharedScreenSchema) body: CreateSharedScreenInput) {
    return this.screens.create(body);
  }

  @ApiOperation({ summary: 'Publish a new immutable version; returns the affected scripts' })
  @ApiResponse(201, 'Published with impact')
  @Can('update', 'Screen')
  @HttpCode(201)
  @Post(':id/versions')
  publish(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(PublishSharedScreenVersionSchema) body: PublishSharedScreenVersionInput,
  ) {
    return this.screens.publishVersion(id, body);
  }

  @ApiOperation({ summary: 'Scripts that link this screen and whether they are behind' })
  @ApiResponse(200, 'Impact')
  @Can('read', 'Screen')
  @Get(':id/impact')
  impact(@ZParam('id', UuidSchema) id: string) {
    return this.screens.impact(id);
  }
}

@ApiTag('scripts')
@Controller('v1/templates')
export class TemplatesController {
  constructor(@Inject(TemplatesService) private readonly templates: TemplatesService) {}

  @ApiOperation({ summary: 'Template library (built-in + tenant templates)' })
  @ApiResponse(200, 'Templates')
  @Can('read', 'Script')
  @Get()
  list(
    @ZQuery(
      z.strictObject({
        category: z.enum(TEMPLATE_CATEGORIES).optional(),
        q: z.string().trim().min(1).max(100).optional(),
      }),
    )
    query: {
      category?: string;
      q?: string;
    },
  ) {
    return this.templates.list(query);
  }

  @ApiOperation({ summary: 'Save a script version as a template' })
  @ApiResponse(201, 'Created')
  @Can('create', 'Script')
  @HttpCode(201)
  @Post()
  create(@ZBody(CreateTemplateSchema) body: CreateTemplateInput) {
    return this.templates.create(body);
  }

  @ApiOperation({ summary: 'Create a new script (draft version) from a template' })
  @ApiResponse(201, 'Script created')
  @Can('create', 'Script')
  @HttpCode(201)
  @Post(':id/instantiate')
  instantiate(
    @ZParam('id', z.string().min(1).max(64)) id: string,
    @ZBody(InstantiateTemplateSchema) body: { name: string; description?: string },
  ) {
    return this.templates.instantiate(id, body);
  }
}

@ApiTag('scripts')
@Controller('v1/script-packages')
export class PackagesController {
  constructor(@Inject(PackagesService) private readonly packages: PackagesService) {}

  @ApiOperation({
    summary: 'Export versions as a signed .verbis package (JSON + manifest + checksums)',
  })
  @ApiResponse(200, '.verbis package', PackageSchema)
  @Can('read', 'Script')
  @HttpCode(200)
  @Post('export')
  async export(
    @ZBody(ExportPackageSchema) body: ExportPackageInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const pkg = await this.packages.export(body);
    void reply.header(
      'content-disposition',
      `attachment; filename="${pkg.manifest.packageId}.verbis"`,
    );
    return pkg;
  }

  @ApiOperation({
    summary: 'Verify and import a .verbis package as draft versions (`?dryRun=true` to preview)',
  })
  @ApiResponse(200, 'Import result')
  @Can('create', 'Script')
  @HttpCode(200)
  @Post('import')
  import(
    @ZBody(z.union([PackageImportRequestSchema, z.record(z.string(), z.unknown())]))
    body: Record<string, unknown>,
    @Query('dryRun') dryRun?: string,
  ) {
    return this.packages.import(body, { dryRun: dryRun === 'true' });
  }
}
