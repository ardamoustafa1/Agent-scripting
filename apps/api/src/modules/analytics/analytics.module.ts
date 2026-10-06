import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { IdentityModule } from '../identity/identity.module.js';

import { AnalyticsEventCounter } from './analytics.consumer.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsRepository } from './analytics.repository.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsODataController } from './odata.controller.js';
import { AnalyticsReportConsumer, AnalyticsReportScheduler } from './reports.js';
import { AnalyticsSessionConsumer, AnalyticsDataSourceConsumer } from './session.consumer.js';
import { AnalyticsStore } from './storage.js';

@Module({
  imports: [IdentityModule, AuditModule],
  controllers: [AnalyticsController, AnalyticsODataController],
  exports: [AnalyticsStore],
  providers: [
    AnalyticsService,
    AnalyticsRepository,
    AnalyticsEventCounter,
    AnalyticsStore,
    AnalyticsSessionConsumer,
    AnalyticsDataSourceConsumer,
    AnalyticsReportConsumer,
    AnalyticsReportScheduler,
  ],
})
export class AnalyticsModule {}
