import { Controller, Get, Post, Put, Inject, Req, Header } from '@nestjs/common';
import { z } from 'zod';

import { UuidSchema } from '../../common/dto.js';
import { ConflictError } from '../../common/errors/domain-errors.js';
import { expectedVersion } from '../../common/http/if-match.js';
import { ZBody, ZParam } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag, RequiresIfMatch } from '../../openapi/metadata.js';
import { RequirePermissions } from '../authz/permissions.js';

import { AdminPrivacyService } from './privacy.service.js';
import {
  AdminTenantInputSchema,
  AdminTenantViewSchema,
  AdminPrivacyInputSchema,
  AdminPrivacyViewSchema,
  AdminConnectorInputSchema,
  IssuerInputSchema,
  IdpDiscoverInputSchema,
  IdpDiscoveryViewSchema,
  SamlImportInputSchema,
  SamlImportViewSchema,
  UserMappingSchema,
  JsonObjectSchema,
} from './workspace.dto.js';
import { AdminWorkspaceService, parseSamlMetadata } from './workspace.service.js';

import type { FastifyRequest } from 'fastify';

@ApiTag('admin-workspace')
@Controller('v1/admin')
export class AdminWorkspaceController {
  constructor(
    @Inject(AdminWorkspaceService) private readonly service: AdminWorkspaceService,
    @Inject(AdminPrivacyService) private readonly privacy: AdminPrivacyService,
  ) {}
  @Get('operations')
  @RequirePermissions('read:AuditEvent')
  @ApiOperation({ summary: 'Actual integration failure ratio over the last 24 hours' })
  @ApiResponse(
    200,
    'Metrics',
    z.object({
      windowHours: z.number(),
      source: z.string(),
      total: z.number(),
      failed: z.number(),
      errorRate: z.number().nullable(),
    }),
  )
  operations() {
    return this.service.operations();
  }
  @Get('tenants')
  @RequirePermissions('manage:Tenant')
  @ApiOperation({ summary: 'Platform SuperAdmin tenant registry' })
  @ApiResponse(200, 'Tenants', z.array(AdminTenantViewSchema))
  tenants() {
    return this.service.tenants();
  }
  @Post('tenants')
  @RequirePermissions('manage:Tenant')
  @ApiOperation({ summary: 'Create tenant and bootstrap system roles; platform-only' })
  @ApiResponse(201, 'Tenant', AdminTenantViewSchema)
  createTenant(@ZBody(AdminTenantInputSchema) input: z.infer<typeof AdminTenantInputSchema>) {
    return this.service.tenant(input);
  }
  @Put('tenants/:id')
  @RequirePermissions('manage:Tenant')
  @RequiresIfMatch()
  @ApiOperation({ summary: 'Set tenant state, quotas and features; platform-only' })
  @ApiResponse(200, 'Tenant', AdminTenantViewSchema)
  updateTenant(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(AdminTenantInputSchema) input: z.infer<typeof AdminTenantInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.service.tenant(input, id, expectedVersion(request));
  }
  @Get('secrets/:id/usage')
  @RequirePermissions('read:Secret', 'read:DataSource')
  @ApiOperation({ summary: 'Integration references to secret metadata, without values' })
  @ApiResponse(
    200,
    'Usage',
    z.object({
      data: z.array(z.object({ id: z.uuid(), key: z.string(), protocol: z.string() })),
      truncated: z.boolean(),
    }),
  )
  secretUsage(@ZParam('id', UuidSchema) id: string) {
    return this.service.secretUsage(id);
  }
  @Get('connectors/:id')
  @RequirePermissions('manage:Connector')
  @ApiOperation({ summary: 'Connector configuration with references, no credentials' })
  @ApiResponse(200, 'Connector', JsonObjectSchema)
  connector(@ZParam('id', UuidSchema) id: string) {
    return this.service.connectorDetail(id);
  }
  @Post('connectors')
  @RequirePermissions('manage:Connector')
  @ApiOperation({ summary: 'Configure connector with vault references' })
  @ApiResponse(201, 'Connector', JsonObjectSchema)
  createConnector(
    @ZBody(AdminConnectorInputSchema) input: z.infer<typeof AdminConnectorInputSchema>,
  ) {
    return this.service.connector(input);
  }
  @Put('connectors/:id')
  @RequirePermissions('manage:Connector')
  @RequiresIfMatch()
  @ApiOperation({ summary: 'Replace connector config, fenced by version' })
  @ApiResponse(200, 'Connector', JsonObjectSchema)
  updateConnector(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(AdminConnectorInputSchema) input: z.infer<typeof AdminConnectorInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.service.connector(input, id, expectedVersion(request));
  }
  @Post('connectors/:id/test')
  @RequirePermissions('manage:Connector')
  @ApiOperation({ summary: 'Probe actual connector supervisor state' })
  @ApiResponse(201, 'Health', JsonObjectSchema)
  test(@ZParam('id', UuidSchema) id: string) {
    return this.service.connectorHealth(id);
  }
  @Post('identity-providers/:id/test')
  @RequirePermissions('manage:IdentityProvider')
  @ApiOperation({
    summary:
      'Probe OIDC discovery or SAML endpoint reachability (not an authenticated SSO round trip)',
  })
  @ApiResponse(201, 'Probe', JsonObjectSchema)
  testIdentity(@ZParam('id', UuidSchema) id: string) {
    return this.service.testIdentity(id);
  }
  @Post('identity/discovery')
  @RequirePermissions('manage:IdentityProvider')
  @ApiOperation({ summary: 'SSRF-protected OIDC discovery preview' })
  @ApiResponse(201, 'Discovery', IdpDiscoveryViewSchema)
  discovery(@ZBody(IdpDiscoverInputSchema) input: z.infer<typeof IdpDiscoverInputSchema>) {
    return this.service.discover(input.url);
  }
  @Post('identity/saml-import')
  @RequirePermissions('manage:IdentityProvider')
  @ApiOperation({ summary: 'Import bounded, entity-free SAML metadata' })
  @ApiResponse(201, 'Metadata', SamlImportViewSchema)
  saml(@ZBody(SamlImportInputSchema) input: z.infer<typeof SamlImportInputSchema>) {
    return parseSamlMetadata(input.xml);
  }
  @Get('launch-issuers')
  @RequirePermissions('manage:Tenant')
  @ApiOperation({ summary: 'Public launch JWKS registry' })
  @ApiResponse(200, 'Issuers', z.array(JsonObjectSchema))
  issuers() {
    return this.service.issuers();
  }
  @Post('launch-issuers')
  @RequirePermissions('manage:Tenant')
  @ApiOperation({ summary: 'Register public launch signing keys' })
  @ApiResponse(201, 'Issuer', JsonObjectSchema)
  createIssuer(@ZBody(IssuerInputSchema) input: z.infer<typeof IssuerInputSchema>) {
    return this.service.issuer(input);
  }
  @Put('launch-issuers/:id')
  @RequirePermissions('manage:Tenant')
  @RequiresIfMatch()
  @ApiOperation({ summary: 'Rotate public JWKS with overlapping kids' })
  @ApiResponse(200, 'Issuer', JsonObjectSchema)
  issuer(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(IssuerInputSchema) input: z.infer<typeof IssuerInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.service.issuer(input, id, expectedVersion(request));
  }
  @Put('users/:id/connector-mapping')
  @RequirePermissions('manage:Connector', 'update:User')
  @ApiOperation({ summary: 'Map verified tenant user to platform identity' })
  @ApiResponse(200, 'User identity mapping', JsonObjectSchema)
  mapping(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(UserMappingSchema) input: z.infer<typeof UserMappingSchema>,
  ) {
    return this.service.mapping(id, input);
  }
  @Get('privacy-requests')
  @RequirePermissions('manage:Tenant')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Data subject requests without subject values' })
  @ApiResponse(200, 'Requests', z.array(AdminPrivacyViewSchema))
  privacyList() {
    return this.privacy.list();
  }
  @Post('privacy-requests')
  @RequirePermissions('manage:Tenant')
  @ApiOperation({ summary: 'Register verified data subject request; encrypted subject' })
  @ApiResponse(201, 'Request', AdminPrivacyViewSchema)
  privacyCreate(@ZBody(AdminPrivacyInputSchema) input: z.infer<typeof AdminPrivacyInputSchema>) {
    return this.privacy.create(input);
  }
  @Post('privacy-requests/:id/process')
  @RequirePermissions('manage:Tenant')
  @RequiresIfMatch()
  @ApiOperation({ summary: 'Process bounded tenant request; legal hold and active session guards' })
  @ApiResponse(201, 'Result', AdminPrivacyViewSchema)
  process(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(z.strictObject({ confirmRequestId: UuidSchema })) body: { confirmRequestId: string },
    @Req() request: FastifyRequest,
  ) {
    if (body.confirmRequestId !== id)
      throw new ConflictError('Confirmation does not match request');
    return this.privacy.process(id, expectedVersion(request));
  }
  @Get('privacy-requests/:id/export')
  @RequirePermissions('manage:Tenant')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Audited bounded data subject export; no PCI or audit rewrites' })
  @ApiResponse(200, 'Records', JsonObjectSchema)
  export(@ZParam('id', UuidSchema) id: string) {
    return this.privacy.export(id);
  }
}
