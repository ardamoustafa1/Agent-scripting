import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { z } from 'zod';

import { UuidSchema } from '../../../common/dto.js';
import { UnauthenticatedError } from '../../../common/errors/domain-errors.js';
import { expectedVersion, setEtag } from '../../../common/http/if-match.js';
import { NoResponseReplay } from '../../../common/idempotency/idempotency.interceptor.js';
import { ZBody, ZParam } from '../../../common/validation/zod.js';
import {
  ApiOperation,
  ApiResponse,
  ApiTag,
  Idempotent,
  RequiresIfMatch,
} from '../../../openapi/metadata.js';
import { AnyAuthenticated, RequirePermissions } from '../../authz/permissions.js';
import { SessionService } from '../session/session.service.js';

import {
  CreateIdpSchema,
  IdentityProviderDetailSchema,
  IssuedScimTokenSchema,
  RotateSpCredentialSchema,
  ScimTokenCreateSchema,
  ScimTokenSchema,
  UpdateIdpSchema,
  type CreateIdpInput,
  type UpdateIdpInput,
} from './idp-admin.dto.js';
import { IdpAdminService } from './idp-admin.service.js';
import {
  CreateServiceClientSchema,
  ServiceClientSchema,
  ServiceClientsService,
  ServiceClientWithSecretSchema,
  UpdateServiceClientSchema,
  type CreateServiceClientInput,
} from './service-clients.service.js';
import {
  SetUserRolesSchema,
  UserRoleAssignmentsSchema,
  UserRolesService,
} from './user-roles.service.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

export const SessionSummarySchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['sso', 'break_glass']),
    protocol: z.enum(['oidc', 'saml', 'local']),
    idpId: z.uuid().nullable(),
    app: z.string(),
    createdAt: z.string(),
    lastSeenAt: z.string(),
    expiresAt: z.string(),
    ip: z.string(),
    userAgent: z.string(),
    current: z.boolean(),
  })
  .meta({ id: 'SessionSummary' });
const SessionListSchema = z
  .object({ data: z.array(SessionSummarySchema) })
  .meta({ id: 'SessionList' });
const TerminatedSchema = z
  .object({ terminated: z.number().int() })
  .meta({ id: 'SessionsTerminated' });

const principalOf = (request: FastifyRequest) => {
  const principal = request.principal;
  if (principal?.type !== 'user') throw new UnauthenticatedError();
  return principal;
};

/** Admin API for identity: IdPs, SP credentials, SCIM tokens, service clients, sessions, roles. */
@ApiTag('identity')
@Controller('v1')
export class IdentityAdminController {
  constructor(
    @Inject(IdpAdminService) private readonly idps: IdpAdminService,
    @Inject(ServiceClientsService) private readonly clients: ServiceClientsService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(UserRolesService) private readonly roles: UserRolesService,
  ) {}

  // ─── Identity providers ──────────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Get an identity provider (config without secrets, URLs to register at the IdP)',
  })
  @ApiResponse(200, 'The identity provider', IdentityProviderDetailSchema, {
    etag: 'Current version',
  })
  @RequirePermissions('read:IdentityProvider')
  @Get('identity-providers/:id')
  async getIdp(
    @ZParam('id', UuidSchema) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const idp = await this.idps.get(id);
    setEtag(reply, idp.version);
    return idp;
  }

  @ApiOperation({ summary: 'Create an identity provider (OIDC or SAML)' })
  @ApiResponse(201, 'Created', IdentityProviderDetailSchema, {
    location: 'URL',
    etag: 'Current version',
  })
  @RequirePermissions('create:IdentityProvider')
  @Idempotent()
  @HttpCode(201)
  @Post('identity-providers')
  async createIdp(
    @ZBody(CreateIdpSchema) body: CreateIdpInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const idp = await this.idps.create(body);
    setEtag(reply, idp.version);
    void reply.header('location', `/v1/identity-providers/${idp.id}`);
    return idp;
  }

  @ApiOperation({ summary: 'Update an identity provider (disabling it ends its sessions)' })
  @ApiResponse(200, 'Updated', IdentityProviderDetailSchema, { etag: 'New version' })
  @RequirePermissions('update:IdentityProvider')
  @RequiresIfMatch()
  @Patch('identity-providers/:id')
  async updateIdp(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(UpdateIdpSchema) body: UpdateIdpInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const idp = await this.idps.update(id, expectedVersion(request), body);
    setEtag(reply, idp.version);
    return idp;
  }

  @ApiOperation({ summary: 'Delete an identity provider (revokes its SCIM tokens and sessions)' })
  @ApiResponse(204, 'Deleted')
  @RequirePermissions('delete:IdentityProvider')
  @RequiresIfMatch()
  @HttpCode(204)
  @Delete('identity-providers/:id')
  async deleteIdp(
    @ZParam('id', UuidSchema) id: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.idps.remove(id, expectedVersion(request));
  }

  @ApiOperation({
    summary: 'Create the next SAML SP signing/encryption credential (published in metadata)',
  })
  @ApiResponse(201, 'Updated identity provider', IdentityProviderDetailSchema)
  @RequirePermissions('update:IdentityProvider')
  @HttpCode(201)
  @Post('identity-providers/:id/sp-credentials')
  rotate(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(RotateSpCredentialSchema) body: { use: 'signing' | 'encryption' },
  ) {
    return this.idps.rotateSpCredential(id, body.use);
  }

  @ApiOperation({ summary: 'Promote the next SP credential to active (the old one is retired)' })
  @ApiResponse(200, 'Updated identity provider', IdentityProviderDetailSchema)
  @RequirePermissions('update:IdentityProvider')
  @HttpCode(200)
  @Post('identity-providers/:id/sp-credentials/:credentialId/promote')
  promote(
    @ZParam('id', UuidSchema) id: string,
    @ZParam('credentialId', UuidSchema) credentialId: string,
  ) {
    return this.idps.promoteSpCredential(id, credentialId);
  }

  @ApiOperation({ summary: 'Remove a retired or next SP credential' })
  @ApiResponse(200, 'Updated identity provider', IdentityProviderDetailSchema)
  @RequirePermissions('update:IdentityProvider')
  @Delete('identity-providers/:id/sp-credentials/:credentialId')
  removeCredential(
    @ZParam('id', UuidSchema) id: string,
    @ZParam('credentialId', UuidSchema) credentialId: string,
  ) {
    return this.idps.removeSpCredential(id, credentialId);
  }

  @ApiOperation({ summary: 'List SCIM tokens of an identity provider' })
  @ApiResponse(200, 'Tokens (no secrets)', z.array(ScimTokenSchema))
  @RequirePermissions('read:IdentityProvider')
  @Get('identity-providers/:id/scim-tokens')
  scimTokens(@ZParam('id', UuidSchema) id: string) {
    return this.idps.listScimTokens(id);
  }

  @ApiOperation({ summary: 'Issue a SCIM bearer token (shown once)' })
  @ApiResponse(201, 'Issued', IssuedScimTokenSchema)
  @RequirePermissions('update:IdentityProvider')
  @HttpCode(201)
  @NoResponseReplay()
  @Post('identity-providers/:id/scim-tokens')
  issueScimToken(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(ScimTokenCreateSchema) body: { expiresInDays?: number },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    void reply.header('cache-control', 'no-store');
    return this.idps.issueScimToken(id, body.expiresInDays);
  }

  @ApiOperation({ summary: 'Revoke a SCIM token' })
  @ApiResponse(204, 'Revoked')
  @RequirePermissions('update:IdentityProvider')
  @HttpCode(204)
  @Delete('identity-providers/:id/scim-tokens/:tokenId')
  async revokeScimToken(
    @ZParam('id', UuidSchema) id: string,
    @ZParam('tokenId', UuidSchema) tokenId: string,
  ): Promise<void> {
    await this.idps.revokeScimToken(id, tokenId);
  }

  // ─── Service clients (client credentials, mTLS) ──────────────────────────────

  @ApiOperation({ summary: 'List service clients' })
  @ApiResponse(200, 'Service clients', z.array(ServiceClientSchema))
  @RequirePermissions('read:ServiceClient')
  @Get('service-clients')
  listClients() {
    return this.clients.list();
  }

  @ApiOperation({ summary: 'Get a service client' })
  @ApiResponse(200, 'Service client', ServiceClientSchema, { etag: 'Current version' })
  @RequirePermissions('read:ServiceClient')
  @Get('service-clients/:id')
  async getClient(
    @ZParam('id', UuidSchema) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const client = await this.clients.get(id);
    setEtag(reply, client.version);
    return client;
  }

  @ApiOperation({ summary: 'Create a service client (the secret is shown once)' })
  @ApiResponse(201, 'Created', ServiceClientWithSecretSchema)
  @RequirePermissions('create:ServiceClient')
  @Idempotent()
  @HttpCode(201)
  @Post('service-clients')
  async createClient(
    @ZBody(CreateServiceClientSchema) body: CreateServiceClientInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const client = await this.clients.create(body);
    setEtag(reply, client.version);
    void reply
      .header('location', `/v1/service-clients/${client.id}`)
      .header('cache-control', 'no-store');
    return client;
  }

  @ApiOperation({ summary: 'Update a service client' })
  @ApiResponse(200, 'Updated', ServiceClientSchema, { etag: 'New version' })
  @RequirePermissions('update:ServiceClient')
  @RequiresIfMatch()
  @Patch('service-clients/:id')
  async updateClient(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(UpdateServiceClientSchema) body: z.output<typeof UpdateServiceClientSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const client = await this.clients.update(id, expectedVersion(request), body);
    setEtag(reply, client.version);
    return client;
  }

  @ApiOperation({ summary: 'Rotate a service client secret (shown once)' })
  @ApiResponse(200, 'Rotated', ServiceClientWithSecretSchema)
  @RequirePermissions('update:ServiceClient')
  @HttpCode(200)
  @Post('service-clients/:id/secret')
  rotateSecret(
    @ZParam('id', UuidSchema) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    void reply.header('cache-control', 'no-store');
    return this.clients.rotateSecret(id);
  }

  @ApiOperation({ summary: 'Delete a service client' })
  @ApiResponse(204, 'Deleted')
  @RequirePermissions('delete:ServiceClient')
  @RequiresIfMatch()
  @HttpCode(204)
  @Delete('service-clients/:id')
  async deleteClient(
    @ZParam('id', UuidSchema) id: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.clients.remove(id, expectedVersion(request));
  }

  // ─── Sessions ────────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'My active sessions' })
  @ApiResponse(200, 'Sessions', SessionListSchema)
  @AnyAuthenticated()
  @Get('me/sessions')
  async mySessions(@Req() request: FastifyRequest) {
    const principal = principalOf(request);
    const sessions = await this.sessions.list(principal.tenantId, principal.id);
    return { data: sessions.map((s) => ({ ...s, current: s.id === principal.sessionId })) };
  }

  @ApiOperation({ summary: 'End one of my sessions' })
  @ApiResponse(204, 'Ended')
  @AnyAuthenticated()
  @HttpCode(204)
  @Delete('me/sessions/:sessionId')
  async endMySession(
    @ZParam('sessionId', UuidSchema) sessionId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const principal = principalOf(request);
    await this.sessions.terminate(principal.tenantId, principal.id, sessionId, 'self');
  }

  @ApiOperation({ summary: 'End all my other sessions' })
  @ApiResponse(200, 'Ended', TerminatedSchema)
  @AnyAuthenticated()
  @HttpCode(200)
  @Delete('me/sessions')
  async endMyOtherSessions(@Req() request: FastifyRequest) {
    const principal = principalOf(request);
    return {
      terminated: await this.sessions.terminateAll(
        principal.tenantId,
        principal.id,
        'self',
        principal.sessionId,
      ),
    };
  }

  @ApiOperation({ summary: "List a user's active sessions" })
  @ApiResponse(200, 'Sessions', SessionListSchema)
  @RequirePermissions('read:User')
  @Get('users/:id/sessions')
  async userSessions(@ZParam('id', UuidSchema) id: string, @Req() request: FastifyRequest) {
    const tenantId = request.principal?.tenantId ?? '';
    const sessions = await this.sessions.list(tenantId, id);
    return {
      data: sessions.map((s) => ({ ...s, current: s.id === request.principal?.sessionId })),
    };
  }

  @ApiOperation({ summary: "End a user's session" })
  @ApiResponse(204, 'Ended')
  @RequirePermissions('update:User')
  @HttpCode(204)
  @Delete('users/:id/sessions/:sessionId')
  async endUserSession(
    @ZParam('id', UuidSchema) id: string,
    @ZParam('sessionId', UuidSchema) sessionId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.sessions.terminate(request.principal?.tenantId ?? '', id, sessionId, 'admin');
  }

  @ApiOperation({ summary: "End all of a user's sessions" })
  @ApiResponse(200, 'Ended', TerminatedSchema)
  @RequirePermissions('update:User')
  @HttpCode(200)
  @Delete('users/:id/sessions')
  async endUserSessions(@ZParam('id', UuidSchema) id: string, @Req() request: FastifyRequest) {
    return {
      terminated: await this.sessions.terminateAll(request.principal?.tenantId ?? '', id, 'admin'),
    };
  }

  // ─── Roles ───────────────────────────────────────────────────────────────────

  @ApiOperation({ summary: "A user's roles with their source (manual, claims:<idp>, scim:<idp>)" })
  @ApiResponse(200, 'Role assignments', UserRoleAssignmentsSchema)
  @RequirePermissions('read:User', 'read:Role')
  @Get('users/:id/roles')
  userRoles(@ZParam('id', UuidSchema) id: string) {
    return this.roles.get(id);
  }

  @ApiOperation({ summary: "Set a user's manually assigned roles (IdP/SCIM roles are unaffected)" })
  @ApiResponse(200, 'Role assignments', UserRoleAssignmentsSchema)
  @RequirePermissions('update:User', 'manage:Role')
  @Put('users/:id/roles')
  setUserRoles(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(SetUserRolesSchema) body: { roles: string[] },
  ) {
    return this.roles.setManual(id, body.roles);
  }
}
