import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';

import { ResolverCacheInvalidator } from './resolver-cache.invalidator.js';
import { ResolverCache } from './resolver.cache.js';
import { ResolverService } from './resolver.service.js';
import { RoutingController } from './routing.controller.js';
import { SnapshotRepository } from './snapshot.repository.js';

@Module({
  imports: [AuditModule],
  controllers: [RoutingController],
  providers: [ResolverService, ResolverCache, SnapshotRepository, ResolverCacheInvalidator],
  exports: [ResolverService, SnapshotRepository, ResolverCache],
})
export class RoutingModule {}
