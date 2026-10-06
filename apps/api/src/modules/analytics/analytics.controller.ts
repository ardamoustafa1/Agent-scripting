import { Controller, Get, Post, Delete, Header, HttpCode, Inject, Res } from '@nestjs/common';
import { z } from 'zod';

import {
  AnalyticsFilterSchema,
  AnalyticsDashboardSchema,
  AnalyticsScheduleSchema,
  type AnalyticsFilter,
} from '@verbis/shared-types';

import { UuidSchema } from '../../common/dto.js';
import { ZBody, ZParam, ZQuery } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { Can, RequirePermissions } from '../authz/permissions.js';

import { EventCountQuerySchema, EventCountsSchema, type EventCountQuery } from './analytics.dto.js';
import { AnalyticsService } from './analytics.service.js';

import type { FastifyReply } from 'fastify';

@ApiTag('analytics')
@Controller('v1/analytics')
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {}

  @Get('dashboard')
  @Can('read', 'Report')
  @ApiOperation({ summary: 'Scoped PII-free session metrics; event-time cohort, no sampling' })
  @ApiResponse(200, 'Dashboard', AnalyticsDashboardSchema)
  dashboard(@ZQuery(AnalyticsFilterSchema) query: AnalyticsFilter) {
    return this.analytics.dashboard(query);
  }
  @Get('recommendations')
  @Can('read', 'Report')
  @ApiOperation({
    summary:
      'Scoped A/B outcome recommendations; insufficient or incomplete cohorts yield no winner',
  })
  @ApiResponse(
    200,
    'Recommendations with sample and evidence reasons',
    z.object({
      data: z.array(
        z.object({
          experimentId: z.string(),
          recommended: z.string().nullable(),
          reason: z.enum([
            'ok',
            'needs-two-cohorts',
            'insufficient-sample',
            'data-loss',
            'not-significant',
          ]),
          difference: z.number().nullable(),
          pValue: z.number().nullable(),
        }),
      ),
    }),
  )
  recommendations(@ZQuery(AnalyticsFilterSchema) query: AnalyticsFilter) {
    return this.analytics.recommendations(query);
  }
  @Get('export/:format')
  @Can('export', 'Report')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Audited CSV/XLSX report export' })
  async export(
    @ZQuery(AnalyticsFilterSchema) query: AnalyticsFilter,
    @ZParam('format', z.enum(['csv', 'xlsx'])) format: 'csv' | 'xlsx',
    @Res() reply: FastifyReply,
  ) {
    const data = await this.analytics.export(query, format);
    reply.header('Content-Disposition', `attachment; filename="verbis-analytics.${format}"`);
    reply.type(
      format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    return reply.send(data);
  }
  @Get('schedules')
  @Can('manage', 'Report')
  @ApiOperation({ summary: 'List own scheduled reports' })
  schedules() {
    return this.analytics.schedules();
  }
  @Post('schedules')
  @Can('manage', 'Report')
  @ApiOperation({ summary: 'Create audited scheduled report' })
  schedule(@ZBody(AnalyticsScheduleSchema) input: z.infer<typeof AnalyticsScheduleSchema>) {
    return this.analytics.schedule(input);
  }
  @Delete('schedules/:id')
  @Can('manage', 'Report')
  @HttpCode(200)
  @ApiOperation({ summary: 'Disable own schedule' })
  deleteSchedule(@ZParam('id', UuidSchema) id: string) {
    return this.analytics.deleteSchedule(id);
  }
  @ApiOperation({ summary: 'Domain event counts per day (fed by the event consumer)' })
  @ApiResponse(200, 'Counts', EventCountsSchema)
  @RequirePermissions('read:Analytics')
  @Get('event-counts')
  eventCounts(@ZQuery(EventCountQuerySchema) query: EventCountQuery) {
    return this.analytics.eventCounts(query);
  }
}
