import { Controller, Get, Inject, Post, Put, Headers, HttpCode, Req } from '@nestjs/common';
import { z } from 'zod';

import {
  IntegrationPromotionSchema,
  IntegrationRecordSchema,
  IntegrationMetricsSchema,
} from '@verbis/shared-types';

import { UuidSchema } from '../../common/dto.js';
import { expectedVersion } from '../../common/http/if-match.js';
import { NoResponseReplay } from '../../common/idempotency/idempotency.interceptor.js';
import { ZBody, ZParam, ZQuery } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag, RequiresIfMatch } from '../../openapi/metadata.js';
import { RequirePermissions, Can } from '../authz/permissions.js';

import {
  CallSchema,
  SaveDataSourceSchema,
  SecretSetSchema,
  ConsoleResultSchema,
} from './engine/contracts.js';
import { IntegrationEngineService } from './integration-engine.service.js';
import {
  SecretMetadataSchema,
  DataSourceListQuerySchema,
  DataSourcePageSchema,
  SecretListQuerySchema,
  SecretPageSchema,
  type DataSourceListQuery,
  type SecretListQuery,
} from './integrations.dto.js';
import { IntegrationsService } from './integrations.service.js';

import type { FastifyRequest } from 'fastify';

@ApiTag('integrations')
@Controller('v1')
export class IntegrationsController {
  constructor(
    @Inject(IntegrationsService) private readonly integrations: IntegrationsService,
    @Inject(IntegrationEngineService) private readonly engine: IntegrationEngineService,
  ) {}

  @ApiOperation({ summary: 'List data source definitions' })
  @ApiResponse(200, 'A page of data sources', DataSourcePageSchema)
  @RequirePermissions('read:DataSource')
  @Get('data-sources')
  listDataSources(@ZQuery(DataSourceListQuerySchema) query: DataSourceListQuery) {
    return this.integrations.listDataSources(query);
  }

  @ApiOperation({ summary: 'List secret metadata (never values; access is audited)' })
  @ApiResponse(200, 'A page of secret metadata', SecretPageSchema)
  @RequirePermissions('read:Secret')
  @Get('secrets')
  listSecrets(@ZQuery(SecretListQuerySchema) query: SecretListQuery) {
    return this.integrations.listSecrets(query);
  }

  @ApiOperation({ summary: 'Preview unsaved mock mapping without external requests or secrets' })
  @ApiResponse(200, 'Redacted mock trace', ConsoleResultSchema)
  @Can('update', 'Integration')
  @HttpCode(200)
  @Post('data-sources/preview')
  draftPreview(
    @ZBody(z.strictObject({ source: SaveDataSourceSchema, call: CallSchema }))
    body: {
      source: z.infer<typeof SaveDataSourceSchema>;
      call: z.infer<typeof CallSchema>;
    },
  ) {
    return this.engine.draftPreview(body.source, body.call);
  }

  @ApiOperation({ summary: 'Create a server-side data source with secret references' })
  @ApiResponse(201, 'Data source', IntegrationRecordSchema)
  @Can('create', 'Integration')
  @Post('data-sources')
  create(@ZBody(SaveDataSourceSchema) body: z.infer<typeof SaveDataSourceSchema>) {
    return this.engine.save(body);
  }

  @ApiOperation({ summary: 'Update a data source definition' })
  @ApiResponse(200, 'Data source', IntegrationRecordSchema)
  @Can('update', 'Integration')
  @RequiresIfMatch()
  @Put('data-sources/:id')
  update(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(SaveDataSourceSchema) body: z.infer<typeof SaveDataSourceSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.engine.save(body, id, expectedVersion(request));
  }

  @ApiOperation({ summary: 'Read a tenant-scoped data source definition' })
  @ApiResponse(200, 'Data source', IntegrationRecordSchema)
  @Can('read', 'Integration')
  @Get('data-sources/:id')
  get(@ZParam('id', UuidSchema) id: string) {
    return this.engine.get(id);
  }

  @ApiOperation({ summary: 'Find readable scripts using a data source' })
  @ApiResponse(
    200,
    'Consumers',
    z.object({
      data: z.array(z.object({ scriptId: z.uuid(), name: z.string(), number: z.int() })),
      truncated: z.boolean(),
    }),
  )
  @Can('read', 'Integration')
  @Get('data-sources/:id/usage')
  usage(@ZParam('id', UuidSchema) id: string) {
    return this.engine.usage(id);
  }

  @ApiOperation({ summary: 'Request production profile promotion' })
  @ApiResponse(200, 'Pending profile', IntegrationRecordSchema)
  @Can('update', 'Integration')
  @RequiresIfMatch()
  @Post('data-sources/:id/promotion')
  promote(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(IntegrationPromotionSchema) body: z.infer<typeof IntegrationPromotionSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.engine.promote(id, expectedVersion(request), body);
  }

  @ApiOperation({ summary: 'Approve production profile promotion with separation of duties' })
  @ApiResponse(200, 'Promoted profile', IntegrationRecordSchema)
  @Can('approve', 'Integration')
  @RequiresIfMatch()
  @Post('data-sources/:id/promotion/approve')
  approve(@ZParam('id', UuidSchema) id: string, @Req() request: FastifyRequest) {
    return this.engine.promote(id, expectedVersion(request));
  }

  @ApiOperation({ summary: 'Set a secret; only metadata is returned' })
  @ApiResponse(201, 'Secret metadata', SecretMetadataSchema)
  @Can('create', 'Secret')
  @Post('secrets')
  setSecret(@ZBody(SecretSetSchema) body: z.infer<typeof SecretSetSchema>) {
    return this.engine.setSecret(body);
  }

  @ApiOperation({ summary: 'Rotate secret value; never returns plaintext' })
  @ApiResponse(200, 'Secret metadata', SecretMetadataSchema)
  @Can('update', 'Secret')
  @Put('secrets/:id')
  rotate(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(SecretSetSchema) body: z.infer<typeof SecretSetSchema>,
  ) {
    return this.engine.setSecret(body, id);
  }

  @ApiOperation({ summary: 'Designer preview with mock data; no external requests' })
  @ApiResponse(200, 'Redacted console trace', ConsoleResultSchema)
  @Can('update', 'Integration')
  @HttpCode(200)
  @Post('data-sources/:id/preview')
  preview(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(CallSchema) body: z.infer<typeof CallSchema>,
  ) {
    return this.engine.console(id, body);
  }

  @ApiOperation({ summary: 'Live sandbox test console (dev/test only)' })
  @ApiResponse(200, 'Redacted console trace', ConsoleResultSchema)
  @Can('update', 'Integration')
  @Can('execute', 'Integration')
  @HttpCode(200)
  @Post('data-sources/:id/test')
  test(@ZParam('id', UuidSchema) id: string, @ZBody(CallSchema) body: z.infer<typeof CallSchema>) {
    return this.engine.console(id, body, true);
  }

  @ApiOperation({
    summary: 'Execute a pinned data source with an active runtime session and signed session token',
  })
  @ApiResponse(200, 'Mapped and schema-validated result')
  @Can('execute', 'Integration')
  @HttpCode(200)
  @NoResponseReplay()
  @Post('sessions/:sessionId/data-sources/:id/execute')
  execute(
    @ZParam('sessionId', UuidSchema) sessionId: string,
    @ZParam('id', UuidSchema) id: string,
    @Headers('x-runtime-session-token') token: string | undefined,
    @ZBody(CallSchema) body: z.infer<typeof CallSchema>,
  ) {
    return this.engine.execute(id, sessionId, token, body);
  }

  @ApiOperation({ summary: 'Import a bounded WSDL without resolving remote entities or imports' })
  @ApiResponse(
    200,
    'WSDL operation list',
    z.object({
      operations: z.array(z.object({ name: z.string(), action: z.string() })),
      namespace: z.string().optional(),
      definition: z.unknown(),
    }),
  )
  @Can('update', 'Integration')
  @HttpCode(200)
  @Post('data-sources/:id/wsdl')
  wsdl(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(z.strictObject({ xml: z.string().max(1048576) })) body: { xml: string },
  ) {
    return this.engine.wsdl(id, body.xml);
  }

  @ApiOperation({ summary: 'Fetch GraphQL introspection schema for query editor (sandbox only)' })
  @ApiResponse(200, 'GraphQL schema')
  @Can('update', 'Integration')
  @HttpCode(200)
  @Post('data-sources/:id/introspection')
  introspection(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(z.strictObject({ environment: z.enum(['dev', 'test']) }))
    body: { environment: 'dev' | 'test' },
  ) {
    return this.engine.introspect(id, body.environment);
  }

  @ApiOperation({ summary: 'Integration calls, latency percentiles, error rate and circuit state' })
  @ApiResponse(200, 'Process-local integration metrics', IntegrationMetricsSchema)
  @Can('read', 'Integration')
  @Get('data-sources/:id/metrics')
  metrics(@ZParam('id', UuidSchema) id: string) {
    return this.engine.metrics(id);
  }
}
