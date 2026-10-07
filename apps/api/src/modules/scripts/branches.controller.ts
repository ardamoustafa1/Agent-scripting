import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { z } from 'zod';

import { UuidSchema } from '../../common/dto.js';
import { ZBody, ZParam } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { Can } from '../authz/permissions.js';

import { BranchesService, BranchNameSchema } from './branches.service.js';
import {
  BranchMergePreviewSchema,
  BranchSchema,
  CreateBranchSchema,
  CreatedVersionSchema,
} from './scripts.dto.js';

/** Script branches (ADR-0051, DIFFERENTIATORS C3). */
@ApiTag('script-branches')
@Controller('v1/scripts/:id/branches')
export class BranchesController {
  constructor(@Inject(BranchesService) private readonly branches: BranchesService) {}

  @ApiOperation({ summary: 'List the branches of a script (each has one working version)' })
  @ApiResponse(200, 'Branches', z.array(BranchSchema))
  @Can('read', 'Script')
  @Get()
  list(@ZParam('id', UuidSchema) id: string) {
    return this.branches.list(id);
  }

  @ApiOperation({ summary: 'Create a branch as a copy of a mainline version' })
  @ApiResponse(201, 'The branch', BranchSchema)
  @Can('update', 'Script')
  @Post()
  create(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(CreateBranchSchema) body: z.output<typeof CreateBranchSchema>,
  ) {
    return this.branches.create(id, body.name, body.fromNumber);
  }

  @ApiOperation({
    summary: 'What merging the branch into the current mainline would do; stores nothing',
  })
  @ApiResponse(200, 'Merge preview', BranchMergePreviewSchema)
  @Can('read', 'Script')
  @Get(':name/merge-preview')
  preview(@ZParam('id', UuidSchema) id: string, @ZParam('name', BranchNameSchema) name: string) {
    return this.branches.mergePreview(id, name);
  }

  @ApiOperation({
    summary:
      'Merge the branch into a new mainline draft; conflicts are refused, never auto-resolved',
  })
  @ApiResponse(200, 'The new mainline draft', CreatedVersionSchema)
  @Can('update', 'Script')
  @HttpCode(200)
  @Post(':name/merge')
  merge(@ZParam('id', UuidSchema) id: string, @ZParam('name', BranchNameSchema) name: string) {
    return this.branches.merge(id, name);
  }
}
