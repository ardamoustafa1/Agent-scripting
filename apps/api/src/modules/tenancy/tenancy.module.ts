import { Global, Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';

import { LocationsController } from './locations/locations.controller.js';
import { LocationsService } from './locations/locations.service.js';
import { OnboardingService } from './onboarding.service.js';
import { TenancyController } from './tenancy.controller.js';
import { TenancyRepository } from './tenancy.repository.js';
import { TenancyService } from './tenancy.service.js';

@Global()
@Module({
  imports: [AuditModule],
  controllers: [TenancyController, LocationsController],
  providers: [TenancyService, TenancyRepository, LocationsService, OnboardingService],
  exports: [TenancyRepository],
})
export class TenancyModule {}
