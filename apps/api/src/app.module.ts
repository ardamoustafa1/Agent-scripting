import { type DynamicModule, Module, type Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { ProblemDetailsFilter } from './common/errors/problem.filter.js';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor.js';
import { AuthenticationGuard } from './common/security/authentication.guard.js';
import { HealthController } from './health/health.controller.js';
import { TenantTransactionInterceptor } from './infra/database/tenant-transaction.interceptor.js';
import { InfraModule } from './infra/infra.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AiModule } from './modules/ai/ai.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { AssignmentsModule } from './modules/assignments/assignments.module.js';
import {
  AuditFailureInterceptor,
  AuditTrailInterceptor,
} from './modules/audit/audit.interceptors.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AccessGuard } from './modules/authz/access.guard.js';
import { AuthzModule } from './modules/authz/authz.module.js';
import { CampaignsModule } from './modules/campaigns/campaigns.module.js';
import { ComplianceModule } from './modules/compliance/compliance.module.js';
import { ConnectorsModule } from './modules/connectors/connectors.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { LaunchModule } from './modules/launch/launch.module.js';
import { RoutingModule } from './modules/routing/routing.module.js';
import { RuntimeModule } from './modules/runtime/runtime.module.js';
import { ScreensModule } from './modules/screens/screens.module.js';
import { ScriptsModule } from './modules/scripts/scripts.module.js';
import { TenancyModule } from './modules/tenancy/tenancy.module.js';

import type { ApiEnv } from './env.js';

/** Bounded-context modules (ADR-0009: modular monolith, extracted later). */
export const FEATURE_MODULES: readonly Type[] = [
  AiModule,
  TenancyModule,
  IdentityModule,
  AuthzModule,
  AuditModule,
  CampaignsModule,
  ScriptsModule,
  ScreensModule,
  AssignmentsModule,
  RoutingModule,
  IntegrationsModule,
  RuntimeModule,
  LaunchModule,
  ConnectorsModule,
  AnalyticsModule,
  ComplianceModule,
  AdminModule,
];

/** Every controller, in a stable order (OpenAPI generation, route catalogue tests). */
export function allControllers(): Type[] {
  const fromModules = FEATURE_MODULES.flatMap(
    (module) => (Reflect.getMetadata('controllers', module) as Type[] | undefined) ?? [],
  );
  return [HealthController, ...fromModules];
}

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [InfraModule.forRoot(env), ...FEATURE_MODULES],
      controllers: [HealthController],
      providers: [
        // Order matters: authentication → tenant/permissions. Interceptors, outermost first:
        // failure audit (after rollback) → transaction → idempotency → audit trail (in the tx).
        { provide: APP_GUARD, useClass: AuthenticationGuard },
        { provide: APP_GUARD, useExisting: AccessGuard },
        { provide: APP_INTERCEPTOR, useExisting: AuditFailureInterceptor },
        { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: APP_INTERCEPTOR, useExisting: AuditTrailInterceptor },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
