import { Module } from '@nestjs/common';

import { AnalyticsModule } from '../analytics/analytics.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ConnectorsModule } from '../connectors/connectors.module.js';
import { RuntimeModule } from '../runtime/runtime.module.js';

import { AdminController } from './admin.controller.js';
import { AdminRepository } from './admin.repository.js';
import { AdminService } from './admin.service.js';
import { AdminPrivacyService } from './privacy.service.js';
import { AdminWorkspaceController } from './workspace.controller.js';
import { AdminWorkspaceService } from './workspace.service.js';

@Module({
  imports: [AnalyticsModule, AuditModule, RuntimeModule, ConnectorsModule],
  controllers: [AdminController, AdminWorkspaceController],
  providers: [AdminService, AdminRepository, AdminWorkspaceService, AdminPrivacyService],
})
export class AdminModule {}
