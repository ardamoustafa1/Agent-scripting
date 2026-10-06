import { Controller, Get, Post, HttpCode, Inject } from '@nestjs/common';
import { z } from 'zod';

import {
  CommentInputSchema,
  CommentReplySchema,
  ThreadSchema,
  ResolveThreadSchema,
  NotificationSchema,
  RollbackSchema,
  ReleaseScheduleSchema,
} from '@verbis/shared-types';

import { UuidSchema } from '../../common/dto.js';
import { ZParam, ZBody } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { Can } from '../authz/permissions.js';

import { ReleaseJobsService } from './release-jobs.service.js';
import { TeamService } from './team.service.js';
import { VersionLifecycleService } from './version-lifecycle.service.js';

const NumberSchema = z.coerce.number().int().positive();
@ApiTag('authoring-team')
@Controller('v1')
export class TeamController {
  constructor(
    @Inject(ReleaseJobsService) private readonly jobs: ReleaseJobsService,
    @Inject(TeamService) private readonly team: TeamService,
    @Inject(VersionLifecycleService) private readonly lifecycle: VersionLifecycleService,
  ) {}
  @ApiOperation({
    summary: 'Schedule a release; permissions, checksum and scenarios rechecked at execution',
  })
  @ApiResponse(
    200,
    'Scheduled release',
    z.object({ id: z.uuid(), state: z.string(), at: z.string() }),
  )
  @Can('publish', 'Script')
  @HttpCode(200)
  @Post('scripts/:id/versions/:number/schedule')
  schedule(
    @ZParam('id', UuidSchema) id: string,
    @ZParam('number', NumberSchema) number: number,
    @ZBody(ReleaseScheduleSchema) body: z.infer<typeof ReleaseScheduleSchema>,
  ) {
    return this.jobs.schedule(id, number, body.at);
  }
  @ApiOperation({ summary: 'List scheduled release statuses' })
  @ApiResponse(
    200,
    'Schedules',
    z.array(
      z.object({
        id: z.uuid(),
        state: z.string(),
        runAt: z.iso.datetime(),
        completedAt: z.iso.datetime().nullable(),
      }),
    ),
  )
  @Can('read', 'Script')
  @Get('scripts/:id/versions/:number/schedules')
  schedules(@ZParam('id', UuidSchema) id: string, @ZParam('number', NumberSchema) number: number) {
    return this.jobs.list(id, number);
  }
  @ApiOperation({ summary: 'Pending approval requests and scoped @mentions for the current user' })
  @ApiResponse(200, 'Notifications', z.array(NotificationSchema))
  @Can('read', 'Script')
  @Get('authoring-notifications')
  notifications() {
    return this.team.notifications();
  }
  @ApiOperation({ summary: 'List up to 100 active tenant members who can read the script' })
  @ApiResponse(
    200,
    'Eligible mention recipients',
    z.array(z.object({ id: z.uuid(), name: z.string() })),
  )
  @Can('read', 'Script')
  @Get('scripts/:id/versions/:number/team-members')
  members(@ZParam('id', UuidSchema) id: string, @ZParam('number', NumberSchema) number: number) {
    return this.team.members(id, number);
  }
  @ApiOperation({ summary: 'List node comment threads' })
  @ApiResponse(200, 'Threads', z.array(ThreadSchema))
  @Can('read', 'Script')
  @Get('scripts/:id/versions/:number/comments')
  threads(@ZParam('id', UuidSchema) id: string, @ZParam('number', NumberSchema) number: number) {
    return this.team.threads(id, number);
  }
  @ApiOperation({ summary: 'Create node comment with tenant user mentions' })
  @ApiResponse(201, 'Thread', ThreadSchema)
  @Can('read', 'Script')
  @Post('scripts/:id/versions/:number/comments')
  comment(
    @ZParam('id', UuidSchema) id: string,
    @ZParam('number', NumberSchema) number: number,
    @ZBody(CommentInputSchema) body: z.infer<typeof CommentInputSchema>,
  ) {
    return this.team.comment(id, number, body);
  }
  @ApiOperation({ summary: 'Reply to a node comment thread' })
  @ApiResponse(200, 'Thread', ThreadSchema)
  @Can('read', 'Script')
  @HttpCode(200)
  @Post('scripts/:id/versions/:number/comments/:thread/replies')
  reply(
    @ZParam('id', UuidSchema) id: string,
    @ZParam('number', NumberSchema) number: number,
    @ZParam('thread', UuidSchema) thread: string,
    @ZBody(CommentReplySchema) body: z.infer<typeof CommentReplySchema>,
  ) {
    return this.team.reply(id, number, thread, body);
  }
  @ApiOperation({ summary: 'Resolve or reopen a thread with optimistic concurrency' })
  @ApiResponse(200, 'Thread', ThreadSchema)
  @Can('read', 'Script')
  @HttpCode(200)
  @Post('scripts/:id/versions/:number/comments/:thread/resolve')
  resolve(
    @ZParam('id', UuidSchema) id: string,
    @ZParam('number', NumberSchema) number: number,
    @ZParam('thread', UuidSchema) thread: string,
    @ZBody(ResolveThreadSchema) body: z.infer<typeof ResolveThreadSchema>,
  ) {
    return this.team.resolve(id, number, thread, body);
  }
  @ApiOperation({ summary: 'Roll back the authoritative release head; explicit pins stay pinned' })
  @ApiResponse(
    200,
    'New release head',
    z.object({ currentVersionId: z.uuid(), number: z.number().int() }),
  )
  @Can('publish', 'Script')
  @HttpCode(200)
  @Post('scripts/:id/rollback')
  rollback(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(RollbackSchema) body: z.infer<typeof RollbackSchema>,
  ) {
    return this.lifecycle.rollback(id, body.targetNumber, body.expectedCurrentVersionId);
  }
}
