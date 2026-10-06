import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { RoutingModule } from '../routing/routing.module.js';

import { AssignmentsController } from './assignments.controller.js';
import { AssignmentsRepository } from './assignments.repository.js';
import { AssignmentsService } from './assignments.service.js';

@Module({
  imports: [AuditModule, RoutingModule],
  controllers: [AssignmentsController],
  providers: [AssignmentsService, AssignmentsRepository],
})
export class AssignmentsModule {}
