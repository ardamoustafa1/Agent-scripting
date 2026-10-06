import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { z } from 'zod';

import { UuidSchema } from '../../common/dto.js';
import { NoResponseReplay } from '../../common/idempotency/idempotency.interceptor.js';
import { ZBody, ZParam } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { SkipAudit } from '../audit/audit.decorators.js';
import { RequirePermissions } from '../authz/permissions.js';

import { ConnectorHubService } from './connector-hub.service.js';

const HubConnectorSchema = z
  .object({
    id: UuidSchema,
    adapterType: z.string(),
    platform: z.string(),
    config: z.unknown(),
    version: z.number().int(),
  })
  .meta({ id: 'HubConnector' });
const HealthReportSchema = z
  .strictObject({
    status: z.enum(['up', 'degraded', 'down']),
    detail: z.string().max(512).optional(),
  })
  .meta({ id: 'ConnectorHealthReport' });
const IngestSchema = z.strictObject({ event: z.unknown() }).meta({ id: 'ConnectorEventIngest' });
const IngestResultSchema = z
  .object({ interactionId: UuidSchema, agentId: UuidSchema.nullable(), status: z.string() })
  .meta({ id: 'ConnectorEventIngested' });

/**
 * connector-hub → API (ADR-0018). Service clients with mTLS only; the hub sends
 * `Idempotency-Key: <eventId>` so platform redeliveries are answered from the stored response.
 */
@ApiTag('connector-hub')
@Controller('v1/connector-hub/connectors')
export class ConnectorHubController {
  constructor(@Inject(ConnectorHubService) private readonly hub: ConnectorHubService) {}

  @Get()
  @RequirePermissions('read:Connector')
  @ApiOperation({ summary: 'Hub: active connectors of this tenant with their non-secret config' })
  @ApiResponse(200, 'Connectors', z.array(HubConnectorSchema))
  list() {
    return this.hub.listConnectors();
  }

  @Post(':id/secrets')
  @HttpCode(200)
  @RequirePermissions('read:Connector')
  @SkipAudit()
  @NoResponseReplay()
  @ApiOperation({ summary: 'Hub: resolve the connector secrets from the integration secret vault' })
  @ApiResponse(
    200,
    'Secret values by connector-local name',
    z.object({ secrets: z.record(z.string(), z.string()) }),
  )
  secrets(@ZParam('id', UuidSchema) id: string) {
    return this.hub.resolveSecrets(id);
  }

  @Post(':id/health')
  @HttpCode(204)
  @RequirePermissions('update:Connector')
  @SkipAudit()
  @ApiOperation({ summary: 'Hub: report connector health' })
  @ApiResponse(204, 'Recorded')
  async health(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(HealthReportSchema) input: z.infer<typeof HealthReportSchema>,
  ) {
    await this.hub.reportHealth(id, input);
  }

  @Post(':id/events')
  @RequirePermissions('update:Connector')
  @SkipAudit()
  @ApiOperation({ summary: 'Hub: ingest a normalized interaction event' })
  @ApiResponse(201, 'Interaction upserted', IngestResultSchema)
  ingest(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(IngestSchema) input: z.infer<typeof IngestSchema>,
  ) {
    return this.hub.ingest(id, input.event);
  }
}
