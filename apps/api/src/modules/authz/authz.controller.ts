import { Controller, Get, HttpCode, Inject, Post, Put, Req, Res } from '@nestjs/common';

import type { CustomRole } from '@verbis/authz';

import { UuidSchema } from '../../common/dto.js';
import { expectedVersion, setEtag } from '../../common/http/if-match.js';
import { ZBody, ZParam } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag, RequiresIfMatch } from '../../openapi/metadata.js';

import {
  CreateRoleSchema,
  MePermissionsSchema,
  MeSchema,
  PermissionVocabularySchema,
  RoleSchema,
  RoleScopeAssignmentSchema,
  UpdateRoleSchema,
  type MeDto,
  type MePermissionsDto,
  type RoleDto,
  type RoleScopeAssignment,
} from './authz.dto.js';
import { AuthzService } from './authz.service.js';
import { AnyAuthenticated, Can } from './permissions.js';
import { RolesService } from './roles.service.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

@ApiTag('authz')
@Controller('v1/authz')
export class AuthzController {
  constructor(
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(RolesService) private readonly roles: RolesService,
  ) {}

  @ApiOperation({ summary: 'The caller and its effective permissions' })
  @ApiResponse(200, 'Principal and permissions', MeSchema)
  @AnyAuthenticated()
  @Get('me')
  me(): MeDto {
    return this.authz.me();
  }

  @ApiOperation({ summary: 'Resources, actions, scopes and system roles of the permission matrix' })
  @ApiResponse(200, 'Vocabulary', PermissionVocabularySchema)
  @Can('read', 'Role')
  @Get('vocabulary')
  vocabulary() {
    return this.roles.vocabulary();
  }

  @ApiOperation({ summary: 'List roles with their permission matrix' })
  @ApiResponse(200, 'Roles', RoleSchema)
  @Can('read', 'Role')
  @Get('roles')
  list(): Promise<RoleDto[]> {
    return this.roles.list();
  }

  @ApiOperation({
    summary: 'Create a custom role from a permission matrix (no privilege escalation)',
  })
  @ApiResponse(201, 'Created', RoleSchema, { etag: 'Current version' })
  @Can('create', 'Role')
  @HttpCode(201)
  @Post('roles')
  async create(
    @ZBody(CreateRoleSchema) body: CustomRole,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<RoleDto> {
    const role = await this.roles.create(body);
    setEtag(reply, role.version);
    return role;
  }

  @ApiOperation({ summary: 'Replace the permission matrix of a custom role' })
  @ApiResponse(200, 'Updated', RoleSchema, { etag: 'New version' })
  @Can('update', 'Role')
  @RequiresIfMatch()
  @Put('roles/:id')
  async update(
    @ZParam('id', UuidSchema) id: string,
    @ZBody(UpdateRoleSchema) body: Omit<CustomRole, 'name'>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<RoleDto> {
    const role = await this.roles.update(id, expectedVersion(request), body);
    setEtag(reply, role.version);
    return role;
  }

  @ApiOperation({ summary: "Set the campaign/team/site scope of a user's role assignment (ABAC)" })
  @ApiResponse(200, 'Scope set', RoleScopeAssignmentSchema)
  @Can('update', 'User')
  @Can('update', 'Role')
  @Put('users/:userId/role-scope')
  setScope(
    @ZParam('userId', UuidSchema) userId: string,
    @ZBody(RoleScopeAssignmentSchema) body: RoleScopeAssignment,
  ) {
    return this.roles.setScope(userId, body);
  }
}

/** `/v1/me/permissions`: serialized CASL rules for UI gating (`@verbis/authz/react`). */
@ApiTag('authz')
@Controller('v1/me')
export class MePermissionsController {
  constructor(@Inject(AuthzService) private readonly authz: AuthzService) {}

  @ApiOperation({ summary: "The caller's CASL rules (packed), resolved for its scope and SoD" })
  @ApiResponse(200, 'Packed rules', MePermissionsSchema)
  @AnyAuthenticated()
  @Get('permissions')
  permissions(): MePermissionsDto {
    return this.authz.mePermissions();
  }
}
