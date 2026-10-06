import { Module } from '@nestjs/common';

import { type ApiEnv, API_ENV } from '../../env.js';
import { RedisService } from '../../infra/redis/redis.service.js';
import { AuditModule } from '../audit/audit.module.js';

import { IdentityAdminController } from './admin/identity-admin.controller.js';
import { IdpAdminService } from './admin/idp-admin.service.js';
import { ServiceClientsService } from './admin/service-clients.service.js';
import { UserRolesService } from './admin/user-roles.service.js';
import { BreakGlassController } from './break-glass/break-glass.controller.js';
import { BreakGlassService } from './break-glass/break-glass.service.js';
import { AppOrigins } from './core/app-origins.js';
import { IdentitySecrets } from './core/identity-secrets.js';
import { IdentityTx } from './core/identity-tx.js';
import {
  APP_ORIGINS,
  IDENTITY_CLOCK,
  IDENTITY_KEYRING,
  IDP_FETCH,
  SESSION_STORE,
} from './core/identity.tokens.js';
import { TenantResolver } from './core/tenant-resolver.js';
import { Keyring } from './crypto/keyring.js';
import { createIdpFetch } from './egress/idp-fetch.js';
import { IdentityController } from './identity.controller.js';
import { IdentityRepository } from './identity.repository.js';
import { IdentityService } from './identity.service.js';
import { IdpRepository } from './idp/idp.repository.js';
import { AuthController } from './login/auth.controller.js';
import { BrowserResponder } from './login/browser-responder.js';
import { LoginFlowService } from './login/login-flow.service.js';
import { LoginTransactions } from './login/login-transaction.js';
import { LoginService } from './login/login.service.js';
import { RoleSync } from './login/role-sync.js';
import { OidcService } from './oidc/oidc.service.js';
import { SamlController } from './saml/saml.controller.js';
import { SamlService } from './saml/saml.service.js';
import { ScimBulkService } from './scim/scim-bulk.js';
import { ScimAuthenticator } from './scim/scim.authenticator.js';
import { ScimController } from './scim/scim.controller.js';
import { ScimService } from './scim/scim.service.js';
import { ClientCredentialsService } from './service-auth/client-credentials.service.js';
import { OAuth2Controller } from './service-auth/oauth2.controller.js';
import { IdentityAuthenticator } from './session/identity-authenticator.js';
import { OidcSessionRefresher } from './session/oidc-session-refresher.js';
import { SessionStore } from './session/session-store.js';
import { SessionService } from './session/session.service.js';

import type { Clock } from './core/identity.tokens.js';

/**
 * Identity & access (ADR-0004, ADR-0012): BFF sessions, OIDC and SAML SSO with home-realm
 * discovery and JIT provisioning, SCIM 2.0, break-glass admin, service clients (client
 * credentials, mTLS) and the read APIs for users, roles and IdPs.
 */
@Module({
  imports: [AuditModule],
  controllers: [
    IdentityController,
    IdentityAdminController,
    AuthController,
    SamlController,
    BreakGlassController,
    OAuth2Controller,
    ScimController,
  ],
  providers: [
    IdentityService,
    IdentityRepository,
    { provide: IDENTITY_CLOCK, useValue: (() => Date.now()) satisfies Clock },
    {
      provide: IDENTITY_KEYRING,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => new Keyring(env.IDENTITY_ENCRYPTION_KEYS),
    },
    {
      provide: IDP_FETCH,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) =>
        createIdpFetch({
          allowHttpHosts: env.IDENTITY_EGRESS_ALLOW_HTTP_HOSTS,
          allowPrivateHosts: env.IDENTITY_EGRESS_ALLOW_PRIVATE_HOSTS,
        }),
    },
    {
      provide: APP_ORIGINS,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) =>
        new AppOrigins(env.AUTH_APP_ORIGINS, env.AUTH_PUBLIC_PATH_PREFIX),
    },
    {
      provide: SESSION_STORE,
      inject: [RedisService, IDENTITY_KEYRING, IDENTITY_CLOCK],
      useFactory: (redis: RedisService, keyring: Keyring, clock: Clock) =>
        new SessionStore(redis.client, keyring, clock),
    },
    {
      provide: LoginTransactions,
      inject: [RedisService, IDENTITY_KEYRING],
      useFactory: (redis: RedisService, keyring: Keyring) =>
        new LoginTransactions(redis.client, keyring),
    },
    TenantResolver,
    IdentityTx,
    IdentitySecrets,
    IdpRepository,
    RoleSync,
    LoginService,
    SessionService,
    OidcService,
    SamlService,
    OidcSessionRefresher,
    ScimAuthenticator,
    IdentityAuthenticator,
    BrowserResponder,
    LoginFlowService,
    ScimService,
    ScimBulkService,
    BreakGlassService,
    ClientCredentialsService,
    IdpAdminService,
    ServiceClientsService,
    UserRolesService,
  ],
  exports: [IdentityAuthenticator, SESSION_STORE, IDENTITY_KEYRING, TenantResolver],
})
export class IdentityModule {}
