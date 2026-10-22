import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';

import { AgentDesktopController } from './agent-desktop.controller.js';
import { AgentFeedbackService } from './agent-feedback.service.js';
import { RuntimeCipher } from './runtime-cipher.js';
import {
  RuntimeCommandsController,
  RuntimeSupervisorController,
} from './runtime-commands.controller.js';
import { RuntimeDataService } from './runtime-data.service.js';
import { RuntimeEngineService } from './runtime-engine.service.js';
import { RuntimeEventsHandler } from './runtime-events.handler.js';
import { RuntimeInteractionsHandler } from './runtime-interactions.handler.js';
import { RuntimeJobsService } from './runtime-jobs.service.js';
import { RuntimePorts } from './runtime-ports.js';
import { RuntimeRealtimeService } from './runtime-realtime.service.js';
import { RuntimeStateStore } from './runtime-state.store.js';
import { RuntimeController } from './runtime.controller.js';
import { RuntimeGateway } from './runtime.gateway.js';
import { RuntimeRepository } from './runtime.repository.js';
import { RuntimeService } from './runtime.service.js';
import { SecureCaptureService } from './secure-capture.service.js';
import { TranscriptService } from './transcript.service.js';
import { TranscriptStore } from './transcript.store.js';

@Module({
  imports: [AuditModule, IdentityModule, IntegrationsModule],
  controllers: [
    AgentDesktopController,
    RuntimeController,
    RuntimeCommandsController,
    RuntimeSupervisorController,
  ],
  providers: [
    RuntimeDataService,
    RuntimeCipher,
    RuntimeService,
    RuntimeRepository,
    RuntimeEngineService,
    RuntimeStateStore,
    RuntimeRealtimeService,
    RuntimeGateway,
    RuntimeJobsService,
    RuntimeEventsHandler,
    RuntimeInteractionsHandler,
    RuntimePorts,
    SecureCaptureService,
    AgentFeedbackService,
    TranscriptStore,
    TranscriptService,
  ],
  exports: [
    RuntimeStateStore,
    RuntimeEngineService,
    RuntimePorts,
    RuntimeCipher,
    RuntimeInteractionsHandler,
    TranscriptService,
    TranscriptStore,
  ],
})
export class RuntimeModule {}
