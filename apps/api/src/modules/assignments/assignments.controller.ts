import { Controller, Delete, Get, HttpCode, Inject, Patch, Post, Req, Res } from '@nestjs/common';
import { z } from 'zod';

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
import { RequirePermissions } from '../authz/permissions.js';

import {
  AssignmentListQuerySchema,
  BatchAssignmentsSchema,
  AssignmentPageSchema,
  AssignmentSchema,
  CreateAssignmentSchema,
  UpdateAssignmentSchema,
  type AssignmentListQuery,
  type CreateAssignmentInput,
  type UpdateAssignmentInput,
} from './assignments.dto.js';
import { AssignmentsService } from './assignments.service.js';
import { AllocationReportSchema, RolloutReportSchema } from './rollout.dto.js';
import { RolloutService } from './rollout.service.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

@ApiTag('assignments')
@Controller('v1/assignments')
export class AssignmentsController {
  constructor(
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
    @Inject(RolloutService) private readonly rollouts: RolloutService,
  ) {}

  @ApiOperation({
    summary: 'Atomically assign multiple campaigns or update priorities and windows',
  })
  @ApiResponse(
    200,
    'Batch results',
    z.object({ creates: z.array(AssignmentSchema), updates: z.array(AssignmentSchema) }),
  )
  @RequirePermissions('update:Campaign')
  @HttpCode(200)
  @Post('batch')
  batch(@ZBody(BatchAssignmentsSchema) body: z.infer<typeof BatchAssignmentsSchema>) {
    return this.assignments.batch(body);
  }

  @ApiOperation({ summary: 'List assignments (lowest priority value first)' })
  @ApiResponse(200, 'A page of assignments', AssignmentPageSchema)
  @RequirePermissions('read:Assignment')
  @Get()
  list(@ZQuery(AssignmentListQuerySchema) query: AssignmentListQuery) {
    return this.assignments.list(query);
  }

  @ApiOperation({
    summary:
      'Canary rollout verdict: hold, advance (advisory) or rollback, from always-valid analytics. Apply a proposal with PATCH variants.',
  })
  @ApiResponse(200, 'Rollout verdict', RolloutReportSchema)
  @RequirePermissions('read:Assignment')
  @Get(':id/rollout')
  rollout(@ZParam('id', UuidSchema) id: string) {
    return this.rollouts.evaluate(id);
  }

  @ApiOperation({
    summary:
      'Bandit (Thompson sampling) traffic advice for an A/B assignment: proposed weights, never applied; guardrail-breached arms get none',
  })
  @ApiResponse(200, 'Allocation advice', AllocationReportSchema)
  @RequirePermissions('read:Assignment')
  @Get(':id/allocation')
  allocation(@ZParam('id', UuidSchema) id: string) {
    return this.rollouts.allocation(id);
  }

  @ApiOperation({ summary: 'Get an assignment' })
  @ApiResponse(200, 'The assignment', AssignmentSchema, { etag: 'Current version' })
  @RequirePermissions('read:Assignment')
  @Get(':id')
  async get(@ZParam('id', UuidSchema) id: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const dto = await this.assignments.get(id);
    setEtag(reply, dto.version);
    return dto;
  }

  @ApiOperation({
    summary:
      'Assign a script to a campaign (response lists equal-priority conflicts as `warnings`)',
  })
  @ApiResponse(201, 'Created', AssignmentSchema)
  @RequirePermissions('create:Assignment')
  @Idempotent()
  @HttpCode(201)
  @Post()
  async create(
    @ZBody(CreateAssignmentSchema) body: CreateAssignmentInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const assignment = await this.assignments.create(body);
    setEtag(reply, assignment.version);
    void reply.header('location', `/v1/assignments/${assignment.id}`);
    return assignment;
  }

  @ApiOperation({ summary: 'Update an assignment (optimistic locking)' })
  @ApiResponse(200, 'Updated', AssignmentSchema, { etag: 'New version' })
  @RequirePermissions('update:Assignment')
  @RequiresIfMatch()
  @Patch(':id')
  async update(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(UpdateAssignmentSchema) body: UpdateAssignmentInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const dto = await this.assignments.update(id, expectedVersion(request), body);
    setEtag(reply, dto.version);
    return dto;
  }

  @ApiOperation({ summary: 'Remove an assignment (soft delete)' })
  @ApiResponse(204, 'Deleted')
  @RequirePermissions('delete:Assignment')
  @RequiresIfMatch()
  @HttpCode(204)
  @Delete(':id')
  async remove(
    @ZParam('id', UuidSchema) id: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.assignments.remove(id, expectedVersion(request));
  }
}
