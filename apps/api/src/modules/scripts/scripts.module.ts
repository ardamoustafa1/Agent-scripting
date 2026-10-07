import { Module } from '@nestjs/common';

import { type ApiEnv, API_ENV } from '../../env.js';
import { AuditModule } from '../audit/audit.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { LaunchRealtime } from '../launch/launch-realtime.js';

import {
  PackagesController,
  SharedScreensController,
  TemplatesController,
} from './authoring.controller.js';
import { CollaborationController } from './collaboration.controller.js';
import { CollaborationService } from './collaboration.service.js';
import { PackageKeys } from './domain/package-format.js';
import { DraftLeaseService } from './draft-lease.service.js';
import { PACKAGE_KEYS, PackagesService } from './packages.service.js';
import { PreviewService } from './preview.service.js';
import { ReleaseJobsService } from './release-jobs.service.js';
import { ScriptsController } from './scripts.controller.js';
import { ScriptsRepository } from './scripts.repository.js';
import { ScriptsService } from './scripts.service.js';
import { SharedScreensService } from './shared-screens.service.js';
import { SuggestionsService } from './suggestions.service.js';
import { TeamController } from './team.controller.js';
import { TeamService } from './team.service.js';
import { TemplatesService } from './templates.service.js';
import { VersionLifecycleService } from './version-lifecycle.service.js';

@Module({
  imports: [AuditModule, IntegrationsModule, IdentityModule],
  controllers: [
    ScriptsController,
    TeamController,
    CollaborationController,
    SharedScreensController,
    TemplatesController,
    PackagesController,
  ],
  providers: [
    PreviewService,
    TeamService,
    SuggestionsService,
    CollaborationService,
    DraftLeaseService,
    LaunchRealtime,
    ReleaseJobsService,
    ScriptsService,
    ScriptsRepository,
    VersionLifecycleService,
    SharedScreensService,
    TemplatesService,
    PackagesService,
    {
      provide: PACKAGE_KEYS,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) =>
        PackageKeys.from(env.PACKAGE_SIGNING_JWK, env.PACKAGE_TRUSTED_JWKS),
    },
  ],
  exports: [ScriptsService, SharedScreensService, CollaborationService],
})
export class ScriptsModule {}
