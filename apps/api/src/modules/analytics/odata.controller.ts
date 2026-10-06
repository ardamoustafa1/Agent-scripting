import { Controller, Get, Header, Inject } from '@nestjs/common';
import { z } from 'zod';

import { AnalyticsFilterSchema } from '@verbis/shared-types';

import { ZQuery } from '../../common/validation/zod.js';
import { ApiOperation, ApiTag } from '../../openapi/metadata.js';
import { Can } from '../authz/permissions.js';

import { AnalyticsService } from './analytics.service.js';

const querySchema = z.strictObject({
  from: z.iso.date(),
  to: z.iso.date(),
  campaignId: z.uuid().optional(),
  teamId: z.uuid().optional(),
  $top: z.coerce.number().int().min(1).max(1000).default(100),
  $skip: z.coerce.number().int().min(0).max(50000).default(0),
  $count: z.enum(['true', 'false']).optional(),
  $select: z
    .string()
    .regex(
      /^(key|sessions|completed|completionRate|meanDurationMs)(,(key|sessions|completed|completionRate|meanDurationMs))*$/,
    )
    .optional(),
});
@ApiTag('analytics')
@Controller('v1/analytics/odata')
export class AnalyticsODataController {
  constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {}
  @Get()
  @Can('export', 'Report')
  @ApiOperation({ summary: 'OData service document' })
  service() {
    return {
      '@odata.context': '$metadata',
      value: [{ name: 'Scripts', kind: 'EntitySet', url: 'Scripts' }],
    };
  }
  @Get('$metadata')
  @Can('export', 'Report')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @ApiOperation({ summary: 'OData v4 metadata for the read-only Scripts entity set' })
  metadata() {
    return '<?xml version="1.0" encoding="utf-8"?><edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"><edmx:DataServices><Schema Namespace="Verbis.Analytics" xmlns="http://docs.oasis-open.org/odata/ns/edm"><EntityType Name="Script"><Key><PropertyRef Name="key"/></Key><Property Name="key" Type="Edm.String" Nullable="false"/><Property Name="sessions" Type="Edm.Int32" Nullable="false"/><Property Name="completed" Type="Edm.Int32" Nullable="false"/><Property Name="completionRate" Type="Edm.Double" Nullable="false"/><Property Name="meanDurationMs" Type="Edm.Double"/></EntityType><EntityContainer Name="Container"><EntitySet Name="Scripts" EntityType="Verbis.Analytics.Script"/></EntityContainer></Schema></edmx:DataServices></edmx:Edmx>';
  }
  @Get('Scripts')
  @Can('export', 'Report')
  @ApiOperation({
    summary: 'Bounded OData-shaped BI feed ($top/$skip/$count/$select); tenant ABAC applied',
  })
  async scripts(@ZQuery(querySchema) query: z.infer<typeof querySchema>) {
    const { from, to, campaignId, teamId } = query;
    const data = await this.analytics.dashboard(
        AnalyticsFilterSchema.parse({ from, to, campaignId, teamId }),
        'export',
      ),
      keys = query.$select?.split(',');
    return {
      '@odata.context': '$metadata#Scripts',
      ...(query.$count === 'true' ? { '@odata.count': data.scripts.length } : {}),
      value: data.scripts
        .slice(query.$skip, query.$skip + query.$top)
        .map((row) =>
          keys ? Object.fromEntries(Object.entries(row).filter(([k]) => keys.includes(k))) : row,
        ),
    };
  }
}
