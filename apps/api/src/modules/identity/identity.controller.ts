import { Controller, Get, Inject } from '@nestjs/common';

import { UuidSchema } from '../../common/dto.js';
import { ZParam, ZQuery } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { RequirePermissions } from '../authz/permissions.js';

import {
  IdentityProviderPageSchema,
  IdpListQuerySchema,
  RoleListQuerySchema,
  RolePageSchema,
  UserListQuerySchema,
  UserPageSchema,
  UserSchema,
  type IdpListQuery,
  type RoleListQuery,
  type UserListQuery,
} from './identity.dto.js';
import { IdentityService } from './identity.service.js';

@ApiTag('identity')
@Controller('v1')
export class IdentityController {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}

  @ApiOperation({ summary: 'List users (PII; access is audited)' })
  @ApiResponse(200, 'A page of users', UserPageSchema)
  @RequirePermissions('read:User')
  @Get('users')
  listUsers(@ZQuery(UserListQuerySchema) query: UserListQuery) {
    return this.identity.listUsers(query);
  }

  @ApiOperation({ summary: 'Get a user (PII; access is audited)' })
  @ApiResponse(200, 'The user', UserSchema)
  @RequirePermissions('read:User')
  @Get('users/:id')
  getUser(@ZParam('id', UuidSchema) id: string) {
    return this.identity.getUser(id);
  }

  @ApiOperation({ summary: 'List roles' })
  @ApiResponse(200, 'A page of roles', RolePageSchema)
  @RequirePermissions('read:Role')
  @Get('roles')
  listRoles(@ZQuery(RoleListQuerySchema) query: RoleListQuery) {
    return this.identity.listRoles(query);
  }

  @ApiOperation({ summary: 'List identity providers' })
  @ApiResponse(200, 'A page of identity providers', IdentityProviderPageSchema)
  @RequirePermissions('read:IdentityProvider')
  @Get('identity-providers')
  listIdps(@ZQuery(IdpListQuerySchema) query: IdpListQuery) {
    return this.identity.listIdps(query);
  }
}
