import { Module } from '@nestjs/common';

import { AnalyticsModule } from '../analytics/analytics.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { RoutingModule } from '../routing/routing.module.js';

import { AssignmentsController } from './assignments.controller.js';
import { AssignmentsRepository } from './assignments.repository.js';
import { AssignmentsService } from './assignments.service.js';
import { RolloutGuard, RolloutService } from './rollout.service.js';

@Module({
  imports: [AuditModule, RoutingModule, AnalyticsModule],
  controllers: [AssignmentsController],
  providers: [AssignmentsService, AssignmentsRepository, RolloutService, RolloutGuard],
})
export class AssignmentsModule {}
