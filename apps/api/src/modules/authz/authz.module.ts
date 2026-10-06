import { Global, Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';

import { AbilityFactory } from './ability.factory.js';
import { AccessGuard } from './access.guard.js';
import { AuthzController, MePermissionsController } from './authz.controller.js';
import { AuthzRepository } from './authz.repository.js';
import { AuthzService } from './authz.service.js';
import { RolesService } from './roles.service.js';

@Global()
@Module({
  imports: [AuditModule],
  controllers: [AuthzController, MePermissionsController],
  providers: [AuthzService, AuthzRepository, AbilityFactory, AccessGuard, RolesService],
  exports: [AccessGuard, AuthzRepository, AbilityFactory, AuthzService],
})
export class AuthzModule {}
