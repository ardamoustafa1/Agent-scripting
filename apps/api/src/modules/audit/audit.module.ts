import { Module } from '@nestjs/common';

import { type ApiEnv, API_ENV } from '../../env.js';

import { AuditQueryService, CHECKPOINT_VERIFIER } from './audit-query.service.js';
import { AuditController } from './audit.controller.js';
import { AuditFailureInterceptor, AuditTrailInterceptor } from './audit.interceptors.js';
import { AuditRepository } from './audit.repository.js';
import { AuditService } from './audit.service.js';
import { CheckpointVerifier } from './core/checkpoint-signer.js';
import { SecurityReportsController } from './security-reports.controller.js';
import { SessionEventWriter } from './session-events/session-event.writer.js';
import { SiemDestinationsController } from './siem/siem-destinations.controller.js';
import { SiemDestinationsService } from './siem/siem-destinations.service.js';

@Module({
  controllers: [AuditController, SiemDestinationsController, SecurityReportsController],
  providers: [
    AuditService,
    AuditRepository,
    AuditQueryService,
    SessionEventWriter,
    SiemDestinationsService,
    AuditTrailInterceptor,
    AuditFailureInterceptor,
    {
      provide: CHECKPOINT_VERIFIER,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) =>
        env.AUDIT_CHECKPOINT_JWKS === undefined
          ? undefined
          : CheckpointVerifier.fromJwks(env.AUDIT_CHECKPOINT_JWKS),
    },
  ],
  exports: [
    AuditService,
    AuditRepository,
    SessionEventWriter,
    AuditTrailInterceptor,
    AuditFailureInterceptor,
  ],
})
export class AuditModule {}
