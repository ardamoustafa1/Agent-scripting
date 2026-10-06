import { Module } from '@nestjs/common';

import { API_ENV } from '../../env.js';
import { AuditModule } from '../audit/audit.module.js';

import {
  IntegrationEngineService,
  INTEGRATION_VAULT,
  environmentVault,
} from './integration-engine.service.js';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationsRepository } from './integrations.repository.js';
import { IntegrationsService } from './integrations.service.js';
import { PrivateEgressController } from './private-egress.controller.js';
import { PrivateEgressService } from './private-egress.service.js';

@Module({
  imports: [AuditModule],
  controllers: [IntegrationsController, PrivateEgressController],
  providers: [
    PrivateEgressService,
    IntegrationsService,
    IntegrationsRepository,
    IntegrationEngineService,
    { provide: INTEGRATION_VAULT, inject: [API_ENV], useFactory: environmentVault },
  ],
  exports: [IntegrationEngineService, INTEGRATION_VAULT],
})
export class IntegrationsModule {}
