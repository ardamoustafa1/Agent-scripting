import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { RoutingModule } from '../routing/routing.module.js';
import { RuntimeModule } from '../runtime/runtime.module.js';

import { EmbeddingController } from './embedding.controller.js';
import { LaunchAttempts } from './launch-attempts.js';
import { LaunchEventsHandler } from './launch-events.handler.js';
import { LaunchPorts } from './launch-ports.js';
import { LaunchRealtime } from './launch-realtime.js';
import { LaunchReplayGuard } from './launch-replay.js';
import { LaunchController } from './launch.controller.js';
import { LaunchGateway } from './launch.gateway.js';
import { LaunchService } from './launch.service.js';

/** Secure launch (SECURITY §4, ADR-0017): the only way a runtime session comes into existence. */
@Module({
  imports: [AuditModule, IdentityModule, RoutingModule, RuntimeModule],
  controllers: [LaunchController, EmbeddingController],
  providers: [
    LaunchService,
    LaunchPorts,
    LaunchAttempts,
    LaunchReplayGuard,
    LaunchRealtime,
    LaunchGateway,
    LaunchEventsHandler,
  ],
  exports: [LaunchPorts],
})
export class LaunchModule {}
