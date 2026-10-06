import { Global, Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';

import { TenancyController } from './tenancy.controller.js';
import { TenancyRepository } from './tenancy.repository.js';
import { TenancyService } from './tenancy.service.js';

@Global()
@Module({
  imports: [AuditModule],
  controllers: [TenancyController],
  providers: [TenancyService, TenancyRepository],
  exports: [TenancyRepository],
})
export class TenancyModule {}
