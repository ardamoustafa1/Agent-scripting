type DesignerJson =
  string | number | boolean | null | DesignerJson[] | { [key: string]: DesignerJson };
export interface paths {
  '/auth/break-glass/login': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Break-glass sign-in (password + TOTP), accepted only from admin-web; every attempt is a critical audit event */
    post: operations['BreakGlass.login'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/discover': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Home-realm discovery by email domain or tenant slug */
    post: operations['Auth.discover'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/login': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Start SSO: redirects to the identity provider (Authorization Code + PKCE or SAML AuthnRequest) */
    get: operations['Auth.login'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/logout': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Sign out (RP-initiated logout); returns the IdP logout URL to navigate to */
    post: operations['Auth.logout'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/oidc/{tenant}/{idp}/backchannel-logout': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** OIDC Back-Channel Logout 1.0 endpoint (logout_token) */
    post: operations['Auth.backchannelLogout'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/oidc/{tenant}/{idp}/frontchannel-logout': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** OIDC Front-Channel Logout 1.0 endpoint (iss, sid), framed by the IdP */
    get: operations['Auth.frontchannelLogout'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/oidc/callback': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** OIDC redirect URI (authorization response) */
    get: operations['Auth.oidcCallback'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/saml/{tenant}/{idp}/acs': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Assertion Consumer Service (HTTP-POST binding) */
    post: operations['Saml.acs'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/saml/{tenant}/{idp}/metadata': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** SAML SP metadata (active and next certificates) */
    get: operations['Saml.metadata'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/saml/{tenant}/{idp}/slo': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Single Logout (HTTP-Redirect binding) */
    get: operations['Saml.sloRedirect'];
    put?: never;
    /** Single Logout (HTTP-POST binding) */
    post: operations['Saml.sloPost'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/session': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Current BFF session (and its CSRF token) */
    get: operations['Auth.session'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/health': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Health summary */
    get: operations['Health.health'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/health/live': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Liveness probe */
    get: operations['Health.live'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/health/ready': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Readiness probe (database, Redis, NATS) */
    get: operations['Health.ready'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/oauth2/{tenant}/token': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Client-credentials grant (client_secret_basic, client_secret_post or tls_client_auth) */
    post: operations['OAuth2.token'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/scim/v2/{tenant}/Bulk': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Process bounded SCIM bulk operations with partial failure results
     * @description Requires: manage:User, manage:Group
     */
    post: operations['Scim.bulk'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/scim/v2/{tenant}/Groups': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List or filter groups
     * @description Requires: manage:Group
     */
    get: operations['Scim.listGroups'];
    put?: never;
    /**
     * Create a group
     * @description Requires: manage:Group
     */
    post: operations['Scim.createGroup'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/scim/v2/{tenant}/Groups/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get a group
     * @description Requires: manage:Group
     */
    get: operations['Scim.getGroup'];
    /**
     * Replace a group
     * @description Requires: manage:Group
     */
    put: operations['Scim.replaceGroup'];
    post?: never;
    /**
     * Delete a group
     * @description Requires: manage:Group
     */
    delete: operations['Scim.deleteGroup'];
    options?: never;
    head?: never;
    /**
     * Patch a group (members add/remove/replace)
     * @description Requires: manage:Group
     */
    patch: operations['Scim.patchGroup'];
    trace?: never;
  };
  '/scim/v2/{tenant}/ResourceTypes': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * SCIM resource types
     * @description Requires: read:User
     */
    get: operations['Scim.resourceTypes'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/scim/v2/{tenant}/ServiceProviderConfig': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * SCIM service provider configuration
     * @description Requires: read:User
     */
    get: operations['Scim.config'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/scim/v2/{tenant}/Users': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List or filter users (RFC 7644 §3.4.2)
     * @description Requires: manage:User
     */
    get: operations['Scim.listUsers'];
    put?: never;
    /**
     * Provision a user
     * @description Requires: manage:User
     */
    post: operations['Scim.createUser'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/scim/v2/{tenant}/Users/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get a user
     * @description Requires: manage:User
     */
    get: operations['Scim.getUser'];
    /**
     * Replace a user
     * @description Requires: manage:User
     */
    put: operations['Scim.replaceUser'];
    post?: never;
    /**
     * Deprovision a user (revokes sessions)
     * @description Requires: manage:User
     */
    delete: operations['Scim.deleteUser'];
    options?: never;
    head?: never;
    /**
     * Patch a user (active=false revokes sessions)
     * @description Requires: manage:User
     */
    patch: operations['Scim.patchUser'];
    trace?: never;
  };
  '/v1/admin/connectors': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Configure connector with vault references
     * @description Requires: manage:Connector
     */
    post: operations['AdminWorkspace.createConnector'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/connectors/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Connector configuration with references, no credentials
     * @description Requires: manage:Connector
     */
    get: operations['AdminWorkspace.connector'];
    /**
     * Replace connector config, fenced by version
     * @description Requires: manage:Connector
     */
    put: operations['AdminWorkspace.updateConnector'];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/connectors/{id}/test': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Probe actual connector supervisor state
     * @description Requires: manage:Connector
     */
    post: operations['AdminWorkspace.test'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/identity-providers/{id}/test': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Probe OIDC discovery or SAML endpoint reachability (not an authenticated SSO round trip)
     * @description Requires: manage:IdentityProvider
     */
    post: operations['AdminWorkspace.testIdentity'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/identity/discovery': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * SSRF-protected OIDC discovery preview
     * @description Requires: manage:IdentityProvider
     */
    post: operations['AdminWorkspace.discovery'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/identity/saml-import': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Import bounded, entity-free SAML metadata
     * @description Requires: manage:IdentityProvider
     */
    post: operations['AdminWorkspace.saml'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/launch-issuers': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Public launch JWKS registry
     * @description Requires: manage:Tenant
     */
    get: operations['AdminWorkspace.issuers'];
    put?: never;
    /**
     * Register public launch signing keys
     * @description Requires: manage:Tenant
     */
    post: operations['AdminWorkspace.createIssuer'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/launch-issuers/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    /**
     * Rotate public JWKS with overlapping kids
     * @description Requires: manage:Tenant
     */
    put: operations['AdminWorkspace.issuer'];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/operations': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Actual integration failure ratio over the last 24 hours
     * @description Requires: read:AuditEvent
     */
    get: operations['AdminWorkspace.operations'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/outbox': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Outbox status of the caller's tenant
     * @description Requires: manage:Outbox
     */
    get: operations['Admin.outbox'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/outbox/{id}/requeue': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Requeue a dead-lettered outbox event
     * @description Requires: manage:Outbox
     */
    post: operations['Admin.requeue'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/privacy-requests': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Data subject requests without subject values
     * @description Requires: manage:Tenant
     */
    get: operations['AdminWorkspace.privacyList'];
    put?: never;
    /**
     * Register verified data subject request; encrypted subject
     * @description Requires: manage:Tenant
     */
    post: operations['AdminWorkspace.privacyCreate'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/privacy-requests/{id}/export': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Audited bounded data subject export; no PCI or audit rewrites
     * @description Requires: manage:Tenant
     */
    get: operations['AdminWorkspace.export'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/privacy-requests/{id}/process': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Process bounded tenant request; legal hold and active session guards
     * @description Requires: manage:Tenant
     */
    post: operations['AdminWorkspace.process'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/secrets/{id}/usage': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Integration references to secret metadata, without values
     * @description Requires: read:Secret, read:DataSource
     */
    get: operations['AdminWorkspace.secretUsage'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/tenants': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Platform SuperAdmin tenant registry
     * @description Requires: manage:Tenant
     */
    get: operations['AdminWorkspace.tenants'];
    put?: never;
    /**
     * Create tenant and bootstrap system roles; platform-only
     * @description Requires: manage:Tenant
     */
    post: operations['AdminWorkspace.createTenant'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/tenants/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    /**
     * Set tenant state, quotas and features; platform-only
     * @description Requires: manage:Tenant
     */
    put: operations['AdminWorkspace.updateTenant'];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/users/{id}/connector-mapping': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    /**
     * Map verified tenant user to platform identity
     * @description Requires: manage:Connector, update:User
     */
    put: operations['AdminWorkspace.mapping'];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/ai/reconcile': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Release stale concurrency slots without refunding unknown provider spend
     * @description Requires: manage:Tenant
     */
    post: operations['Ai.reconcile'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/ai/settings': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * AI provider/residency and secret references; never secret values
     * @description Requires: manage:Tenant
     */
    get: operations['Ai.settings'];
    /**
     * Audited tenant AI configuration with optimistic version fencing
     * @description Requires: manage:Tenant
     */
    put: operations['Ai.save'];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/ai/status': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Tenant AI availability; disabled by default */
    get: operations['Ai.status'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/ai/suggestions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Locally redacted, quota-reserved AI suggestion; SSO and instance permission required; no automatic application */
    post: operations['Ai.generate'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/ai/usage': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Tenant monthly AI usage including in-flight reservations
     * @description Requires: manage:Tenant
     */
    get: operations['Ai.usage'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/analytics/dashboard': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Scoped PII-free session metrics; event-time cohort, no sampling
     * @description Requires: read:Report
     */
    get: operations['Analytics.dashboard'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/analytics/event-counts': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Domain event counts per day (fed by the event consumer)
     * @description Requires: read:Analytics
     */
    get: operations['Analytics.eventCounts'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/analytics/export/{format}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Audited CSV/XLSX report export
     * @description Requires: export:Report
     */
    get: operations['Analytics.export'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/analytics/odata': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * OData service document
     * @description Requires: export:Report
     */
    get: operations['AnalyticsOData.service'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/analytics/odata/$metadata': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * OData v4 metadata for the read-only Scripts entity set
     * @description Requires: export:Report
     */
    get: operations['AnalyticsOData.metadata'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/analytics/odata/Scripts': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Bounded OData-shaped BI feed ($top/$skip/$count/$select); tenant ABAC applied
     * @description Requires: export:Report
     */
    get: operations['AnalyticsOData.scripts'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/analytics/schedules': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List own scheduled reports
     * @description Requires: manage:Report
     */
    get: operations['Analytics.schedules'];
    put?: never;
    /**
     * Create audited scheduled report
     * @description Requires: manage:Report
     */
    post: operations['Analytics.schedule'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/analytics/schedules/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /**
     * Disable own schedule
     * @description Requires: manage:Report
     */
    delete: operations['Analytics.deleteSchedule'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/assignments': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List assignments (lowest priority value first)
     * @description Requires: read:Assignment
     */
    get: operations['Assignments.list'];
    put?: never;
    /**
     * Assign a script to a campaign (response lists equal-priority conflicts as `warnings`)
     * @description Requires: create:Assignment
     */
    post: operations['Assignments.create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/assignments/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get an assignment
     * @description Requires: read:Assignment
     */
    get: operations['Assignments.get'];
    put?: never;
    post?: never;
    /**
     * Remove an assignment (soft delete)
     * @description Requires: delete:Assignment
     */
    delete: operations['Assignments.remove'];
    options?: never;
    head?: never;
    /**
     * Update an assignment (optimistic locking)
     * @description Requires: update:Assignment
     */
    patch: operations['Assignments.update'];
    trace?: never;
  };
  '/v1/assignments/batch': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Atomically assign multiple campaigns or update priorities and windows
     * @description Requires: update:Campaign
     */
    post: operations['Assignments.batch'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/audit-checkpoints': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Signed checkpoints (latest 100)
     * @description Requires: read:Audit
     */
    get: operations['Audit.checkpoints'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/audit-checkpoints/keys': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Public Ed25519 keys (JWKS) for offline checkpoint verification
     * @description Requires: read:Audit
     */
    get: operations['Audit.keys'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/audit-events': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Search the audit trail: filters, full-text search, keyset by seq
     * @description Requires: read:Audit
     */
    get: operations['Audit.list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/audit-events/export': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Export matching events as CSV or JSON (the export itself is audited)
     * @description Requires: export:Audit
     */
    get: operations['Audit.export'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/audit-events/verify': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Verify chain integrity over a seq range and report broken links
     * @description Requires: read:Audit
     */
    post: operations['Audit.verify'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/authoring-notifications': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Pending approval requests and scoped @mentions for the current user
     * @description Requires: read:Script
     */
    get: operations['Team.notifications'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/authz/me': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** The caller and its effective permissions */
    get: operations['Authz.me'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/authz/roles': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List roles with their permission matrix
     * @description Requires: read:Role
     */
    get: operations['Authz.list'];
    put?: never;
    /**
     * Create a custom role from a permission matrix (no privilege escalation)
     * @description Requires: create:Role
     */
    post: operations['Authz.create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/authz/roles/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    /**
     * Replace the permission matrix of a custom role
     * @description Requires: update:Role
     */
    put: operations['Authz.update'];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/authz/users/{userId}/role-scope': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    /**
     * Set the campaign/team/site scope of a user's role assignment (ABAC)
     * @description Requires: update:Role, update:User
     */
    put: operations['Authz.setScope'];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/authz/vocabulary': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Resources, actions, scopes and system roles of the permission matrix
     * @description Requires: read:Role
     */
    get: operations['Authz.vocabulary'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/break-glass-accounts': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List break-glass accounts
     * @description Requires: read:BreakGlassAccount
     */
    get: operations['BreakGlass.list'];
    put?: never;
    /**
     * Enroll (or re-enroll) a break-glass account; returns the TOTP secret once
     * @description Requires: manage:BreakGlassAccount
     */
    post: operations['BreakGlass.enroll'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/break-glass-accounts/{userId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /**
     * Disable a break-glass account (ends its sessions)
     * @description Requires: manage:BreakGlassAccount
     */
    delete: operations['BreakGlass.disable'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/break-glass-accounts/{userId}/activate': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Confirm the authenticator with a first TOTP code
     * @description Requires: manage:BreakGlassAccount
     */
    post: operations['BreakGlass.activate'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/campaigns': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List campaigns (cursor pagination)
     * @description Requires: read:Campaign
     */
    get: operations['Campaigns.list'];
    put?: never;
    /**
     * Create a campaign
     * @description Requires: create:Campaign
     */
    post: operations['Campaigns.create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/campaigns/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get a campaign
     * @description Requires: read:Campaign
     */
    get: operations['Campaigns.get'];
    put?: never;
    post?: never;
    /**
     * Delete a campaign (soft delete)
     * @description Requires: delete:Campaign
     */
    delete: operations['Campaigns.remove'];
    options?: never;
    head?: never;
    /**
     * Update a campaign (optimistic locking)
     * @description Requires: update:Campaign
     */
    patch: operations['Campaigns.update'];
    trace?: never;
  };
  '/v1/campaigns/{id}/assignment-conflicts': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Equal-priority assignments of a campaign whose contexts overlap
     * @description Requires: read:Campaign
     */
    get: operations['Routing.conflicts'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/channels': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List channels
     * @description Requires: read:Channel
     */
    get: operations['Connectors.listChannels'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/connector-hub/connectors': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Hub: active connectors of this tenant with their non-secret config
     * @description Requires: read:Connector
     */
    get: operations['ConnectorHub.list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/connector-hub/connectors/{id}/engage/agent-token': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Hub: short-lived Workspace API token for one linked agent
     * @description Requires: read:Connector
     */
    post: operations['GenesysEngageHub.token'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/connector-hub/connectors/{id}/engage/agents': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Hub: agents with a live delegated Genesys Engage link
     * @description Requires: read:Connector
     */
    get: operations['GenesysEngageHub.agents'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/connector-hub/connectors/{id}/events': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Hub: ingest a normalized interaction event
     * @description Requires: update:Connector
     */
    post: operations['ConnectorHub.ingest'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/connector-hub/connectors/{id}/health': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Hub: report connector health
     * @description Requires: update:Connector
     */
    post: operations['ConnectorHub.health'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/connector-hub/connectors/{id}/secrets': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Hub: resolve the connector secrets from the integration secret vault
     * @description Requires: read:Connector
     */
    post: operations['ConnectorHub.secrets'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/connectors': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List connectors
     * @description Requires: read:Connector
     */
    get: operations['Connectors.listConnectors'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/connectors/{id}/attached-data-map': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get the attached data → variable mapping
     * @description Requires: read:Connector
     */
    get: operations['AttachedDataMap.get'];
    /**
     * Replace the attached data → variable mapping (optimistic locking)
     * @description Requires: update:Connector
     */
    put: operations['AttachedDataMap.put'];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/data-sources': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List data source definitions
     * @description Requires: read:DataSource
     */
    get: operations['Integrations.listDataSources'];
    put?: never;
    /**
     * Create a server-side data source with secret references
     * @description Requires: create:Integration
     */
    post: operations['Integrations.create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/data-sources/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Read a tenant-scoped data source definition
     * @description Requires: read:Integration
     */
    get: operations['Integrations.get'];
    /**
     * Update a data source definition
     * @description Requires: update:Integration
     */
    put: operations['Integrations.update'];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/data-sources/{id}/introspection': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Fetch GraphQL introspection schema for query editor (sandbox only)
     * @description Requires: update:Integration
     */
    post: operations['Integrations.introspection'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/data-sources/{id}/metrics': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Integration calls, latency percentiles, error rate and circuit state
     * @description Requires: read:Integration
     */
    get: operations['Integrations.metrics'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/data-sources/{id}/preview': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Designer preview with mock data; no external requests
     * @description Requires: update:Integration
     */
    post: operations['Integrations.preview'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/data-sources/{id}/promotion': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Request production profile promotion
     * @description Requires: update:Integration
     */
    post: operations['Integrations.promote'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/data-sources/{id}/promotion/approve': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Approve production profile promotion with separation of duties
     * @description Requires: approve:Integration
     */
    post: operations['Integrations.approve'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/data-sources/{id}/test': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Live sandbox test console (dev/test only)
     * @description Requires: execute:Integration, update:Integration
     */
    post: operations['Integrations.test'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/data-sources/{id}/usage': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Find readable scripts using a data source
     * @description Requires: read:Integration
     */
    get: operations['Integrations.usage'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/data-sources/{id}/wsdl': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Import a bounded WSDL without resolving remote entities or imports
     * @description Requires: update:Integration
     */
    post: operations['Integrations.wsdl'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/data-sources/preview': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Preview unsaved mock mapping without external requests or secrets
     * @description Requires: update:Integration
     */
    post: operations['Integrations.draftPreview'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/embedding-policy/{tenant}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Frame-ancestors policy of a tenant for agent-web documents */
    get: operations['Embedding.policy'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/genesys-cloud/connectors/{id}/oauth/authorize': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Start linking the Genesys Cloud user (redirects to login.<region>, PKCE S256)
     * @description Requires: create:Session
     */
    get: operations['GenesysCloudOAuth.authorize'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/genesys-cloud/oauth/callback': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Genesys Cloud OAuth redirect URI: exchanges the code, links the user, closes the popup
     * @description Requires: create:Session
     */
    get: operations['GenesysCloudOAuth.callback'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/genesys-engage/connectors/{id}/oauth/authorize': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Agent: start the Genesys Authentication link (Authorization Code)
     * @description Requires: create:Session
     */
    get: operations['GenesysEngageAgent.authorize'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/genesys-engage/connectors/{id}/unlink': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Agent: drop the delegated Genesys Engage link (end of shift)
     * @description Requires: create:Session
     */
    post: operations['GenesysEngageAgent.unlink'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/genesys-engage/links': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Agent: Genesys Engage link status per workspace connector
     * @description Requires: create:Session
     */
    get: operations['GenesysEngageAgent.status'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/genesys-engage/oauth/callback': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Agent: Genesys Authentication redirect URI (links the agent, closes the popup)
     * @description Requires: create:Session
     */
    get: operations['GenesysEngageAgent.callback'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/identity-providers': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List identity providers
     * @description Requires: read:IdentityProvider
     */
    get: operations['Identity.listIdps'];
    put?: never;
    /**
     * Create an identity provider (OIDC or SAML)
     * @description Requires: create:IdentityProvider
     */
    post: operations['IdentityAdmin.createIdp'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/identity-providers/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get an identity provider (config without secrets, URLs to register at the IdP)
     * @description Requires: read:IdentityProvider
     */
    get: operations['IdentityAdmin.getIdp'];
    put?: never;
    post?: never;
    /**
     * Delete an identity provider (revokes its SCIM tokens and sessions)
     * @description Requires: delete:IdentityProvider
     */
    delete: operations['IdentityAdmin.deleteIdp'];
    options?: never;
    head?: never;
    /**
     * Update an identity provider (disabling it ends its sessions)
     * @description Requires: update:IdentityProvider
     */
    patch: operations['IdentityAdmin.updateIdp'];
    trace?: never;
  };
  '/v1/identity-providers/{id}/scim-tokens': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List SCIM tokens of an identity provider
     * @description Requires: read:IdentityProvider
     */
    get: operations['IdentityAdmin.scimTokens'];
    put?: never;
    /**
     * Issue a SCIM bearer token (shown once)
     * @description Requires: update:IdentityProvider
     */
    post: operations['IdentityAdmin.issueScimToken'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/identity-providers/{id}/scim-tokens/{tokenId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /**
     * Revoke a SCIM token
     * @description Requires: update:IdentityProvider
     */
    delete: operations['IdentityAdmin.revokeScimToken'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/identity-providers/{id}/sp-credentials': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Create the next SAML SP signing/encryption credential (published in metadata)
     * @description Requires: update:IdentityProvider
     */
    post: operations['IdentityAdmin.rotate'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/identity-providers/{id}/sp-credentials/{credentialId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /**
     * Remove a retired or next SP credential
     * @description Requires: update:IdentityProvider
     */
    delete: operations['IdentityAdmin.removeCredential'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/identity-providers/{id}/sp-credentials/{credentialId}/promote': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Promote the next SP credential to active (the old one is retired)
     * @description Requires: update:IdentityProvider
     */
    post: operations['IdentityAdmin.promote'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/launch-intents': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Connector-hub: create a short-lived single-use launch intent (client credentials + mTLS)
     * @description Requires: create:Session
     */
    post: operations['Launch.create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/launch/embedded': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Agent (embedded): launch from a platform hint, verified with the platform API
     * @description Requires: create:Session
     */
    post: operations['Launch.embedded'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/launch/jws': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Agent (CTI-less): launch from a tenant-signed JWS (exp ≤ 60 s, single-use jti)
     * @description Requires: create:Session
     */
    post: operations['Launch.jws'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/launch/param-signals': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Agent: report ignored identifying URL parameters
     * @description Requires: create:Session
     */
    post: operations['Launch.signal'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/launch/preview': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Designer: start a preview session on a mock interaction
     * @description Requires: update:Script
     */
    post: operations['Launch.preview'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/launch/redeem': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Agent: exchange a launch code for a session bound to this sign-in
     * @description Requires: create:Session
     */
    post: operations['Launch.redeem'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/launch/socket-ticket': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Agent: one-time ticket for the launch-offer socket (/launch namespace)
     * @description Requires: create:Session
     */
    post: operations['Launch.ticket'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/me/permissions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** The caller's CASL rules (packed), resolved for its scope and SoD */
    get: operations['MePermissions.permissions'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/me/sessions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** My active sessions */
    get: operations['IdentityAdmin.mySessions'];
    put?: never;
    post?: never;
    /** End all my other sessions */
    delete: operations['IdentityAdmin.endMyOtherSessions'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/me/sessions/{sessionId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** End one of my sessions */
    delete: operations['IdentityAdmin.endMySession'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/roles': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List roles
     * @description Requires: read:Role
     */
    get: operations['Identity.listRoles'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/screens/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get a screen with its components
     * @description Requires: read:Screen
     */
    get: operations['Screens.get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/script-packages/export': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Export versions as a signed .verbis package (JSON + manifest + checksums)
     * @description Requires: read:Script
     */
    post: operations['Packages.export'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/script-packages/import': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Verify and import a .verbis package as draft versions (`?dryRun=true` to preview)
     * @description Requires: create:Script
     */
    post: operations['Packages.import'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/script-resolutions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Resolve which script version opens for an interaction context (with decision trace)
     * @description Deterministic for (context, time). Does not open a session: the secure launch flow does (SECURITY §4).
     *
     *     Requires: read:Campaign
     */
    post: operations['Routing.resolve'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/script-versions/{versionId}/screens': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List screens (pages) of a script version
     * @description Requires: read:Screen
     */
    get: operations['Screens.list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List scripts
     * @description Requires: read:Script
     */
    get: operations['Scripts.list'];
    put?: never;
    /**
     * Create a script
     * @description Requires: create:Script
     */
    post: operations['Scripts.create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get a script
     * @description Requires: read:Script
     */
    get: operations['Scripts.get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /**
     * Update script metadata
     * @description Requires: update:Script
     */
    patch: operations['Scripts.update'];
    trace?: never;
  };
  '/v1/scripts/{id}/rollback': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Roll back the authoritative release head; explicit pins stay pinned
     * @description Requires: publish:Script
     */
    post: operations['Team.rollback'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List versions of a script
     * @description Requires: read:ScriptVersion
     */
    get: operations['Scripts.listVersions'];
    put?: never;
    /**
     * Create a draft version
     * @description The document is validated with @verbis/script-schema; errors return 422 with `errors[].code`.
     *
     *     Requires: create:ScriptVersion
     */
    post: operations['Scripts.createVersion'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions/{from}/diff/{to}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Diff two versions: RFC 6902 patch + human-readable summary
     * @description Requires: read:Script
     */
    get: operations['Scripts.diff'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions/{number}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get a version with its document
     * @description Requires: read:ScriptVersion
     */
    get: operations['Scripts.getVersion'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions/{number}/collaboration/flush': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Persist and freeze the room before changing the draft lifecycle
     * @description Requires: update:Script
     */
    post: operations['Collaboration.flush'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions/{number}/collaboration/ticket': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Issue a one-use 30-second origin-bound collaborative authoring ticket
     * @description Requires: update:Script
     */
    post: operations['Collaboration.ticket'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions/{number}/comments': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List node comment threads
     * @description Requires: read:Script
     */
    get: operations['Team.threads'];
    put?: never;
    /**
     * Create node comment with tenant user mentions
     * @description Requires: read:Script
     */
    post: operations['Team.comment'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions/{number}/comments/{thread}/replies': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Reply to a node comment thread
     * @description Requires: read:Script
     */
    post: operations['Team.reply'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions/{number}/comments/{thread}/resolve': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Resolve or reopen a thread with optimistic concurrency
     * @description Requires: read:Script
     */
    post: operations['Team.resolve'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions/{number}/document': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    /**
     * Replace the document of a DRAFT version (approved/published are immutable)
     * @description Requires: update:Script
     */
    put: operations['Scripts.updateDraft'];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions/{number}/preview/data-sources/{source}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Execute a pinned data source in an explicit test profile for designer preview
     * @description Requires: execute:Integration
     */
    post: operations['Scripts.livePreview'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions/{number}/publish': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Publish an approved version (immutable afterwards)
     * @description Requires: publish:Script
     */
    post: operations['Scripts.publish'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions/{number}/regression': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Run saved synthetic scenarios with core-runtime; no external effects
     * @description Requires: read:Script
     */
    post: operations['Scripts.regression'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions/{number}/reopen': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Reopen an approved version for editing (discards the approval)
     * @description Requires: update:Script
     */
    post: operations['Scripts.reopen'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions/{number}/retire': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Retire a published version (refused while assignments pin it)
     * @description Requires: publish:Script
     */
    post: operations['Scripts.retire'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions/{number}/reviews': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Review trail of a version
     * @description Requires: read:Script
     */
    get: operations['Scripts.reviews'];
    put?: never;
    /**
     * Approve, reject (with reason) or comment on a version in review (SoD enforced)
     * @description Requires: read:Script
     */
    post: operations['Scripts.review'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions/{number}/schedule': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Schedule a release; permissions, checksum and scenarios rechecked at execution
     * @description Requires: publish:Script
     */
    post: operations['Team.schedule'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions/{number}/schedules': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List scheduled release statuses
     * @description Requires: read:Script
     */
    get: operations['Team.schedules'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions/{number}/submit': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Submit a draft for review with a semantic version and change note
     * @description Requires: update:Script
     */
    post: operations['Scripts.submit'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions/{number}/team-members': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List up to 100 active tenant members who can read the script
     * @description Requires: read:Script
     */
    get: operations['Team.members'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/scripts/{id}/versions/{number}/withdraw': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Withdraw a version from review (back to draft)
     * @description Requires: update:Script
     */
    post: operations['Scripts.withdraw'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/secrets': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List secret metadata (never values; access is audited)
     * @description Requires: read:Secret
     */
    get: operations['Integrations.listSecrets'];
    put?: never;
    /**
     * Set a secret; only metadata is returned
     * @description Requires: create:Secret
     */
    post: operations['Integrations.setSecret'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/secrets/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    /**
     * Rotate secret value; never returns plaintext
     * @description Requires: update:Secret
     */
    put: operations['Integrations.rotate'];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/security/csp-reports': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Persist a bounded, privacy-safe browser CSP signal in the security journal */
    post: operations['SecurityReports.report'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/service-clients': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List service clients
     * @description Requires: read:ServiceClient
     */
    get: operations['IdentityAdmin.listClients'];
    put?: never;
    /**
     * Create a service client (the secret is shown once)
     * @description Requires: create:ServiceClient
     */
    post: operations['IdentityAdmin.createClient'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/service-clients/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get a service client
     * @description Requires: read:ServiceClient
     */
    get: operations['IdentityAdmin.getClient'];
    put?: never;
    post?: never;
    /**
     * Delete a service client
     * @description Requires: delete:ServiceClient
     */
    delete: operations['IdentityAdmin.deleteClient'];
    options?: never;
    head?: never;
    /**
     * Update a service client
     * @description Requires: update:ServiceClient
     */
    patch: operations['IdentityAdmin.updateClient'];
    trace?: never;
  };
  '/v1/service-clients/{id}/secret': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Rotate a service client secret (shown once)
     * @description Requires: update:ServiceClient
     */
    post: operations['IdentityAdmin.rotateSecret'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List runtime sessions
     * @description Requires: read:Session
     */
    get: operations['Runtime.list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get a session
     * @description Requires: read:Session
     */
    get: operations['Runtime.get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/attach': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Acquire or renew the first-tab writer lease; another tab receives read-only state
     * @description Requires: update:Session
     */
    post: operations['RuntimeCommands.attach'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/commands': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Apply a sequenced runtime command
     * @description Requires: update:Session
     */
    post: operations['RuntimeCommands.command'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/desktop': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Owner-only pinned script, trusted interaction context and disposition set
     * @description Requires: read:Session
     */
    get: operations['AgentDesktop.desktop'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/desktop/data-source': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Writer-fenced BFF data-source execution; exact script pin and server secrets
     * @description Requires: update:Session
     */
    post: operations['AgentDesktop.call'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/desktop/data-source-recovery': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Writer acknowledges an author-allowed data source fallback
     * @description Requires: update:Session
     */
    post: operations['AgentDesktop.recovery'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/desktop/failure': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Owner reports a sanitized client failure for support
     * @description Requires: read:Session
     */
    post: operations['AgentDesktop.failure'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/desktop/telemetry': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Writer-fenced node timing and required-read acknowledgment; metadata only
     * @description Requires: update:Session
     */
    post: operations['AgentDesktop.telemetry'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/events': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List session events in order
     * @description Requires: read:Session
     */
    get: operations['Runtime.events'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/outcome': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Validate campaign disposition and enqueue connector writeback
     * @description Requires: update:Session
     */
    post: operations['RuntimeCommands.outcome'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/recording': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Queue connector recording pause or resume
     * @description Requires: update:Session
     */
    post: operations['RuntimeCommands.recording'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/release': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Release the current BFF-bound writer lease
     * @description Requires: update:Session
     */
    post: operations['RuntimeCommands.release'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/secure-field': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Accept a provider-verified token receipt for a PCI field
     * @description Requires: update:Session
     */
    post: operations['RuntimeCommands.secure'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/socket-ticket': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Issue an origin-bound, single-use WebSocket ticket
     * @description Requires: read:Session
     */
    post: operations['RuntimeCommands.ticket'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/state': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Recover runtime state; PCI values are never returned
     * @description Requires: read:Session
     */
    get: operations['RuntimeCommands.state'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/takeover': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Owner takes over the writer lease; previous capability is revoked and audited
     * @description Requires: update:Session
     */
    post: operations['RuntimeCommands.takeover'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/transfer': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Transfer allow-listed context to a securely launched recipient session
     * @description Requires: update:Session
     */
    post: operations['RuntimeCommands.transfer'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{sessionId}/data-sources/{id}/execute': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Execute a pinned data source with an active runtime session and signed session token
     * @description Requires: execute:Integration
     */
    post: operations['Integrations.execute'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/shared-screens': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Shared (reusable) screens with their latest version
     * @description Requires: read:Screen
     */
    get: operations['SharedScreens.list'];
    put?: never;
    /**
     * Create a shared screen (version 1)
     * @description Requires: create:Screen
     */
    post: operations['SharedScreens.create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/shared-screens/{id}/impact': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Scripts that link this screen and whether they are behind
     * @description Requires: read:Screen
     */
    get: operations['SharedScreens.impact'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/shared-screens/{id}/versions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Publish a new immutable version; returns the affected scripts
     * @description Requires: update:Screen
     */
    post: operations['SharedScreens.publish'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/siem-destinations': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * SIEM destinations with delivery status
     * @description Requires: read:Audit
     */
    get: operations['SiemDestinations.list'];
    put?: never;
    /**
     * Add a SIEM destination (syslog TLS, HMAC webhook, Kafka)
     * @description Requires: update:Tenant
     */
    post: operations['SiemDestinations.create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/siem-destinations/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /**
     * Remove a SIEM destination (soft delete; cursor kept for the record)
     * @description Requires: update:Tenant
     */
    delete: operations['SiemDestinations.remove'];
    options?: never;
    head?: never;
    /**
     * Enable or disable a SIEM destination
     * @description Requires: update:Tenant
     */
    patch: operations['SiemDestinations.update'];
    trace?: never;
  };
  '/v1/simulator/connectors/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Simulator state: interactions and received commands
     * @description Requires: manage:Connector
     */
    get: operations['Simulator.state'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/simulator/connectors/{id}/interactions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Simulate a new call/chat/email… offered to an agent
     * @description Requires: manage:Connector
     */
    post: operations['Simulator.create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/simulator/connectors/{id}/interactions/{platformInteractionId}/actions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Drive a simulated interaction (connect, hold, transfer, end…)
     * @description Requires: manage:Connector
     */
    post: operations['Simulator.act'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/supervisor/sessions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List live sessions within the caller team scope
     * @description Requires: read:Session
     */
    get: operations['RuntimeSupervisor.list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/supervisor/sessions/{id}/socket-ticket': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Issue a scoped read-only supervisor watch ticket
     * @description Requires: read:Session
     */
    post: operations['RuntimeSupervisor.ticket'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/supervisor/sessions/{id}/state': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Observe a scoped session in read-only mode with PII redacted
     * @description Requires: read:Session
     */
    get: operations['RuntimeSupervisor.state'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/templates': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Template library (built-in + tenant templates)
     * @description Requires: read:Script
     */
    get: operations['Templates.list'];
    put?: never;
    /**
     * Save a script version as a template
     * @description Requires: create:Script
     */
    post: operations['Templates.create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/templates/{id}/instantiate': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Create a new script (draft version) from a template
     * @description Requires: create:Script
     */
    post: operations['Templates.instantiate'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/tenant': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** The caller's tenant */
    get: operations['Tenancy.current'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/tenant/settings': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /**
     * Update tenant settings (e.g. CORS allowed origins)
     * @description Requires: manage:Tenant
     */
    patch: operations['Tenancy.updateSettings'];
    trace?: never;
  };
  '/v1/users': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List users (PII; access is audited)
     * @description Requires: read:User
     */
    get: operations['Identity.listUsers'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/users/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get a user (PII; access is audited)
     * @description Requires: read:User
     */
    get: operations['Identity.getUser'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/users/{id}/roles': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * A user's roles with their source (manual, claims:<idp>, scim:<idp>)
     * @description Requires: read:User, read:Role
     */
    get: operations['IdentityAdmin.userRoles'];
    /**
     * Set a user's manually assigned roles (IdP/SCIM roles are unaffected)
     * @description Requires: update:User, manage:Role
     */
    put: operations['IdentityAdmin.setUserRoles'];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/users/{id}/sessions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List a user's active sessions
     * @description Requires: read:User
     */
    get: operations['IdentityAdmin.userSessions'];
    put?: never;
    post?: never;
    /**
     * End all of a user's sessions
     * @description Requires: update:User
     */
    delete: operations['IdentityAdmin.endUserSessions'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/users/{id}/sessions/{sessionId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /**
     * End a user's session
     * @description Requires: update:User
     */
    delete: operations['IdentityAdmin.endUserSession'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    AbVariants: {
      key: string;
      weight: number;
      /** Format: uuid */
      pinnedVersionId?: string;
    }[];
    AnalyticsDashboard: {
      /** Format: date-time */
      generatedAt: string;
      sampleEvents: number;
      sessions: number;
      completed: number;
      completionRate: number;
      meanDurationMs: number | null;
      scripts: {
        key: string;
        sessions: number;
        completed: number;
        completionRate: number;
        meanDurationMs: number | null;
      }[];
      agents: {
        key: string;
        sessions: number;
        completed: number;
        completionRate: number;
        meanDurationMs: number | null;
      }[];
      pages: {
        key: string;
        visits: number;
        sessions: number;
        meanDwellMs: number | null;
        dropOff: number;
        dropOffRate: number;
      }[];
      paths: {
        source: string;
        target: string;
        count: number;
      }[];
      outcomes: {
        key: string;
        count: number;
      }[];
      sources: {
        key: string;
        calls: number;
        meanLatencyMs: number;
        errorRate: number;
      }[];
      heatmap: {
        versionId: string;
        pageId: string;
        nodeId: string;
        samples: number;
        meanDwellMs: number | null;
        errors: number;
      }[];
      compliance: {
        eligible: number;
        acknowledged: number;
        rate: number | null;
      };
      variants: {
        key: string;
        sessions: number;
        completed: number;
        completionRate: number;
        meanDurationMs: number | null;
        experimentId: string;
      }[];
      comparisons: {
        experimentId: string;
        a: string;
        b: string;
        difference: number;
        pValue: number | null;
        significant: boolean;
        /** @enum {string} */
        reason: 'sufficient' | 'insufficient';
      }[];
      active: {
        sessionId: string;
        scriptId: string;
        campaignId: string | null;
        agent: string | null;
        state: string;
        /** Format: date-time */
        since: string;
      }[];
      liveCampaigns: {
        key: string;
        active: number;
        completed: number;
      }[];
    };
    AnalyticsFilter: {
      /** Format: date */
      from: string;
      /** Format: date */
      to: string;
      /** Format: uuid */
      campaignId?: string;
      /** Format: uuid */
      scriptId?: string;
      /** @enum {string} */
      channel?:
        | 'voice'
        | 'chat'
        | 'email'
        | 'video'
        | 'social'
        | 'messaging'
        | 'sms'
        | 'whatsapp'
        | 'callback';
      /** Format: uuid */
      teamId?: string;
    };
    AnalyticsSchedule: {
      filter: components['schemas']['AnalyticsFilter'];
      /** @enum {string} */
      frequency: 'daily' | 'weekly';
      hourUtc: number;
      enabled: boolean;
      recipientUserIds: string[];
    };
    Assignment: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      /** @description Optimistic-lock version; send as If-Match: "<version>" */
      version: number;
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      scriptId: string;
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      campaignId: string;
      priority: number;
      /** @enum {string} */
      versionPolicy: 'pinned' | 'latestPublished';
      pinnedVersionId: string | null;
      effectiveFrom: string | null;
      effectiveTo: string | null;
      conditions: components['schemas']['AssignmentConditions'];
      expression: unknown | null;
      variants:
        | {
            key: string;
            weight: number;
            /**
             * Format: uuid
             * @description UUIDv7 identifier
             */
            pinnedVersionId?: string;
          }[]
        | null;
      validFrom: string | null;
      validTo: string | null;
      rule: unknown | null;
    };
    AssignmentConditions: {
      channels?: (
        'voice' | 'chat' | 'email' | 'sms' | 'whatsapp' | 'social' | 'video' | 'callback'
      )[];
      locales?: string[];
      queues?: string[];
      skills?: string[];
      segments?: string[];
    };
    AssignmentConflict: {
      assignmentIds: string[];
      priority: number;
      /** @enum {string} */
      severity: 'certain' | 'possible';
      /** @enum {string} */
      resolvedBy: 'specificity' | 'recency' | 'id';
      overlap: {
        [key: string]: unknown;
      };
    };
    AssignmentPage: {
      data: components['schemas']['Assignment'][];
      page: {
        limit: number;
        nextCursor: string | null;
        sort: string;
      };
    };
    AuditCheckpoint: {
      id: string;
      seq: string;
      hash: string;
      sessionHeadsDigest: string;
      sessionHeadsCount: number;
      prevCheckpointId: string | null;
      keyId: string;
      signature: string;
      /** Format: date-time */
      signedAt: string;
    };
    AuditCheckpointKeys: {
      keys: {
        kty: string;
        crv: string;
        kid: string;
        x: string;
      }[];
    };
    AuditEvent: {
      id: string;
      seq: number;
      action: string;
      actor: {
        type: string;
        id: string;
        displayName?: string;
        ip?: string;
        userAgent?: string;
        sessionId?: string;
      };
      resource: {
        type: string;
        id: string;
        name: string | null;
      };
      target: {
        type: string;
        id: string;
        name: string | null;
      };
      /** @enum {string} */
      outcome: 'success' | 'failure' | 'denied';
      reason: string | null;
      diff: unknown | null;
      correlationId: string;
      interactionId: string | null;
      metadata: {
        [key: string]: unknown;
      };
      /** Format: date-time */
      occurredAt: string;
      /** Format: date-time */
      recordedAt: string;
      prevHash: string;
      hash: string;
      hashVersion: number;
    };
    AuditEventPage: {
      data: components['schemas']['AuditEvent'][];
      page: {
        limit: number;
        nextCursor: string | null;
        sort: string;
      };
    };
    AuditVerifyReport: {
      valid: boolean;
      checked: number;
      fromSeq: string | null;
      toSeq: string | null;
      headSeq: string | null;
      anchor: {
        seq: string;
        /** @enum {string} */
        source: 'genesis' | 'event' | 'checkpoint';
      };
      lastHash: string;
      checkpointsChecked: number;
      signaturesVerified: boolean;
      breaks: {
        /** @enum {string} */
        kind:
          | 'hash_mismatch'
          | 'link_mismatch'
          | 'sequence_gap'
          | 'tenant_mismatch'
          | 'anchor_missing'
          | 'checkpoint_mismatch'
          | 'checkpoint_signature_invalid';
        seq: string;
        expected?: string;
        actual?: string;
        eventId?: string;
      }[];
      truncated: boolean;
    };
    AuditVerifyRequest: {
      fromSeq?: string;
      toSeq?: string;
    };
    AuthoringNotification: {
      id: string;
      /** Format: uuid */
      scriptId: string;
      number: number;
      /** @enum {string} */
      kind: 'review' | 'mention';
      createdAt: string;
      /** Format: uuid */
      threadId?: string;
    };
    AuthSession: {
      user: {
        /** Format: uuid */
        id: string;
        /** Format: uuid */
        tenantId: string;
        /** @enum {string} */
        authMethod: 'sso' | 'break_glass';
      };
      session: {
        /** Format: uuid */
        id: string;
        /** @enum {string} */
        kind: 'sso' | 'break_glass';
        /** @enum {string} */
        protocol: 'oidc' | 'saml' | 'local';
        idpId: string | null;
        app: string;
        createdAt: string;
        lastSeenAt: string;
        expiresAt: string;
        ip: string;
        userAgent: string;
      };
      csrfToken: string;
    };
    BatchAssignments: {
      creates?: components['schemas']['CreateAssignment'][];
      updates?: {
        /**
         * Format: uuid
         * @description UUIDv7 identifier
         */
        id: string;
        version: number;
        patch: components['schemas']['UpdateAssignment'];
      }[];
    };
    BreakGlassAccount: {
      /** Format: uuid */
      userId: string;
      /** @enum {string} */
      status: 'pending_mfa' | 'active' | 'disabled';
      lockedUntil: string | null;
      lastUsedAt: string | null;
      createdAt: string;
    };
    BreakGlassActivate: {
      code: string;
    };
    BreakGlassEnroll: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      userId: string;
      password: string;
    };
    /** @description Shown once; @secret */
    BreakGlassEnrollment: {
      /** Format: uuid */
      userId: string;
      totpUri: string;
      totpSecret: string;
    };
    BreakGlassLogin: {
      tenant: string;
      /** Format: email */
      email: string;
      password: string;
      code: string;
    };
    BreakGlassLoginResponse: {
      expiresAt: string;
      csrfToken: string;
    };
    Campaign: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      /** @description Optimistic-lock version; send as If-Match: "<version>" */
      version: number;
      code: string | null;
      locales: string[];
      externalMappings: components['schemas']['CampaignExternalMapping'][];
      workingHours: components['schemas']['WorkingHours'] | null;
      outcomeSet: components['schemas']['CampaignOutcome'][];
      name: string;
      description: string | null;
      /** @enum {string} */
      status: 'draft' | 'active' | 'paused' | 'archived';
      defaultLocale: string;
      channels: (
        'voice' | 'chat' | 'email' | 'sms' | 'whatsapp' | 'social' | 'video' | 'callback'
      )[];
      queues: string[];
      startsAt: string | null;
      endsAt: string | null;
    };
    CampaignExternalMapping: {
      /** @enum {string} */
      platform:
        | 'genesys-cloud'
        | 'genesys-engage'
        | 'avaya-aes'
        | 'avaya-aacc'
        | 'avaya-axp'
        | 'amazon-connect'
        | 'cisco'
        | 'nice-cxone'
        | 'five9'
        | 'generic';
      kind: string;
      externalId: string;
    };
    CampaignOutcome: {
      code: string;
      label: string;
      /** @enum {string} */
      category: 'success' | 'failure' | 'callback' | 'noContact' | 'other';
      /** @default false */
      requiresNote: boolean;
      /** @default [] */
      requiredFields: string[];
      /** @default [] */
      subCodes: string[];
    };
    CampaignPage: {
      data: components['schemas']['Campaign'][];
      page: {
        limit: number;
        nextCursor: string | null;
        sort: string;
      };
    };
    Channel: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      /** @description Optimistic-lock version; send as If-Match: "<version>" */
      version: number;
      /** @enum {string} */
      type: 'voice' | 'chat' | 'email' | 'sms' | 'whatsapp' | 'social' | 'video' | 'callback';
      provider: string;
      config: unknown;
    };
    ChannelPage: {
      data: components['schemas']['Channel'][];
      page: {
        limit: number;
        nextCursor: string | null;
        sort: string;
      };
    };
    CollaborationTicket: {
      ticket: string;
      documentName: string;
      /** Format: uuid */
      userId: string;
      /** @constant */
      path: '/collaboration';
    };
    Component: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      key: string;
      type: string;
      props: unknown;
      bindings: unknown;
      events: unknown;
    };
    Connector: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      /** @description Optimistic-lock version; send as If-Match: "<version>" */
      version: number;
      /** @enum {string} */
      adapterType:
        | 'genesys_cloud'
        | 'genesys_engage'
        | 'avaya_aes'
        | 'avaya_axp'
        | 'avaya_aacc'
        | 'amazon_connect'
        | 'cisco'
        | 'nice_cxone'
        | 'five9'
        | 'generic';
      platform: string;
      /** @enum {string} */
      status: 'draft' | 'active' | 'disabled' | 'error';
      health: unknown;
    };
    ConnectorEventIngest: {
      event: unknown;
    };
    ConnectorEventIngested: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      interactionId: string;
      agentId: string | null;
      status: string;
    };
    ConnectorHealthReport: {
      /** @enum {string} */
      status: 'up' | 'degraded' | 'down';
      detail?: string;
    };
    ConnectorPage: {
      data: components['schemas']['Connector'][];
      page: {
        limit: number;
        nextCursor: string | null;
        sort: string;
      };
    };
    CreateAssignment: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      scriptId: string;
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      campaignId: string;
      /** @default 100 */
      priority: number;
      /**
       * @default latestPublished
       * @enum {string}
       */
      versionPolicy: 'pinned' | 'latestPublished';
      pinnedVersionId?: string | null;
      effectiveFrom?: string | null;
      effectiveTo?: string | null;
      /** @default {} */
      conditions: components['schemas']['AssignmentConditions'];
      expression?: components['schemas']['Predicate'] | null;
      variants?: components['schemas']['AbVariants'] | null;
    };
    CreateCampaign: {
      name: string;
      code?: string;
      /** @default [] */
      locales: string[];
      /** @default [] */
      externalMappings: components['schemas']['CampaignExternalMapping'][];
      workingHours?: components['schemas']['WorkingHours'] | null;
      /** @default [] */
      outcomeSet: components['schemas']['CampaignOutcome'][];
      description?: string | null;
      /**
       * @default draft
       * @enum {string}
       */
      status: 'draft' | 'active' | 'paused';
      /** @default tr */
      defaultLocale: string;
      /** @default [] */
      channels: (
        'voice' | 'chat' | 'email' | 'sms' | 'whatsapp' | 'social' | 'video' | 'callback'
      )[];
      /** @default [] */
      queues: string[];
      startsAt?: string | null;
      endsAt?: string | null;
    };
    CreateCustomRole: {
      name: string;
      description?: string;
      matrix: {
        [key: string]: {
          actions: (
            | 'read'
            | 'create'
            | 'update'
            | 'delete'
            | 'publish'
            | 'approve'
            | 'execute'
            | 'reveal'
            | 'export'
            | 'manage'
          )[];
          /**
           * @default all
           * @enum {string}
           */
          scope: 'all' | 'campaign' | 'team' | 'site' | 'own';
          /** @default false */
          revealPii: boolean;
        };
      };
    };
    CreatedScriptVersion: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      /** @description Optimistic-lock version; send as If-Match: "<version>" */
      version: number;
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      scriptId: string;
      number: number;
      /** @enum {string} */
      state: 'draft' | 'in_review' | 'approved' | 'published' | 'retired';
      schemaVersion: string;
      /** @enum {string} */
      documentEncoding: 'json' | 'gzip';
      documentSize: number;
      checksum: string;
      publishedAt: string | null;
      semver: string | null;
      changeNote: string | null;
      submittedAt: string | null;
      approvedAt: string | null;
      retiredAt: string | null;
      reviewRound: number;
      createdBy: string;
      migratedFrom: string[];
      warnings: {
        /** @enum {string} */
        severity: 'error' | 'warning' | 'info';
        path: string;
        code: string;
        messageKey: string;
        params?: {
          [key: string]: string | number;
        };
      }[];
    };
    CreateIdentityProvider:
      | {
          /** @constant */
          protocol: 'oidc';
          displayName: string;
          domains?: string[];
          /** @default false */
          jitProvisioning: boolean;
          /** @default false */
          scimEnabled: boolean;
          /**
           * @default draft
           * @enum {string}
           */
          status: 'draft' | 'active' | 'disabled';
          config: {
            /** @enum {string} */
            vendor: 'entra' | 'okta' | 'keycloak' | 'google' | 'adfs' | 'ping' | 'generic';
            /** Format: uri */
            issuer: string;
            clientId: string;
            /**
             * @default client_secret_basic
             * @enum {string}
             */
            clientAuth: 'client_secret_basic' | 'client_secret_post';
            scopes?: string[];
            authParams?: {
              [key: string]: string;
            };
            claims?: {
              email?: string;
              emailVerified?: string;
              displayName?: string;
              givenName?: string;
              familyName?: string;
              groups?: string;
              locale?: string;
            };
            acrValues?: string;
            /** @default true */
            linkByVerifiedEmail: boolean;
            /**
             * @default {
             *       "rules": [],
             *       "defaultRoles": []
             *     }
             */
            roleMapping: {
              /** @default [] */
              rules: {
                claim: string;
                equals: string;
                roles: string[];
              }[];
              /** @default [] */
              defaultRoles: string[];
            };
            /** @description @secret write-only */
            clientSecret?: string;
          };
        }
      | {
          /** @constant */
          protocol: 'saml';
          displayName: string;
          domains?: string[];
          /** @default false */
          jitProvisioning: boolean;
          /** @default false */
          scimEnabled: boolean;
          /**
           * @default draft
           * @enum {string}
           */
          status: 'draft' | 'active' | 'disabled';
          config: {
            /** @enum {string} */
            vendor: 'entra' | 'okta' | 'keycloak' | 'google' | 'adfs' | 'ping' | 'generic';
            idpEntityId: string;
            /** Format: uri */
            ssoUrl: string;
            /** Format: uri */
            sloUrl?: string;
            idpCertificates: string[];
            nameIdFormat?: string;
            /** @default false */
            allowIdpInitiated: boolean;
            /** @default true */
            signRequests: boolean;
            /** @default false */
            requireEncryptedAssertions: boolean;
            authnContext?: string[];
            attributes?: {
              email?: string;
              emailVerified?: string;
              displayName?: string;
              givenName?: string;
              familyName?: string;
              groups?: string;
              locale?: string;
            };
            /** @default false */
            linkByVerifiedEmail: boolean;
            /**
             * @default {
             *       "rules": [],
             *       "defaultRoles": []
             *     }
             */
            roleMapping: {
              /** @default [] */
              rules: {
                claim: string;
                equals: string;
                roles: string[];
              }[];
              /** @default [] */
              defaultRoles: string[];
            };
          };
        };
    CreateScimToken: {
      expiresInDays?: number;
    };
    CreateScript: {
      name: string;
      description?: string;
      /** @default [] */
      tags: string[];
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      campaignId?: string;
    };
    CreateScriptVersion: {
      document: {
        [key: string]: unknown;
      };
      /** @default [] */
      screens: {
        /**
         * Format: uuid
         * @description UUIDv7 identifier
         */
        sharedScreenId: string;
        versionNumber?: number;
        /**
         * @default linked
         * @enum {string}
         */
        mode: 'linked' | 'detached';
      }[];
    };
    CreateServiceClient: {
      name: string;
      /**
       * @default client_secret_basic
       * @enum {string}
       */
      authMethod: 'client_secret_basic' | 'client_secret_post' | 'tls_client_auth';
      scopes: string[];
      certificate?: string;
    };
    CreateSharedScreen: {
      key: string;
      name: string;
      description?: string;
      /** @default [] */
      tags: string[];
      /** @default 1.0.0 */
      semver: string;
      changeNote?: string;
      fragment: components['schemas']['ScreenFragment'];
    };
    CreateSiemDestination:
      | {
          /** @constant */
          kind: 'syslog';
          name: string;
          /**
           * @default rfc5424
           * @enum {string}
           */
          format: 'rfc5424' | 'cef' | 'json';
          config: {
            host: string;
            /** @default 6514 */
            port: number;
            /** @default 13 */
            facility: number;
            /** @default verbis */
            appName: string;
            /** @default verbis-audit */
            hostname: string;
            /** @default 32473 */
            enterpriseId: number;
            caPem?: string;
            servername?: string;
            /** @default 10000 */
            timeoutMs: number;
          };
        }
      | {
          /** @constant */
          kind: 'webhook';
          name: string;
          /**
           * @default json
           * @constant
           */
          format: 'json';
          config: {
            /** Format: uri */
            url: string;
            /** @default 10000 */
            timeoutMs: number;
            /** @default 100 */
            batchSize: number;
          };
          secretRef: string;
        }
      | {
          /** @constant */
          kind: 'kafka';
          name: string;
          /**
           * @default json
           * @enum {string}
           */
          format: 'json' | 'cef';
          config: {
            topic: string;
          };
        };
    CreateTemplate: {
      name: string;
      /** @enum {string} */
      category:
        'sales' | 'service' | 'collections' | 'survey' | 'retention' | 'onboarding' | 'other';
      description?: string;
      /** @default [] */
      tags: string[];
      /** Format: uuid */
      scriptId: string;
      versionNumber: number;
    };
    CspSecurityReport: {
      'csp-report': {
        'document-uri': string;
        'effective-directive': string;
        /** @enum {string} */
        disposition?: 'enforce' | 'report';
        'violated-directive'?: string;
        'blocked-uri'?: string;
      };
    };
    CustomRole: {
      /** Format: uuid */
      id: string;
      name: string;
      description: string | null;
      isSystem: boolean;
      matrix: {
        [key: string]: string[];
      };
      rules: unknown[];
      version: number;
    };
    DataSource: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      /** @description Optimistic-lock version; send as If-Match: "<version>" */
      version: number;
      key: string;
      /** @enum {string} */
      protocol: 'rest' | 'soap' | 'graphql';
      definition: unknown;
      secretRefs: string[];
      policy: unknown;
    };
    DataSourcePage: {
      data: components['schemas']['DataSource'][];
      page: {
        limit: number;
        nextCursor: string | null;
        sort: string;
      };
    };
    DiscoverRequest: {
      /** Format: email */
      email?: string;
      tenant?: string;
    };
    DiscoverResponse: {
      tenant: string;
      providers: {
        /** Format: uuid */
        id: string;
        displayName: string;
        /** @enum {string} */
        protocol: 'oidc' | 'saml';
      }[];
    };
    EmbeddingSettings: {
      frameAncestors?: string[];
    };
    EngageAttachedDataMap: {
      attachedData: {
        key: string;
        variable: string;
        /**
         * @default string
         * @enum {string}
         */
        type: 'string' | 'number' | 'boolean';
        /** @default false */
        writeBack: boolean;
        /** @default false */
        pii: boolean;
      }[];
    };
    EngageLinkStatus: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      connectorId: string;
      linked: boolean;
      expiresAt: string | null;
    }[];
    EventCountQuery: {
      /** Format: date */
      from?: string;
      /** Format: date */
      to?: string;
      eventType?: string;
    };
    EventCounts: {
      data: {
        eventType: string;
        /** Format: date */
        day: string;
        count: number;
      }[];
    };
    ExportPackage: {
      items: {
        /** Format: uuid */
        scriptId: string;
        versionNumber: number;
      }[];
      /** @default [] */
      targetEnvironments: string[];
    };
    /** @description A value computed by the safe expression engine. */
    ExpressionRef: {
      $expr: string;
    };
    FramePolicy: {
      'content-security-policy': string;
      /** @constant */
      'x-frame-options'?: 'DENY';
    };
    Health: {
      /** @enum {string} */
      status: 'ok' | 'degraded' | 'error';
      service: string;
      version: string;
      checks: {
        [key: string]: {
          /** @enum {string} */
          status: 'up' | 'down';
          detail?: string;
        };
      };
    };
    HubConnector: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      adapterType: string;
      platform: string;
      config: unknown;
      version: number;
    };
    IdentityProvider: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      /** @description Optimistic-lock version; send as If-Match: "<version>" */
      version: number;
      /** @enum {string} */
      protocol: 'oidc' | 'saml';
      displayName: string;
      domainHints: string[];
      jitProvisioning: boolean;
      scimEnabled: boolean;
      /** @enum {string} */
      status: 'draft' | 'active' | 'disabled';
    };
    IdentityProviderDetail: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      /** @description Optimistic-lock version; send as If-Match: "<version>" */
      version: number;
      /** @enum {string} */
      protocol: 'oidc' | 'saml';
      displayName: string;
      domains: string[];
      jitProvisioning: boolean;
      scimEnabled: boolean;
      /** @enum {string} */
      status: 'draft' | 'active' | 'disabled';
      config: {
        [key: string]: unknown;
      };
      endpoints: {
        [key: string]: string | string[];
      };
    };
    IdentityProviderPage: {
      data: components['schemas']['IdentityProvider'][];
      page: {
        limit: number;
        nextCursor: string | null;
        sort: string;
      };
    };
    Inline113ae44d83: DesignerJson;
    InstantiateTemplate: {
      name: string;
      description?: string;
    };
    IssuedScimToken: {
      /** Format: uuid */
      id: string;
      prefix: string;
      createdAt: string;
      expiresAt: string | null;
      lastUsedAt: string | null;
      revokedAt: string | null;
      /** @description @secret shown once */
      token: string;
      scimBaseUrl: string;
    };
    JsonValue: components['schemas']['Inline113ae44d83'];
    LaunchEmbedded: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      connectorId: string;
      conversationId: string;
    };
    LaunchIntentCreate: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      connectorId: string;
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      interactionId: string;
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      userId: string;
      /**
       * @default push
       * @enum {string}
       */
      delivery: 'push' | 'fragment';
      ttlSeconds?: number;
    };
    LaunchIntentCreated: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      intentId: string;
      /** Format: date-time */
      expiresAt: string;
      /** @enum {string} */
      delivery: 'push' | 'fragment';
      code?: string;
    };
    LaunchJws: {
      token: string;
    };
    LaunchParamSignal: {
      params: string[];
    };
    LaunchPreview: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      scriptVersionId: string;
      /**
       * @default {
       *       "channel": "voice",
       *       "attributes": {}
       *     }
       */
      mockInteraction: {
        /**
         * @default voice
         * @enum {string}
         */
        channel: 'voice' | 'chat' | 'email' | 'sms' | 'whatsapp' | 'social' | 'video' | 'callback';
        /** @default {} */
        attributes: {
          [key: string]: string | number | boolean;
        };
      };
      /** @default false */
      liveDataSources: boolean;
    };
    LaunchRedeem: {
      code: string;
    };
    LaunchResult: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      sessionId: string;
      path: string;
    };
    LaunchSocketTicket: {
      ticket: string;
      expiresIn: number;
      /** @constant */
      namespace: '/launch';
    };
    LogoutResponse: {
      redirectUrl: string;
    };
    Me: {
      principal: {
        /** @enum {string} */
        type: 'user' | 'service';
        id: string;
        /** Format: uuid */
        tenantId: string;
      };
      permissions: string[];
    };
    MePermissions: {
      principal: {
        /** @enum {string} */
        type: 'user' | 'service';
        id: string;
        /** Format: uuid */
        tenantId: string;
      };
      roles: string[];
      rules: unknown[][];
      separationOfDuties: boolean;
    };
    NodeCommentInput: {
      nodeId: string;
      text: string;
      /** @default [] */
      mentions: string[];
    };
    NodeCommentReply: {
      text: string;
      /** @default [] */
      mentions: string[];
    };
    NodeCommentThread: {
      /** Format: uuid */
      id: string;
      nodeId: string;
      resolved: boolean;
      messages: {
        /** Format: uuid */
        id: string;
        author: string;
        text: string;
        mentions: string[];
        createdAt: string;
      }[];
      version: number;
    };
    OAuthTokenResponse: {
      access_token: string;
      /** @constant */
      token_type: 'Bearer';
      expires_in: number;
      scope: string;
    };
    OutboxStatus: {
      pending: number;
      published: number;
      dead: number;
      oldestPendingAt: string | null;
      deadEvents: {
        /** Format: uuid */
        id: string;
        eventType: string;
        attempts: number;
        lastError: string | null;
      }[];
    };
    PackageImportRequest: {
      package: {
        [key: string]: unknown;
      };
      /** @default {} */
      integrationMappings: {
        [key: string]: {
          key: string;
          version: number;
        };
      };
      /** @default {} */
      secretMappings: {
        [key: string]: string;
      };
    };
    PermissionVocabulary: {
      resources: string[];
      actions: {
        [key: string]: string[];
      };
      scopes: {
        [key: string]: string[];
      };
      systemRoles: {
        key: string;
        labelKey: string;
        matrix: {
          [key: string]: string[];
        };
      }[];
    };
    Predicate:
      | {
          all: components['schemas']['Predicate'][];
        }
      | {
          any: components['schemas']['Predicate'][];
        }
      | {
          not: components['schemas']['Predicate'];
        }
      | {
          fact: string;
          /** @enum {string} */
          op:
            | 'eq'
            | 'neq'
            | 'gt'
            | 'gte'
            | 'lt'
            | 'lte'
            | 'in'
            | 'notIn'
            | 'contains'
            | 'startsWith'
            | 'matches'
            | 'exists'
            | 'between'
            | 'before'
            | 'after';
          value?: components['schemas']['JsonValue'];
        }
      | components['schemas']['ExpressionRef'];
    ProblemDetails: {
      type: string;
      title: string;
      status: number;
      detail?: string;
      instance?: string;
      code: string;
      correlationId?: string;
      errors?: {
        path: string;
        message: string;
        code?: string;
      }[];
    };
    PublishSharedScreenVersion: {
      semver: string;
      changeNote: string;
      fragment: components['schemas']['ScreenFragment'];
    };
    ReleaseSchedule: {
      /** Format: date-time */
      at: string;
    };
    RequeueResult: {
      requeued: boolean;
    };
    ResolveCommentThread: {
      resolved: boolean;
      version: number;
    };
    ReviewScriptVersion:
      | {
          /** @constant */
          decision: 'approved';
          comment?: string;
        }
      | {
          /** @constant */
          decision: 'rejected';
          reason: string;
          comment?: string;
        }
      | {
          /** @constant */
          decision: 'commented';
          comment: string;
        };
    Role: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      /** @description Optimistic-lock version; send as If-Match: "<version>" */
      version: number;
      name: string;
      description: string | null;
      permissions: string[];
      isSystem: boolean;
    };
    RolePage: {
      data: components['schemas']['Role'][];
      page: {
        limit: number;
        nextCursor: string | null;
        sort: string;
      };
    };
    RoleScopeAssignment: {
      role: string;
      scope: {
        campaignIds?: '*' | string[];
        teamIds?: '*' | string[];
        siteIds?: '*' | string[];
      };
    };
    RollbackRelease: {
      targetNumber: number;
      /** Format: uuid */
      expectedCurrentVersionId: string;
    };
    RotateSpCredential: {
      /** @enum {string} */
      use: 'signing' | 'encryption';
    };
    ScimBulkRequest: {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'];
      failOnErrors?: number;
      Operations: {
        /** @enum {string} */
        method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        path: string;
        bulkId?: string;
        data?: unknown;
      }[];
    };
    ScimResource: {
      schemas: string[];
    } & {
      [key: string]: unknown;
    };
    ScimToken: {
      /** Format: uuid */
      id: string;
      prefix: string;
      createdAt: string;
      expiresAt: string | null;
      lastUsedAt: string | null;
      revokedAt: string | null;
    };
    Screen: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      /** @description Optimistic-lock version; send as If-Match: "<version>" */
      version: number;
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      scriptVersionId: string;
      key: string;
      title: string | null;
      entry: boolean;
    };
    ScreenDetail: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      /** @description Optimistic-lock version; send as If-Match: "<version>" */
      version: number;
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      scriptVersionId: string;
      key: string;
      title: string | null;
      entry: boolean;
      layoutRoot: unknown;
      components: components['schemas']['Component'][];
    };
    ScreenFragment: {
      pages: {
        [key: string]: unknown;
      }[];
      /** @default [] */
      variables: {
        [key: string]: unknown;
      }[];
      /** @default [] */
      dataSources: {
        [key: string]: unknown;
      }[];
      /** @default {} */
      messages: {
        [key: string]: {
          [key: string]: string;
        };
      };
    };
    ScreenPage: {
      data: components['schemas']['Screen'][];
      page: {
        limit: number;
        nextCursor: string | null;
        sort: string;
      };
    };
    Script: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      /** @description Optimistic-lock version; send as If-Match: "<version>" */
      version: number;
      name: string;
      description: string | null;
      /** @enum {string} */
      status: 'draft' | 'active' | 'archived';
      tags: string[];
      currentVersionId: string | null;
    };
    ScriptPage: {
      data: components['schemas']['Script'][];
      page: {
        limit: number;
        nextCursor: string | null;
        sort: string;
      };
    };
    ScriptResolution: {
      /** @enum {string} */
      outcome: 'resolved' | 'no_match';
      reason?: string;
      campaignId: string;
      assignmentId?: string;
      scriptId?: string;
      version?: {
        id: string;
        number: number;
        semver: string | null;
        checksum: string;
      };
      variant?: {
        key: string;
        bucket: number;
      };
      workingHours: {
        configured: boolean;
        open: boolean;
      };
      trace: {
        evaluated: {
          assignmentId: string;
          priority: number;
          specificity: number;
          eligible: boolean;
          reasons: string[];
          factsRead: string[];
        }[];
        ranking: string[];
        tie: {
          assignmentIds: string[];
          /** @enum {string} */
          brokenBy: 'recency' | 'id';
        } | null;
        at: string;
      };
      /** @enum {string} */
      cache: 'hit' | 'miss' | 'bypass';
    };
    ScriptResolutionRequest: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      campaignId?: string;
      campaignCode?: string;
      external?: {
        platform: string;
        kind: string;
        externalId: string;
      };
      /** @enum {string} */
      channel: 'voice' | 'chat' | 'email' | 'sms' | 'whatsapp' | 'social' | 'video' | 'callback';
      locale?: string;
      queue?: string;
      skills?: string[];
      segment?: string;
      attributes?: {
        [key: string]: string | number | boolean | null | (string | number | boolean)[];
      };
      agent?: {
        id: string;
        attributes?: {
          [key: string]: string | number | boolean | null | (string | number | boolean)[];
        };
      };
      interactionId?: string;
      stickyKey?: string;
      /** Format: date-time */
      at?: string;
    };
    ScriptVersion: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      /** @description Optimistic-lock version; send as If-Match: "<version>" */
      version: number;
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      scriptId: string;
      number: number;
      /** @enum {string} */
      state: 'draft' | 'in_review' | 'approved' | 'published' | 'retired';
      schemaVersion: string;
      /** @enum {string} */
      documentEncoding: 'json' | 'gzip';
      documentSize: number;
      checksum: string;
      publishedAt: string | null;
      semver: string | null;
      changeNote: string | null;
      submittedAt: string | null;
      approvedAt: string | null;
      retiredAt: string | null;
      reviewRound: number;
      createdBy: string;
      screens: {
        /** Format: uuid */
        sharedScreenId: string;
        versionNumber: number;
        /** @enum {string} */
        mode: 'linked' | 'detached';
        pageIds: string[];
      }[];
      document: {
        [key: string]: unknown;
      };
    };
    ScriptVersionDiff: {
      from: {
        number: number;
        semver: string | null;
        checksum: string;
      };
      to: {
        number: number;
        semver: string | null;
        checksum: string;
      };
      patch: {
        /** @enum {string} */
        op: 'add' | 'remove' | 'replace';
        path: string;
        value?: unknown;
      }[];
      summary: {
        lines: string[];
        totalChanges: number;
      } & {
        [key: string]: unknown;
      };
    };
    ScriptVersionPage: {
      data: components['schemas']['ScriptVersionSummary'][];
      page: {
        limit: number;
        nextCursor: string | null;
        sort: string;
      };
    };
    ScriptVersionReview: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      round: number;
      reviewer: string;
      /** @enum {string} */
      decision: 'approved' | 'rejected' | 'commented';
      comment: string | null;
      reason: string | null;
      /** Format: date-time */
      createdAt: string;
    };
    ScriptVersionSummary: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      /** @description Optimistic-lock version; send as If-Match: "<version>" */
      version: number;
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      scriptId: string;
      number: number;
      /** @enum {string} */
      state: 'draft' | 'in_review' | 'approved' | 'published' | 'retired';
      schemaVersion: string;
      /** @enum {string} */
      documentEncoding: 'json' | 'gzip';
      documentSize: number;
      checksum: string;
      publishedAt: string | null;
      semver: string | null;
      changeNote: string | null;
      submittedAt: string | null;
      approvedAt: string | null;
      retiredAt: string | null;
      reviewRound: number;
      createdBy: string;
    };
    SecretMetadata: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      /** @description Optimistic-lock version; send as If-Match: "<version>" */
      version: number;
      name: string;
      /** @enum {string} */
      kind: 'password' | 'api_key' | 'oauth_client' | 'certificate' | 'generic';
      keyVersion: number;
      rotatedAt: string | null;
      lastUsedAt: string | null;
    };
    SecretMetadataPage: {
      data: components['schemas']['SecretMetadata'][];
      page: {
        limit: number;
        nextCursor: string | null;
        sort: string;
      };
    };
    ServiceClient: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      /** @description Optimistic-lock version; send as If-Match: "<version>" */
      version: number;
      /** Format: uuid */
      clientId: string;
      name: string;
      /** @enum {string} */
      authMethod: 'client_secret_basic' | 'client_secret_post' | 'tls_client_auth';
      scopes: string[];
      /** @enum {string} */
      status: 'active' | 'disabled';
      certificateThumbprint: string | null;
      lastUsedAt: string | null;
      tokenEndpoint: string;
    };
    ServiceClientWithSecret: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      /** @description Optimistic-lock version; send as If-Match: "<version>" */
      version: number;
      /** Format: uuid */
      clientId: string;
      name: string;
      /** @enum {string} */
      authMethod: 'client_secret_basic' | 'client_secret_post' | 'tls_client_auth';
      scopes: string[];
      /** @enum {string} */
      status: 'active' | 'disabled';
      certificateThumbprint: string | null;
      lastUsedAt: string | null;
      tokenEndpoint: string;
      /** @description @secret shown once */
      clientSecret: string | null;
    };
    Session: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      /** @description Optimistic-lock version; send as If-Match: "<version>" */
      version: number;
      interactionId: string | null;
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      userId: string;
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      scriptVersionId: string;
      assignmentId: string | null;
      /** @enum {string} */
      state: 'launching' | 'paused' | 'active' | 'wrapup' | 'completed' | 'abandoned' | 'expired';
      sequence: number;
      /** Format: date-time */
      startedAt: string;
      endedAt: string | null;
      checksum: string;
    };
    SessionEvent: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      seq: number;
      type: string;
      payload: unknown;
      /** Format: date-time */
      occurredAt: string;
    };
    SessionEventPage: {
      data: components['schemas']['SessionEvent'][];
      page: {
        limit: number;
        nextCursor: string | null;
        sort: string;
      };
    };
    SessionList: {
      data: components['schemas']['SessionSummary'][];
    };
    SessionPage: {
      data: components['schemas']['Session'][];
      page: {
        limit: number;
        nextCursor: string | null;
        sort: string;
      };
    };
    SessionSettings: {
      idleTimeoutMinutes?: number;
      absoluteTimeoutHours?: number;
      maxConcurrentSessions?: number;
      /** @enum {string} */
      onLimit?: 'evict_oldest' | 'deny';
    };
    SessionsTerminated: {
      terminated: number;
    };
    SessionSummary: {
      /** Format: uuid */
      id: string;
      /** @enum {string} */
      kind: 'sso' | 'break_glass';
      /** @enum {string} */
      protocol: 'oidc' | 'saml' | 'local';
      idpId: string | null;
      app: string;
      createdAt: string;
      lastSeenAt: string;
      expiresAt: string;
      ip: string;
      userAgent: string;
      current: boolean;
    };
    SetUserRoles: {
      roles: string[];
    };
    SiemDestination: {
      /** Format: uuid */
      id: string;
      name: string;
      kind: string;
      format: string;
      config: {
        [key: string]: unknown;
      };
      secretRef: string | null;
      enabled: boolean;
      version: number;
      delivery: {
        lastSeq: string;
        attempts: number;
        lastError: string | null;
        deliveredAt: string | null;
      } | null;
    };
    SimulatedInteraction: {
      /** @enum {string} */
      channel: 'voice' | 'chat' | 'email' | 'sms' | 'whatsapp' | 'social' | 'video' | 'callback';
      /**
       * @default inbound
       * @enum {string}
       */
      direction: 'inbound' | 'outbound';
      agentPlatformUserId: string;
      /** Format: email */
      agentEmail?: string;
      queue?: string;
      customerName?: string;
      customerAddress?: string;
      subject?: string;
      message?: string;
      /** @default {} */
      attributes: {
        [key: string]: string | number | boolean;
      };
      /** @default false */
      autoConnect: boolean;
    };
    SimulatorAction: {
      /** @enum {string} */
      action: 'connect' | 'hold' | 'resume' | 'transfer' | 'customerMessage' | 'wrapup' | 'end';
      message?: string;
      transferToPlatformUserId?: string;
    };
    SimulatorState: {
      connectorId: string;
      interactions: {
        [key: string]: unknown;
      }[];
      commands: {
        [key: string]: unknown;
      }[];
    };
    Tenant: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      slug: string;
      name: string;
      region: string;
      /** @enum {string} */
      status: 'provisioning' | 'active' | 'suspended' | 'deleting';
      settings: components['schemas']['TenantSettings'];
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      version: number;
    };
    TenantSettings: {
      defaultLocale?: string;
      allowedOrigins?: string[];
      sessionTimeoutMinutes?: number;
      session?: components['schemas']['SessionSettings'];
      security?: {
        /** @default [] */
        ipAllowlist: string[];
      };
      brand?: {
        name: string;
        primaryColor: string;
        /** @default  */
        logoUrl: '' | string;
        /** @default  */
        agentTitle: string;
        /** @default  */
        waitingText: string;
      };
      classifications?: {
        path: string;
        /** @enum {string} */
        classification: 'public' | 'internal' | 'pii' | 'pci';
        purpose: string;
      }[];
      audit?: {
        retentionDays: number;
        sessionRetentionDays: number;
        analyticsRetentionDays: number;
        legalHold: boolean;
      };
      authz?: {
        separationOfDuties: boolean;
      };
      embedding?: components['schemas']['EmbeddingSettings'];
    } & {
      [key: string]: unknown;
    };
    UpdateAssignment: {
      priority?: number;
      /** @enum {string} */
      versionPolicy?: 'pinned' | 'latestPublished';
      pinnedVersionId?: string | null;
      effectiveFrom?: string | null;
      effectiveTo?: string | null;
      conditions?: components['schemas']['AssignmentConditions'];
      expression?: components['schemas']['Predicate'] | null;
      variants?: components['schemas']['AbVariants'] | null;
    };
    UpdateCampaign: {
      name?: string;
      code?: string;
      locales?: string[];
      externalMappings?: components['schemas']['CampaignExternalMapping'][];
      workingHours?: components['schemas']['WorkingHours'] | null;
      outcomeSet?: components['schemas']['CampaignOutcome'][];
      description?: string | null;
      /** @enum {string} */
      status?: 'draft' | 'active' | 'paused' | 'archived';
      defaultLocale?: string;
      channels?: (
        'voice' | 'chat' | 'email' | 'sms' | 'whatsapp' | 'social' | 'video' | 'callback'
      )[];
      queues?: string[];
      startsAt?: string | null;
      endsAt?: string | null;
    };
    UpdateCustomRole: {
      description?: string;
      matrix: {
        [key: string]: {
          actions: (
            | 'read'
            | 'create'
            | 'update'
            | 'delete'
            | 'publish'
            | 'approve'
            | 'execute'
            | 'reveal'
            | 'export'
            | 'manage'
          )[];
          /**
           * @default all
           * @enum {string}
           */
          scope: 'all' | 'campaign' | 'team' | 'site' | 'own';
          /** @default false */
          revealPii: boolean;
        };
      };
    };
    UpdateIdentityProvider: {
      displayName?: string;
      domains?: string[];
      jitProvisioning?: boolean;
      scimEnabled?: boolean;
      /** @enum {string} */
      status?: 'draft' | 'active' | 'disabled';
      config?:
        | {
            /** @enum {string} */
            vendor: 'entra' | 'okta' | 'keycloak' | 'google' | 'adfs' | 'ping' | 'generic';
            /** Format: uri */
            issuer: string;
            clientId: string;
            /**
             * @default client_secret_basic
             * @enum {string}
             */
            clientAuth: 'client_secret_basic' | 'client_secret_post';
            scopes?: string[];
            authParams?: {
              [key: string]: string;
            };
            claims?: {
              email?: string;
              emailVerified?: string;
              displayName?: string;
              givenName?: string;
              familyName?: string;
              groups?: string;
              locale?: string;
            };
            acrValues?: string;
            /** @default true */
            linkByVerifiedEmail: boolean;
            /**
             * @default {
             *       "rules": [],
             *       "defaultRoles": []
             *     }
             */
            roleMapping: {
              /** @default [] */
              rules: {
                claim: string;
                equals: string;
                roles: string[];
              }[];
              /** @default [] */
              defaultRoles: string[];
            };
            /** @description @secret write-only */
            clientSecret?: string;
          }
        | {
            /** @enum {string} */
            vendor: 'entra' | 'okta' | 'keycloak' | 'google' | 'adfs' | 'ping' | 'generic';
            idpEntityId: string;
            /** Format: uri */
            ssoUrl: string;
            /** Format: uri */
            sloUrl?: string;
            idpCertificates: string[];
            nameIdFormat?: string;
            /** @default false */
            allowIdpInitiated: boolean;
            /** @default true */
            signRequests: boolean;
            /** @default false */
            requireEncryptedAssertions: boolean;
            authnContext?: string[];
            attributes?: {
              email?: string;
              emailVerified?: string;
              displayName?: string;
              givenName?: string;
              familyName?: string;
              groups?: string;
              locale?: string;
            };
            /** @default false */
            linkByVerifiedEmail: boolean;
            /**
             * @default {
             *       "rules": [],
             *       "defaultRoles": []
             *     }
             */
            roleMapping: {
              /** @default [] */
              rules: {
                claim: string;
                equals: string;
                roles: string[];
              }[];
              /** @default [] */
              defaultRoles: string[];
            };
          };
    };
    UpdateScript: {
      name?: string;
      description?: string | null;
      tags?: string[];
      /** @enum {string} */
      status?: 'draft' | 'active' | 'archived';
    };
    UpdateScriptDraft: components['schemas']['CreateScriptVersion'];
    UpdateServiceClient: {
      name?: string;
      scopes?: string[];
      /** @enum {string} */
      status?: 'active' | 'disabled';
    };
    UpdateSiemDestination: {
      enabled: boolean;
    };
    UpdateTenantSettings: {
      embedding?: components['schemas']['EmbeddingSettings'];
      defaultLocale?: string;
      allowedOrigins?: string[];
      sessionTimeoutMinutes?: number;
      session?: components['schemas']['SessionSettings'];
      security?: {
        /** @default [] */
        ipAllowlist: string[];
      };
      brand?: {
        name: string;
        primaryColor: string;
        /** @default  */
        logoUrl: '' | string;
        /** @default  */
        agentTitle: string;
        /** @default  */
        waitingText: string;
      };
      classifications?: {
        path: string;
        /** @enum {string} */
        classification: 'public' | 'internal' | 'pii' | 'pci';
        purpose: string;
      }[];
      audit?: {
        retentionDays: number;
        sessionRetentionDays: number;
        analyticsRetentionDays: number;
        legalHold: boolean;
      };
      authz?: {
        separationOfDuties: boolean;
      };
    };
    User: {
      /**
       * Format: uuid
       * @description UUIDv7 identifier
       */
      id: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
      /** @description Optimistic-lock version; send as If-Match: "<version>" */
      version: number;
      externalId: string | null;
      /** @description @pii */
      email: string;
      /** @description @pii */
      displayName: string;
      /** @enum {string} */
      status: 'invited' | 'active' | 'suspended' | 'deprovisioned';
      locale: string;
      roles: string[];
    };
    UserPage: {
      data: components['schemas']['User'][];
      page: {
        limit: number;
        nextCursor: string | null;
        sort: string;
      };
    };
    UserRoleAssignments: {
      /** Format: uuid */
      userId: string;
      roles: {
        name: string;
        source: string;
      }[];
    };
    VerbisPackage: {
      /** @constant */
      format: 'verbis-package';
      formatVersion: 1 | 2;
      manifest: {
        packageId: string;
        /** Format: date-time */
        createdAt: string;
        createdBy: string;
        sourceEnvironment: string;
        /** @default [] */
        targetEnvironments: string[];
        items: {
          /** @enum {string} */
          kind: 'script' | 'sharedScreen';
          name: string;
          semver: string;
          checksum: string;
        }[];
      };
      payload: {
        integrations?: {
          key: string;
          version: number;
          /** @enum {string} */
          protocol: 'rest' | 'soap' | 'graphql';
          definition: {
            /**
             * @default 1.1.0
             * @constant
             */
            schemaVersion: '1.1.0';
            /** Format: uri */
            baseUrl: string;
            /** Format: starts_with */
            endpoint: string;
            /**
             * @default GET
             * @enum {string}
             */
            method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
            /** @default {} */
            headers: {
              [key: string]: string;
            };
            /** @default {} */
            query: {
              [key: string]: string;
            };
            body?: unknown;
            /**
             * @default {
             *       "type": "none"
             *     }
             */
            auth:
              | {
                  /** @constant */
                  type: 'none';
                }
              | {
                  /** @constant */
                  type: 'apiKey';
                  /** Format: uuid */
                  secretRef: string;
                  /** @enum {string} */
                  placement: 'header' | 'query';
                  name: string;
                }
              | {
                  /** @constant */
                  type: 'basic';
                  /** Format: uuid */
                  secretRef: string;
                }
              | {
                  /** @constant */
                  type: 'bearer';
                  /** Format: uuid */
                  secretRef: string;
                }
              | {
                  /** @constant */
                  type: 'oauth2-client-credentials';
                  /** Format: uuid */
                  secretRef: string;
                  /** Format: uri */
                  tokenUrl: string;
                  scope?: string;
                }
              | {
                  /** @constant */
                  type: 'oauth2-password';
                  /** Format: uuid */
                  secretRef: string;
                  /** Format: uri */
                  tokenUrl: string;
                  scope?: string;
                }
              | {
                  /** @constant */
                  type: 'mtls';
                  /** Format: uuid */
                  secretRef: string;
                }
              | {
                  /** @constant */
                  type: 'hmac';
                  /** Format: uuid */
                  secretRef: string;
                  /** @default X-Signature */
                  header: string;
                }
              | {
                  /** @constant */
                  type: 'wsSecurity';
                  /** Format: uuid */
                  secretRef: string;
                };
            /** @default {} */
            inputSchema: {
              [key: string]: unknown;
            };
            /** @default {} */
            outputSchema: {
              [key: string]: unknown;
            };
            /** @default {} */
            mapping: {
              request?: string;
              response?: string;
            };
            /** @default {} */
            profiles: {
              dev?: {
                /** Format: uri */
                baseUrl: string;
                auth:
                  | {
                      /** @constant */
                      type: 'none';
                    }
                  | {
                      /** @constant */
                      type: 'apiKey';
                      /** Format: uuid */
                      secretRef: string;
                      /** @enum {string} */
                      placement: 'header' | 'query';
                      name: string;
                    }
                  | {
                      /** @constant */
                      type: 'basic';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'bearer';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-client-credentials';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-password';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'mtls';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'hmac';
                      /** Format: uuid */
                      secretRef: string;
                      /** @default X-Signature */
                      header: string;
                    }
                  | {
                      /** @constant */
                      type: 'wsSecurity';
                      /** Format: uuid */
                      secretRef: string;
                    };
              };
              test?: {
                /** Format: uri */
                baseUrl: string;
                auth:
                  | {
                      /** @constant */
                      type: 'none';
                    }
                  | {
                      /** @constant */
                      type: 'apiKey';
                      /** Format: uuid */
                      secretRef: string;
                      /** @enum {string} */
                      placement: 'header' | 'query';
                      name: string;
                    }
                  | {
                      /** @constant */
                      type: 'basic';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'bearer';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-client-credentials';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-password';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'mtls';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'hmac';
                      /** Format: uuid */
                      secretRef: string;
                      /** @default X-Signature */
                      header: string;
                    }
                  | {
                      /** @constant */
                      type: 'wsSecurity';
                      /** Format: uuid */
                      secretRef: string;
                    };
              };
              prod?: {
                /** Format: uri */
                baseUrl: string;
                auth:
                  | {
                      /** @constant */
                      type: 'none';
                    }
                  | {
                      /** @constant */
                      type: 'apiKey';
                      /** Format: uuid */
                      secretRef: string;
                      /** @enum {string} */
                      placement: 'header' | 'query';
                      name: string;
                    }
                  | {
                      /** @constant */
                      type: 'basic';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'bearer';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-client-credentials';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-password';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'mtls';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'hmac';
                      /** Format: uuid */
                      secretRef: string;
                      /** @default X-Signature */
                      header: string;
                    }
                  | {
                      /** @constant */
                      type: 'wsSecurity';
                      /** Format: uuid */
                      secretRef: string;
                    };
              };
            };
            mock?: {
              /** @default false */
              enabled: boolean;
              response: unknown;
            };
            /** @default [] */
            mockScenarios: {
              key: string;
              /** @enum {string} */
              kind: 'success' | 'empty' | 'error' | 'delay';
              response: unknown;
              /** @default 0 */
              delayMs: number;
            }[];
            pendingPromotion?: {
              requestedBy: string;
              /** @enum {string} */
              from: 'dev' | 'test';
              profile: {
                /** Format: uri */
                baseUrl: string;
                auth:
                  | {
                      /** @constant */
                      type: 'none';
                    }
                  | {
                      /** @constant */
                      type: 'apiKey';
                      /** Format: uuid */
                      secretRef: string;
                      /** @enum {string} */
                      placement: 'header' | 'query';
                      name: string;
                    }
                  | {
                      /** @constant */
                      type: 'basic';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'bearer';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-client-credentials';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-password';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'mtls';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'hmac';
                      /** Format: uuid */
                      secretRef: string;
                      /** @default X-Signature */
                      header: string;
                    }
                  | {
                      /** @constant */
                      type: 'wsSecurity';
                      /** Format: uuid */
                      secretRef: string;
                    };
              };
              /** Format: date-time */
              requestedAt: string;
              reason: string;
            };
            soap?: {
              /** Format: uri */
              namespace: string;
              operation: string;
              action: string;
            };
            graphql?: {
              query: string;
              operationName?: string;
              /** @default 8 */
              maxDepth: number;
              /** @default 200 */
              maxComplexity: number;
            };
          };
          policy: {
            /** @default [] */
            allowedOrigins: string[];
            /** @default false */
            allowHttp: boolean;
            /** @default 5000 */
            timeoutMs: number;
            /** @default 1048576 */
            maxResponseBytes: number;
            /** @default 2 */
            retries: number;
            /** @default 5 */
            breakerThreshold: number;
            /** @default 30000 */
            breakerResetMs: number;
            /** @default 10 */
            concurrency: number;
            /** @default 0 */
            cacheTtlSeconds: number;
            /** @default true */
            containsPii: boolean;
            /** @default [] */
            piiPaths: string[];
            fallback?: unknown;
          };
          secretRefs: string[];
        }[];
        scripts: {
          name: string;
          description: string | null;
          tags: string[];
          semver: string;
          changeNote: string | null;
          document: {
            [key: string]: unknown;
          };
          checksum: string;
          /** @default [] */
          sharedScreens: {
            key: string;
            semver: string;
            /** @enum {string} */
            mode: 'linked' | 'detached';
          }[];
        }[];
        /** @default [] */
        sharedScreens: {
          key: string;
          name: string;
          semver: string;
          fragment: {
            [key: string]: unknown;
          };
          checksum: string;
        }[];
      };
      checksums: {
        payload: string;
      };
      signature: {
        /** @constant */
        alg: 'EdDSA';
        kid: string;
        value: string;
      };
    };
    WorkingHours: {
      timezone: string;
      weekly: {
        [key: string]: {
          from: string;
          to: string;
        }[];
      };
      /** @default [] */
      holidays: string[];
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  'BreakGlass.login': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['BreakGlassLogin'];
      };
    };
    responses: {
      /** @description Signed in; the session cookie is set */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['BreakGlassLoginResponse'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Auth.discover': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['DiscoverRequest'];
      };
    };
    responses: {
      /** @description Providers to sign in with */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['DiscoverResponse'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Auth.login': {
    parameters: {
      query: {
        tenant?: string;
        idp?: string;
        app: string;
        returnTo?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Redirect to the IdP */
      302: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Browser protocol endpoint: failures redirect back to the app with ?authError=<code>, or RFC 7807 */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Auth.logout': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Where to go next */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LogoutResponse'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Auth.backchannelLogout': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Sessions ended */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 6749 §5.2) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
            error_description?: string;
          };
        };
      };
    };
  };
  'Auth.frontchannelLogout': {
    parameters: {
      query?: {
        iss?: string;
        sid?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Empty page */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Browser protocol endpoint: failures redirect back to the app with ?authError=<code>, or RFC 7807 */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Auth.oidcCallback': {
    parameters: {
      query?: {
        state?: string;
        code?: string;
        error?: string;
        iss?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Redirect to the app */
      302: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Browser protocol endpoint: failures redirect back to the app with ?authError=<code>, or RFC 7807 */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Saml.acs': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        idp: string;
        tenant: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Redirect to the app */
      302: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Browser protocol endpoint: failures redirect back to the app with ?authError=<code>, or RFC 7807 */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Saml.metadata': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        idp: string;
        tenant: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description SP metadata XML */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Browser protocol endpoint: failures redirect back to the app with ?authError=<code>, or RFC 7807 */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Saml.sloRedirect': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        idp: string;
        tenant: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Redirect */
      302: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Browser protocol endpoint: failures redirect back to the app with ?authError=<code>, or RFC 7807 */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Saml.sloPost': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        idp: string;
        tenant: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Redirect */
      302: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Browser protocol endpoint: failures redirect back to the app with ?authError=<code>, or RFC 7807 */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Auth.session': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The session */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuthSession'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Health.health': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Healthy */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Health'];
        };
      };
      /** @description Unhealthy */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Health'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Health.live': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Process is alive */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Health'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Health.ready': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Ready */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Health'];
        };
      };
      /** @description Not ready */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Health'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'OAuth2.token': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Access token (internal JWT, ≤ 5 minutes) */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['OAuthTokenResponse'];
        };
      };
      /** @description Error (RFC 6749 §5.2) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
            error_description?: string;
          };
        };
      };
    };
  };
  'Scim.bulk': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/scim+json': components['schemas']['ScimBulkRequest'];
      };
    };
    responses: {
      /** @description BulkResponse */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScimResource'];
        };
      };
      /** @description Error (RFC 7644 §3.12) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/scim+json': {
            schemas: string[];
            status: string;
            scimType?: string;
            detail?: string;
          };
        };
      };
    };
  };
  'Scim.listGroups': {
    parameters: {
      query?: {
        filter?: string;
        startIndex?: number;
        count?: number;
        excludedAttributes?: string;
        attributes?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description ListResponse */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScimResource'];
        };
      };
      /** @description Error (RFC 7644 §3.12) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/scim+json': {
            schemas: string[];
            status: string;
            scimType?: string;
            detail?: string;
          };
        };
      };
    };
  };
  'Scim.createGroup': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/scim+json': {
          schemas?: string[];
          displayName: string;
          externalId?: string | null;
          members?: ({
            value: string;
          } & {
            [key: string]: unknown;
          })[];
        } & {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Group */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScimResource'];
        };
      };
      /** @description Error (RFC 7644 §3.12) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/scim+json': {
            schemas: string[];
            status: string;
            scimType?: string;
            detail?: string;
          };
        };
      };
    };
  };
  'Scim.getGroup': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Group */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScimResource'];
        };
      };
      /** @description Error (RFC 7644 §3.12) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/scim+json': {
            schemas: string[];
            status: string;
            scimType?: string;
            detail?: string;
          };
        };
      };
    };
  };
  'Scim.replaceGroup': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/scim+json': {
          schemas?: string[];
          displayName: string;
          externalId?: string | null;
          members?: ({
            value: string;
          } & {
            [key: string]: unknown;
          })[];
        } & {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Group */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScimResource'];
        };
      };
      /** @description Error (RFC 7644 §3.12) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/scim+json': {
            schemas: string[];
            status: string;
            scimType?: string;
            detail?: string;
          };
        };
      };
    };
  };
  'Scim.deleteGroup': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Deleted */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7644 §3.12) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/scim+json': {
            schemas: string[];
            status: string;
            scimType?: string;
            detail?: string;
          };
        };
      };
    };
  };
  'Scim.patchGroup': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/scim+json': {
          schemas: string[];
          Operations: ({
            op: string;
            path?: string;
            value?: unknown;
          } & {
            [key: string]: unknown;
          })[];
        } & {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Group */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScimResource'];
        };
      };
      /** @description Error (RFC 7644 §3.12) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/scim+json': {
            schemas: string[];
            status: string;
            scimType?: string;
            detail?: string;
          };
        };
      };
    };
  };
  'Scim.resourceTypes': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description ListResponse */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScimResource'];
        };
      };
      /** @description Error (RFC 7644 §3.12) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/scim+json': {
            schemas: string[];
            status: string;
            scimType?: string;
            detail?: string;
          };
        };
      };
    };
  };
  'Scim.config': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description ServiceProviderConfig */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScimResource'];
        };
      };
      /** @description Error (RFC 7644 §3.12) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/scim+json': {
            schemas: string[];
            status: string;
            scimType?: string;
            detail?: string;
          };
        };
      };
    };
  };
  'Scim.listUsers': {
    parameters: {
      query?: {
        filter?: string;
        startIndex?: number;
        count?: number;
        excludedAttributes?: string;
        attributes?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description ListResponse */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScimResource'];
        };
      };
      /** @description Error (RFC 7644 §3.12) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/scim+json': {
            schemas: string[];
            status: string;
            scimType?: string;
            detail?: string;
          };
        };
      };
    };
  };
  'Scim.createUser': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/scim+json': {
          schemas?: string[];
          userName: string;
          externalId?: string | null;
          name?: {
            formatted?: string;
            givenName?: string;
            familyName?: string;
          } & {
            [key: string]: unknown;
          };
          displayName?: string;
          emails?: ({
            value: string;
            type?: string;
            primary?: boolean | string;
          } & {
            [key: string]: unknown;
          })[];
          active?: boolean | string;
          locale?: string;
          'urn:verbis:params:scim:schemas:extension:cti:2.0:User'?: {
            identities: (
              | {
                  platform: string;
                  id: string;
                }
              | {
                  platform: string;
                  platformUserId: string;
                }
            )[];
          } & {
            [key: string]: unknown;
          };
        } & {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description User */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScimResource'];
        };
      };
      /** @description Error (RFC 7644 §3.12) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/scim+json': {
            schemas: string[];
            status: string;
            scimType?: string;
            detail?: string;
          };
        };
      };
    };
  };
  'Scim.getUser': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description User */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScimResource'];
        };
      };
      /** @description Error (RFC 7644 §3.12) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/scim+json': {
            schemas: string[];
            status: string;
            scimType?: string;
            detail?: string;
          };
        };
      };
    };
  };
  'Scim.replaceUser': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/scim+json': {
          schemas?: string[];
          userName: string;
          externalId?: string | null;
          name?: {
            formatted?: string;
            givenName?: string;
            familyName?: string;
          } & {
            [key: string]: unknown;
          };
          displayName?: string;
          emails?: ({
            value: string;
            type?: string;
            primary?: boolean | string;
          } & {
            [key: string]: unknown;
          })[];
          active?: boolean | string;
          locale?: string;
          'urn:verbis:params:scim:schemas:extension:cti:2.0:User'?: {
            identities: (
              | {
                  platform: string;
                  id: string;
                }
              | {
                  platform: string;
                  platformUserId: string;
                }
            )[];
          } & {
            [key: string]: unknown;
          };
        } & {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description User */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScimResource'];
        };
      };
      /** @description Error (RFC 7644 §3.12) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/scim+json': {
            schemas: string[];
            status: string;
            scimType?: string;
            detail?: string;
          };
        };
      };
    };
  };
  'Scim.deleteUser': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Deprovisioned */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7644 §3.12) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/scim+json': {
            schemas: string[];
            status: string;
            scimType?: string;
            detail?: string;
          };
        };
      };
    };
  };
  'Scim.patchUser': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/scim+json': {
          schemas: string[];
          Operations: ({
            op: string;
            path?: string;
            value?: unknown;
          } & {
            [key: string]: unknown;
          })[];
        } & {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description User */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScimResource'];
        };
      };
      /** @description Error (RFC 7644 §3.12) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/scim+json': {
            schemas: string[];
            status: string;
            scimType?: string;
            detail?: string;
          };
        };
      };
    };
  };
  'AdminWorkspace.createConnector': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          /** @enum {string} */
          adapterType:
            | 'genesys_cloud'
            | 'genesys_engage'
            | 'avaya_aes'
            | 'avaya_axp'
            | 'avaya_aacc'
            | 'amazon_connect'
            | 'cisco'
            | 'nice_cxone'
            | 'five9'
            | 'generic';
          platform: string;
          /** @enum {string} */
          status: 'draft' | 'active' | 'disabled';
          config: {
            [key: string]: components['schemas']['Inline113ae44d83'];
          };
          secretRefs: string[];
        };
      };
    };
    responses: {
      /** @description Connector */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AdminWorkspace.connector': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Connector */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AdminWorkspace.updateConnector': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          /** @enum {string} */
          adapterType:
            | 'genesys_cloud'
            | 'genesys_engage'
            | 'avaya_aes'
            | 'avaya_axp'
            | 'avaya_aacc'
            | 'amazon_connect'
            | 'cisco'
            | 'nice_cxone'
            | 'five9'
            | 'generic';
          platform: string;
          /** @enum {string} */
          status: 'draft' | 'active' | 'disabled';
          config: {
            [key: string]: components['schemas']['Inline113ae44d83'];
          };
          secretRefs: string[];
        };
      };
    };
    responses: {
      /** @description Connector */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AdminWorkspace.test': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Health */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AdminWorkspace.testIdentity': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Probe */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AdminWorkspace.discovery': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          /** Format: uri */
          url: string;
        };
      };
    };
    responses: {
      /** @description Discovery */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            issuer: string;
            authorizationEndpoint: string;
            tokenEndpoint: string;
            jwksUri: string;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AdminWorkspace.saml': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          xml: string;
        };
      };
    };
    responses: {
      /** @description Metadata */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            idpEntityId: string;
            ssoUrl: string;
            idpCertificates: string[];
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AdminWorkspace.issuers': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Issuers */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          }[];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AdminWorkspace.createIssuer': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          issuer: string;
          jwks: {
            keys: {
              /** @enum {string} */
              kty: 'EC' | 'OKP';
              kid: string;
              /** @enum {string} */
              crv: 'P-256' | 'Ed25519';
              x: string;
              y?: string;
              /** @enum {string} */
              alg?: 'ES256' | 'EdDSA';
              /** @constant */
              use?: 'sig';
            }[];
          };
          /** @enum {string} */
          status: 'active' | 'disabled';
        };
      };
    };
    responses: {
      /** @description Issuer */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AdminWorkspace.issuer': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          issuer: string;
          jwks: {
            keys: {
              /** @enum {string} */
              kty: 'EC' | 'OKP';
              kid: string;
              /** @enum {string} */
              crv: 'P-256' | 'Ed25519';
              x: string;
              y?: string;
              /** @enum {string} */
              alg?: 'ES256' | 'EdDSA';
              /** @constant */
              use?: 'sig';
            }[];
          };
          /** @enum {string} */
          status: 'active' | 'disabled';
        };
      };
    };
    responses: {
      /** @description Issuer */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AdminWorkspace.operations': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Metrics */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            windowHours: number;
            source: string;
            total: number;
            failed: number;
            errorRate: number | null;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Admin.outbox': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Counts and dead-lettered events */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['OutboxStatus'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Admin.requeue': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Requeued */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RequeueResult'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AdminWorkspace.privacyList': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Requests */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            kind: 'search' | 'export' | 'anonymize';
            /** @enum {string} */
            state: 'pending' | 'completed' | 'blocked';
            createdAt: string;
            count: number;
            version: number;
          }[];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AdminWorkspace.privacyCreate': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          /** @enum {string} */
          kind: 'search' | 'export' | 'anonymize';
          subject: string;
          /** @constant */
          verified: true;
          reason: string;
        };
      };
    };
    responses: {
      /** @description Request */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            kind: 'search' | 'export' | 'anonymize';
            /** @enum {string} */
            state: 'pending' | 'completed' | 'blocked';
            createdAt: string;
            count: number;
            version: number;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AdminWorkspace.export': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Records */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AdminWorkspace.process': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          /**
           * Format: uuid
           * @description UUIDv7 identifier
           */
          confirmRequestId: string;
        };
      };
    };
    responses: {
      /** @description Result */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            kind: 'search' | 'export' | 'anonymize';
            /** @enum {string} */
            state: 'pending' | 'completed' | 'blocked';
            createdAt: string;
            count: number;
            version: number;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AdminWorkspace.secretUsage': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Usage */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            data: {
              /** Format: uuid */
              id: string;
              key: string;
              protocol: string;
            }[];
            truncated: boolean;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AdminWorkspace.tenants': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Tenants */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            slug: string;
            name: string;
            region: string;
            /** @enum {string} */
            status: 'provisioning' | 'active' | 'suspended' | 'deleting';
            quotas: {
              maxUsers: number;
              maxActiveSessions: number;
              maxScripts: number;
            };
            features: {
              [key: string]: boolean;
            };
            /** Format: uuid */
            id: string;
            version: number;
          }[];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AdminWorkspace.createTenant': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          slug: string;
          name: string;
          region: string;
          /** @enum {string} */
          status: 'provisioning' | 'active' | 'suspended';
          quotas: {
            maxUsers: number;
            maxActiveSessions: number;
            maxScripts: number;
          };
          features: {
            [key: string]: boolean;
          };
        };
      };
    };
    responses: {
      /** @description Tenant */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            slug: string;
            name: string;
            region: string;
            /** @enum {string} */
            status: 'provisioning' | 'active' | 'suspended' | 'deleting';
            quotas: {
              maxUsers: number;
              maxActiveSessions: number;
              maxScripts: number;
            };
            features: {
              [key: string]: boolean;
            };
            /** Format: uuid */
            id: string;
            version: number;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AdminWorkspace.updateTenant': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          slug: string;
          name: string;
          region: string;
          /** @enum {string} */
          status: 'provisioning' | 'active' | 'suspended';
          quotas: {
            maxUsers: number;
            maxActiveSessions: number;
            maxScripts: number;
          };
          features: {
            [key: string]: boolean;
          };
        };
      };
    };
    responses: {
      /** @description Tenant */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            slug: string;
            name: string;
            region: string;
            /** @enum {string} */
            status: 'provisioning' | 'active' | 'suspended' | 'deleting';
            quotas: {
              maxUsers: number;
              maxActiveSessions: number;
              maxScripts: number;
            };
            features: {
              [key: string]: boolean;
            };
            /** Format: uuid */
            id: string;
            version: number;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AdminWorkspace.mapping': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json':
          | {
              platform: string;
              id: string;
            }
          | {
              platform: string;
              platformUserId: string;
            };
      };
    };
    responses: {
      /** @description User identity mapping */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Ai.reconcile': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Ai.settings': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Settings */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            version: number;
            config: {
              /** @default false */
              enabled: boolean;
              /** @default false */
              agentEnabled: boolean;
              /** @default unconfigured */
              endpointId: string;
              /** @default unconfigured */
              model: string;
              /** @default null */
              secretRef: string | null;
              /** @default 0 */
              monthlyTokens: number;
              /** @default 0 */
              monthlyMicroUsd: number;
              /** @default 0 */
              inputMicroUsdPerMillion: number;
              /** @default 0 */
              outputMicroUsdPerMillion: number;
              /** @default 2048 */
              maxOutputTokens: number;
            };
            endpoints: {
              id: string;
              /** @enum {string} */
              provider: 'anthropic' | 'azure' | 'onprem';
              residency: string;
              models: string[];
            }[];
            available: boolean;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Ai.save': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          version: number;
          config: {
            /** @default false */
            enabled?: boolean;
            /** @default false */
            agentEnabled?: boolean;
            /** @default unconfigured */
            endpointId?: string;
            /** @default unconfigured */
            model?: string;
            /** @default null */
            secretRef?: string | null;
            /** @default 0 */
            monthlyTokens?: number;
            /** @default 0 */
            monthlyMicroUsd?: number;
            /** @default 0 */
            inputMicroUsdPerMillion?: number;
            /** @default 0 */
            outputMicroUsdPerMillion?: number;
            /** @default 2048 */
            maxOutputTokens?: number;
          };
        };
      };
    };
    responses: {
      /** @description Settings */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            version: number;
            config: {
              /** @default false */
              enabled: boolean;
              /** @default false */
              agentEnabled: boolean;
              /** @default unconfigured */
              endpointId: string;
              /** @default unconfigured */
              model: string;
              /** @default null */
              secretRef: string | null;
              /** @default 0 */
              monthlyTokens: number;
              /** @default 0 */
              monthlyMicroUsd: number;
              /** @default 0 */
              inputMicroUsdPerMillion: number;
              /** @default 0 */
              outputMicroUsdPerMillion: number;
              /** @default 2048 */
              maxOutputTokens: number;
            };
            endpoints: {
              id: string;
              /** @enum {string} */
              provider: 'anthropic' | 'azure' | 'onprem';
              residency: string;
              models: string[];
            }[];
            available: boolean;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Ai.status': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Availability */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            enabled: boolean;
            agentEnabled: boolean;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Ai.generate': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          /** Format: uuid */
          requestId: string;
          /** @enum {string} */
          task: 'draft' | 'improve' | 'scenarios' | 'translate' | 'reply' | 'objection' | 'summary';
          /**
           * @default tr
           * @enum {string}
           */
          locale?: 'tr' | 'en';
          /** @default  */
          text?: string;
          document?: unknown;
          /** Format: uuid */
          scriptId?: string;
          /** Format: uuid */
          sessionId?: string;
          /**
           * @default neutral
           * @enum {string}
           */
          tone?: 'neutral' | 'warm' | 'formal' | 'simple';
          file?: {
            /** @enum {string} */
            kind: 'docx' | 'pdf';
            base64: string;
          };
        };
      };
    };
    responses: {
      /** @description Human-review suggestion */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            callId: string;
            /** @enum {string} */
            task:
              'draft' | 'improve' | 'scenarios' | 'translate' | 'reply' | 'objection' | 'summary';
            /** @constant */
            requiresHumanApproval: true;
            value: unknown;
            inputTokens: number;
            outputTokens: number;
            maskedCount: number;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Ai.usage': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Usage */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            month: string;
            tokens: number;
            microUsd: number;
            calls: number;
            pending: number;
            quotaTokens: number;
            quotaMicroUsd: number;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Analytics.dashboard': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Dashboard */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AnalyticsDashboard'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Analytics.eventCounts': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Counts */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['EventCounts'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Analytics.export': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        format: 'csv' | 'xlsx';
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AnalyticsOData.service': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AnalyticsOData.metadata': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AnalyticsOData.scripts': {
    parameters: {
      query: {
        from: string;
        to: string;
        campaignId?: string;
        teamId?: string;
        $top?: number;
        $skip?: number;
        $count?: 'true' | 'false';
        $select?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Analytics.schedules': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Analytics.schedule': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['AnalyticsSchedule'];
      };
    };
    responses: {
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Analytics.deleteSchedule': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Assignments.list': {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string;
        sort?: 'priority' | '-priority' | 'createdAt' | '-createdAt';
        /** @description UUIDv7 identifier */
        campaignId?: string;
        /** @description UUIDv7 identifier */
        scriptId?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description A page of assignments */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AssignmentPage'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Assignments.create': {
    parameters: {
      query?: never;
      header?: {
        /** @description Makes the POST safely retryable for 24 hours (same key + same body ⇒ same response). */
        'Idempotency-Key'?: string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateAssignment'];
      };
    };
    responses: {
      /** @description Created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Assignment'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Assignments.get': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The assignment */
      200: {
        headers: {
          /** @description Current version */
          etag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Assignment'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Assignments.remove': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Deleted */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Assignments.update': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdateAssignment'];
      };
    };
    responses: {
      /** @description Updated */
      200: {
        headers: {
          /** @description New version */
          etag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Assignment'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Assignments.batch': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['BatchAssignments'];
      };
    };
    responses: {
      /** @description Batch results */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            creates: components['schemas']['Assignment'][];
            updates: components['schemas']['Assignment'][];
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Audit.checkpoints': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Checkpoints */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuditCheckpoint'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Audit.keys': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description JWKS */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuditCheckpointKeys'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Audit.list': {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string;
        sort?: 'seq' | '-seq';
        from?: string;
        to?: string;
        actorType?: 'user' | 'system' | 'apiClient' | 'connector' | 'service';
        actorId?: string;
        action?: string;
        resourceType?: string;
        resourceId?: string;
        outcome?: 'success' | 'failure' | 'denied';
        correlationId?: string;
        interactionId?: string;
        q?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description A page of audit events */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuditEventPage'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Audit.export': {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string;
        sort?: 'seq' | '-seq';
        from?: string;
        to?: string;
        actorType?: 'user' | 'system' | 'apiClient' | 'connector' | 'service';
        actorId?: string;
        action?: string;
        resourceType?: string;
        resourceId?: string;
        outcome?: 'success' | 'failure' | 'denied';
        correlationId?: string;
        interactionId?: string;
        q?: string;
        format?: 'csv' | 'json';
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description CSV or JSON file */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Audit.verify': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['AuditVerifyRequest'];
      };
    };
    responses: {
      /** @description Verification report */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuditVerifyReport'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Team.notifications': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Notifications */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuthoringNotification'][];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Authz.me': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Principal and permissions */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Me'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Authz.list': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Roles */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CustomRole'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Authz.create': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateCustomRole'];
      };
    };
    responses: {
      /** @description Created */
      201: {
        headers: {
          /** @description Current version */
          etag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CustomRole'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Authz.update': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdateCustomRole'];
      };
    };
    responses: {
      /** @description Updated */
      200: {
        headers: {
          /** @description New version */
          etag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CustomRole'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Authz.setScope': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        userId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['RoleScopeAssignment'];
      };
    };
    responses: {
      /** @description Scope set */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RoleScopeAssignment'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Authz.vocabulary': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Vocabulary */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PermissionVocabulary'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'BreakGlass.list': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Accounts */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['BreakGlassAccount'][];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'BreakGlass.enroll': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['BreakGlassEnroll'];
      };
    };
    responses: {
      /** @description Enrollment pending MFA confirmation */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['BreakGlassEnrollment'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'BreakGlass.disable': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        userId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Disabled */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'BreakGlass.activate': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        userId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['BreakGlassActivate'];
      };
    };
    responses: {
      /** @description Activated */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['BreakGlassAccount'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Campaigns.list': {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string;
        sort?: 'createdAt' | '-createdAt' | 'updatedAt' | '-updatedAt' | 'name' | '-name';
        status?: 'draft' | 'active' | 'paused' | 'archived';
        channel?: 'voice' | 'chat' | 'email' | 'sms' | 'whatsapp' | 'social' | 'video' | 'callback';
        /** @description Case-insensitive name contains */
        q?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description A page of campaigns */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CampaignPage'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Campaigns.create': {
    parameters: {
      query?: never;
      header?: {
        /** @description Makes the POST safely retryable for 24 hours (same key + same body ⇒ same response). */
        'Idempotency-Key'?: string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateCampaign'];
      };
    };
    responses: {
      /** @description Created */
      201: {
        headers: {
          /** @description URL of the campaign */
          location?: string;
          /** @description Current version */
          etag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Campaign'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Campaigns.get': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The campaign */
      200: {
        headers: {
          /** @description Current version */
          etag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Campaign'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Campaigns.remove': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Deleted */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Campaigns.update': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdateCampaign'];
      };
    };
    responses: {
      /** @description Updated */
      200: {
        headers: {
          /** @description New version */
          etag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Campaign'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Routing.conflicts': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Conflicts */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AssignmentConflict'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Connectors.listChannels': {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string;
        sort?: 'createdAt' | '-createdAt';
        type?: 'voice' | 'chat' | 'email' | 'sms' | 'whatsapp' | 'social' | 'video' | 'callback';
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description A page of channels */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ChannelPage'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'ConnectorHub.list': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Connectors */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HubConnector'][];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'GenesysEngageHub.token': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          platformUserId: string;
        };
      };
    };
    responses: {
      /** @description Token */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            accessToken: string;
            expiresAt: string;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'GenesysEngageHub.agents': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Agents */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            agents: string[];
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'ConnectorHub.ingest': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ConnectorEventIngest'];
      };
    };
    responses: {
      /** @description Interaction upserted */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ConnectorEventIngested'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'ConnectorHub.health': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ConnectorHealthReport'];
      };
    };
    responses: {
      /** @description Recorded */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'ConnectorHub.secrets': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Secret values by connector-local name */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            secrets: {
              [key: string]: string;
            };
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Connectors.listConnectors': {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string;
        sort?: 'createdAt' | '-createdAt';
        adapterType?:
          | 'genesys_cloud'
          | 'genesys_engage'
          | 'avaya_aes'
          | 'avaya_axp'
          | 'avaya_aacc'
          | 'amazon_connect'
          | 'cisco'
          | 'nice_cxone'
          | 'five9'
          | 'generic';
        status?: 'draft' | 'active' | 'disabled' | 'error';
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description A page of connectors */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ConnectorPage'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AttachedDataMap.get': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Mapping */
      200: {
        headers: {
          /** @description Connector version */
          etag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /**
             * Format: uuid
             * @description UUIDv7 identifier
             */
            connectorId: string;
            version: number;
            attachedData: {
              key: string;
              variable: string;
              /**
               * @default string
               * @enum {string}
               */
              type: 'string' | 'number' | 'boolean';
              /** @default false */
              writeBack: boolean;
              /** @default false */
              pii: boolean;
            }[];
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AttachedDataMap.put': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['EngageAttachedDataMap'];
      };
    };
    responses: {
      /** @description Mapping */
      200: {
        headers: {
          /** @description New connector version */
          etag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /**
             * Format: uuid
             * @description UUIDv7 identifier
             */
            connectorId: string;
            version: number;
            attachedData: {
              key: string;
              variable: string;
              /**
               * @default string
               * @enum {string}
               */
              type: 'string' | 'number' | 'boolean';
              /** @default false */
              writeBack: boolean;
              /** @default false */
              pii: boolean;
            }[];
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Integrations.listDataSources': {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string;
        sort?: 'createdAt' | '-createdAt' | 'key' | '-key';
        protocol?: 'rest' | 'soap' | 'graphql';
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description A page of data sources */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['DataSourcePage'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Integrations.create': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          key: string;
          /** @enum {string} */
          protocol: 'rest' | 'soap' | 'graphql';
          definition: {
            /**
             * @default 1.1.0
             * @constant
             */
            schemaVersion?: '1.1.0';
            /** Format: uri */
            baseUrl: string;
            /** Format: starts_with */
            endpoint: string;
            /**
             * @default GET
             * @enum {string}
             */
            method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
            /** @default {} */
            headers?: {
              [key: string]: string;
            };
            /** @default {} */
            query?: {
              [key: string]: string;
            };
            body?: unknown;
            /**
             * @default {
             *       "type": "none"
             *     }
             */
            auth?:
              | {
                  /** @constant */
                  type: 'none';
                }
              | {
                  /** @constant */
                  type: 'apiKey';
                  /** Format: uuid */
                  secretRef: string;
                  /** @enum {string} */
                  placement: 'header' | 'query';
                  name: string;
                }
              | {
                  /** @constant */
                  type: 'basic';
                  /** Format: uuid */
                  secretRef: string;
                }
              | {
                  /** @constant */
                  type: 'bearer';
                  /** Format: uuid */
                  secretRef: string;
                }
              | {
                  /** @constant */
                  type: 'oauth2-client-credentials';
                  /** Format: uuid */
                  secretRef: string;
                  /** Format: uri */
                  tokenUrl: string;
                  scope?: string;
                }
              | {
                  /** @constant */
                  type: 'oauth2-password';
                  /** Format: uuid */
                  secretRef: string;
                  /** Format: uri */
                  tokenUrl: string;
                  scope?: string;
                }
              | {
                  /** @constant */
                  type: 'mtls';
                  /** Format: uuid */
                  secretRef: string;
                }
              | {
                  /** @constant */
                  type: 'hmac';
                  /** Format: uuid */
                  secretRef: string;
                  /** @default X-Signature */
                  header?: string;
                }
              | {
                  /** @constant */
                  type: 'wsSecurity';
                  /** Format: uuid */
                  secretRef: string;
                };
            /** @default {} */
            inputSchema?: {
              [key: string]: unknown;
            };
            /** @default {} */
            outputSchema?: {
              [key: string]: unknown;
            };
            /** @default {} */
            mapping?: {
              request?: string;
              response?: string;
            };
            /** @default {} */
            profiles?: {
              dev?: {
                /** Format: uri */
                baseUrl: string;
                auth:
                  | {
                      /** @constant */
                      type: 'none';
                    }
                  | {
                      /** @constant */
                      type: 'apiKey';
                      /** Format: uuid */
                      secretRef: string;
                      /** @enum {string} */
                      placement: 'header' | 'query';
                      name: string;
                    }
                  | {
                      /** @constant */
                      type: 'basic';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'bearer';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-client-credentials';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-password';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'mtls';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'hmac';
                      /** Format: uuid */
                      secretRef: string;
                      /** @default X-Signature */
                      header?: string;
                    }
                  | {
                      /** @constant */
                      type: 'wsSecurity';
                      /** Format: uuid */
                      secretRef: string;
                    };
              };
              test?: {
                /** Format: uri */
                baseUrl: string;
                auth:
                  | {
                      /** @constant */
                      type: 'none';
                    }
                  | {
                      /** @constant */
                      type: 'apiKey';
                      /** Format: uuid */
                      secretRef: string;
                      /** @enum {string} */
                      placement: 'header' | 'query';
                      name: string;
                    }
                  | {
                      /** @constant */
                      type: 'basic';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'bearer';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-client-credentials';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-password';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'mtls';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'hmac';
                      /** Format: uuid */
                      secretRef: string;
                      /** @default X-Signature */
                      header?: string;
                    }
                  | {
                      /** @constant */
                      type: 'wsSecurity';
                      /** Format: uuid */
                      secretRef: string;
                    };
              };
              prod?: {
                /** Format: uri */
                baseUrl: string;
                auth:
                  | {
                      /** @constant */
                      type: 'none';
                    }
                  | {
                      /** @constant */
                      type: 'apiKey';
                      /** Format: uuid */
                      secretRef: string;
                      /** @enum {string} */
                      placement: 'header' | 'query';
                      name: string;
                    }
                  | {
                      /** @constant */
                      type: 'basic';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'bearer';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-client-credentials';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-password';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'mtls';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'hmac';
                      /** Format: uuid */
                      secretRef: string;
                      /** @default X-Signature */
                      header?: string;
                    }
                  | {
                      /** @constant */
                      type: 'wsSecurity';
                      /** Format: uuid */
                      secretRef: string;
                    };
              };
            };
            mock?: {
              /** @default false */
              enabled?: boolean;
              response: unknown;
            };
            /** @default [] */
            mockScenarios?: {
              key: string;
              /** @enum {string} */
              kind: 'success' | 'empty' | 'error' | 'delay';
              response: unknown;
              /** @default 0 */
              delayMs?: number;
            }[];
            pendingPromotion?: unknown;
            soap?: {
              /** Format: uri */
              namespace: string;
              operation: string;
              action: string;
            };
            graphql?: {
              query: string;
              operationName?: string;
              /** @default 8 */
              maxDepth?: number;
              /** @default 200 */
              maxComplexity?: number;
            };
          };
          policy: {
            /** @default [] */
            allowedOrigins?: string[];
            /** @default false */
            allowHttp?: boolean;
            /** @default 5000 */
            timeoutMs?: number;
            /** @default 1048576 */
            maxResponseBytes?: number;
            /** @default 2 */
            retries?: number;
            /** @default 5 */
            breakerThreshold?: number;
            /** @default 30000 */
            breakerResetMs?: number;
            /** @default 10 */
            concurrency?: number;
            /** @default 0 */
            cacheTtlSeconds?: number;
            /** @default true */
            containsPii?: boolean;
            /** @default [] */
            piiPaths?: string[];
            fallback?: unknown;
          };
        };
      };
    };
    responses: {
      /** @description Data source */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            key: string;
            /** @enum {string} */
            protocol: 'rest' | 'soap' | 'graphql';
            version: number;
            definition: {
              /**
               * @default 1.1.0
               * @constant
               */
              schemaVersion: '1.1.0';
              /** Format: uri */
              baseUrl: string;
              /** Format: starts_with */
              endpoint: string;
              /**
               * @default GET
               * @enum {string}
               */
              method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
              /** @default {} */
              headers: {
                [key: string]: string;
              };
              /** @default {} */
              query: {
                [key: string]: string;
              };
              body?: unknown;
              /**
               * @default {
               *       "type": "none"
               *     }
               */
              auth:
                | {
                    /** @constant */
                    type: 'none';
                  }
                | {
                    /** @constant */
                    type: 'apiKey';
                    /** Format: uuid */
                    secretRef: string;
                    /** @enum {string} */
                    placement: 'header' | 'query';
                    name: string;
                  }
                | {
                    /** @constant */
                    type: 'basic';
                    /** Format: uuid */
                    secretRef: string;
                  }
                | {
                    /** @constant */
                    type: 'bearer';
                    /** Format: uuid */
                    secretRef: string;
                  }
                | {
                    /** @constant */
                    type: 'oauth2-client-credentials';
                    /** Format: uuid */
                    secretRef: string;
                    /** Format: uri */
                    tokenUrl: string;
                    scope?: string;
                  }
                | {
                    /** @constant */
                    type: 'oauth2-password';
                    /** Format: uuid */
                    secretRef: string;
                    /** Format: uri */
                    tokenUrl: string;
                    scope?: string;
                  }
                | {
                    /** @constant */
                    type: 'mtls';
                    /** Format: uuid */
                    secretRef: string;
                  }
                | {
                    /** @constant */
                    type: 'hmac';
                    /** Format: uuid */
                    secretRef: string;
                    /** @default X-Signature */
                    header: string;
                  }
                | {
                    /** @constant */
                    type: 'wsSecurity';
                    /** Format: uuid */
                    secretRef: string;
                  };
              /** @default {} */
              inputSchema: {
                [key: string]: unknown;
              };
              /** @default {} */
              outputSchema: {
                [key: string]: unknown;
              };
              /** @default {} */
              mapping: {
                request?: string;
                response?: string;
              };
              /** @default {} */
              profiles: {
                dev?: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
                test?: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
                prod?: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
              };
              mock?: {
                /** @default false */
                enabled: boolean;
                response: unknown;
              };
              /** @default [] */
              mockScenarios: {
                key: string;
                /** @enum {string} */
                kind: 'success' | 'empty' | 'error' | 'delay';
                response: unknown;
                /** @default 0 */
                delayMs: number;
              }[];
              pendingPromotion?: {
                requestedBy: string;
                /** @enum {string} */
                from: 'dev' | 'test';
                profile: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
                /** Format: date-time */
                requestedAt: string;
                reason: string;
              };
              soap?: {
                /** Format: uri */
                namespace: string;
                operation: string;
                action: string;
              };
              graphql?: {
                query: string;
                operationName?: string;
                /** @default 8 */
                maxDepth: number;
                /** @default 200 */
                maxComplexity: number;
              };
            };
            policy: {
              /** @default [] */
              allowedOrigins: string[];
              /** @default false */
              allowHttp: boolean;
              /** @default 5000 */
              timeoutMs: number;
              /** @default 1048576 */
              maxResponseBytes: number;
              /** @default 2 */
              retries: number;
              /** @default 5 */
              breakerThreshold: number;
              /** @default 30000 */
              breakerResetMs: number;
              /** @default 10 */
              concurrency: number;
              /** @default 0 */
              cacheTtlSeconds: number;
              /** @default true */
              containsPii: boolean;
              /** @default [] */
              piiPaths: string[];
              fallback?: unknown;
            };
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Integrations.get': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Data source */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            key: string;
            /** @enum {string} */
            protocol: 'rest' | 'soap' | 'graphql';
            version: number;
            definition: {
              /**
               * @default 1.1.0
               * @constant
               */
              schemaVersion: '1.1.0';
              /** Format: uri */
              baseUrl: string;
              /** Format: starts_with */
              endpoint: string;
              /**
               * @default GET
               * @enum {string}
               */
              method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
              /** @default {} */
              headers: {
                [key: string]: string;
              };
              /** @default {} */
              query: {
                [key: string]: string;
              };
              body?: unknown;
              /**
               * @default {
               *       "type": "none"
               *     }
               */
              auth:
                | {
                    /** @constant */
                    type: 'none';
                  }
                | {
                    /** @constant */
                    type: 'apiKey';
                    /** Format: uuid */
                    secretRef: string;
                    /** @enum {string} */
                    placement: 'header' | 'query';
                    name: string;
                  }
                | {
                    /** @constant */
                    type: 'basic';
                    /** Format: uuid */
                    secretRef: string;
                  }
                | {
                    /** @constant */
                    type: 'bearer';
                    /** Format: uuid */
                    secretRef: string;
                  }
                | {
                    /** @constant */
                    type: 'oauth2-client-credentials';
                    /** Format: uuid */
                    secretRef: string;
                    /** Format: uri */
                    tokenUrl: string;
                    scope?: string;
                  }
                | {
                    /** @constant */
                    type: 'oauth2-password';
                    /** Format: uuid */
                    secretRef: string;
                    /** Format: uri */
                    tokenUrl: string;
                    scope?: string;
                  }
                | {
                    /** @constant */
                    type: 'mtls';
                    /** Format: uuid */
                    secretRef: string;
                  }
                | {
                    /** @constant */
                    type: 'hmac';
                    /** Format: uuid */
                    secretRef: string;
                    /** @default X-Signature */
                    header: string;
                  }
                | {
                    /** @constant */
                    type: 'wsSecurity';
                    /** Format: uuid */
                    secretRef: string;
                  };
              /** @default {} */
              inputSchema: {
                [key: string]: unknown;
              };
              /** @default {} */
              outputSchema: {
                [key: string]: unknown;
              };
              /** @default {} */
              mapping: {
                request?: string;
                response?: string;
              };
              /** @default {} */
              profiles: {
                dev?: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
                test?: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
                prod?: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
              };
              mock?: {
                /** @default false */
                enabled: boolean;
                response: unknown;
              };
              /** @default [] */
              mockScenarios: {
                key: string;
                /** @enum {string} */
                kind: 'success' | 'empty' | 'error' | 'delay';
                response: unknown;
                /** @default 0 */
                delayMs: number;
              }[];
              pendingPromotion?: {
                requestedBy: string;
                /** @enum {string} */
                from: 'dev' | 'test';
                profile: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
                /** Format: date-time */
                requestedAt: string;
                reason: string;
              };
              soap?: {
                /** Format: uri */
                namespace: string;
                operation: string;
                action: string;
              };
              graphql?: {
                query: string;
                operationName?: string;
                /** @default 8 */
                maxDepth: number;
                /** @default 200 */
                maxComplexity: number;
              };
            };
            policy: {
              /** @default [] */
              allowedOrigins: string[];
              /** @default false */
              allowHttp: boolean;
              /** @default 5000 */
              timeoutMs: number;
              /** @default 1048576 */
              maxResponseBytes: number;
              /** @default 2 */
              retries: number;
              /** @default 5 */
              breakerThreshold: number;
              /** @default 30000 */
              breakerResetMs: number;
              /** @default 10 */
              concurrency: number;
              /** @default 0 */
              cacheTtlSeconds: number;
              /** @default true */
              containsPii: boolean;
              /** @default [] */
              piiPaths: string[];
              fallback?: unknown;
            };
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Integrations.update': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          key: string;
          /** @enum {string} */
          protocol: 'rest' | 'soap' | 'graphql';
          definition: {
            /**
             * @default 1.1.0
             * @constant
             */
            schemaVersion?: '1.1.0';
            /** Format: uri */
            baseUrl: string;
            /** Format: starts_with */
            endpoint: string;
            /**
             * @default GET
             * @enum {string}
             */
            method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
            /** @default {} */
            headers?: {
              [key: string]: string;
            };
            /** @default {} */
            query?: {
              [key: string]: string;
            };
            body?: unknown;
            /**
             * @default {
             *       "type": "none"
             *     }
             */
            auth?:
              | {
                  /** @constant */
                  type: 'none';
                }
              | {
                  /** @constant */
                  type: 'apiKey';
                  /** Format: uuid */
                  secretRef: string;
                  /** @enum {string} */
                  placement: 'header' | 'query';
                  name: string;
                }
              | {
                  /** @constant */
                  type: 'basic';
                  /** Format: uuid */
                  secretRef: string;
                }
              | {
                  /** @constant */
                  type: 'bearer';
                  /** Format: uuid */
                  secretRef: string;
                }
              | {
                  /** @constant */
                  type: 'oauth2-client-credentials';
                  /** Format: uuid */
                  secretRef: string;
                  /** Format: uri */
                  tokenUrl: string;
                  scope?: string;
                }
              | {
                  /** @constant */
                  type: 'oauth2-password';
                  /** Format: uuid */
                  secretRef: string;
                  /** Format: uri */
                  tokenUrl: string;
                  scope?: string;
                }
              | {
                  /** @constant */
                  type: 'mtls';
                  /** Format: uuid */
                  secretRef: string;
                }
              | {
                  /** @constant */
                  type: 'hmac';
                  /** Format: uuid */
                  secretRef: string;
                  /** @default X-Signature */
                  header?: string;
                }
              | {
                  /** @constant */
                  type: 'wsSecurity';
                  /** Format: uuid */
                  secretRef: string;
                };
            /** @default {} */
            inputSchema?: {
              [key: string]: unknown;
            };
            /** @default {} */
            outputSchema?: {
              [key: string]: unknown;
            };
            /** @default {} */
            mapping?: {
              request?: string;
              response?: string;
            };
            /** @default {} */
            profiles?: {
              dev?: {
                /** Format: uri */
                baseUrl: string;
                auth:
                  | {
                      /** @constant */
                      type: 'none';
                    }
                  | {
                      /** @constant */
                      type: 'apiKey';
                      /** Format: uuid */
                      secretRef: string;
                      /** @enum {string} */
                      placement: 'header' | 'query';
                      name: string;
                    }
                  | {
                      /** @constant */
                      type: 'basic';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'bearer';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-client-credentials';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-password';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'mtls';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'hmac';
                      /** Format: uuid */
                      secretRef: string;
                      /** @default X-Signature */
                      header?: string;
                    }
                  | {
                      /** @constant */
                      type: 'wsSecurity';
                      /** Format: uuid */
                      secretRef: string;
                    };
              };
              test?: {
                /** Format: uri */
                baseUrl: string;
                auth:
                  | {
                      /** @constant */
                      type: 'none';
                    }
                  | {
                      /** @constant */
                      type: 'apiKey';
                      /** Format: uuid */
                      secretRef: string;
                      /** @enum {string} */
                      placement: 'header' | 'query';
                      name: string;
                    }
                  | {
                      /** @constant */
                      type: 'basic';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'bearer';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-client-credentials';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-password';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'mtls';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'hmac';
                      /** Format: uuid */
                      secretRef: string;
                      /** @default X-Signature */
                      header?: string;
                    }
                  | {
                      /** @constant */
                      type: 'wsSecurity';
                      /** Format: uuid */
                      secretRef: string;
                    };
              };
              prod?: {
                /** Format: uri */
                baseUrl: string;
                auth:
                  | {
                      /** @constant */
                      type: 'none';
                    }
                  | {
                      /** @constant */
                      type: 'apiKey';
                      /** Format: uuid */
                      secretRef: string;
                      /** @enum {string} */
                      placement: 'header' | 'query';
                      name: string;
                    }
                  | {
                      /** @constant */
                      type: 'basic';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'bearer';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-client-credentials';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'oauth2-password';
                      /** Format: uuid */
                      secretRef: string;
                      /** Format: uri */
                      tokenUrl: string;
                      scope?: string;
                    }
                  | {
                      /** @constant */
                      type: 'mtls';
                      /** Format: uuid */
                      secretRef: string;
                    }
                  | {
                      /** @constant */
                      type: 'hmac';
                      /** Format: uuid */
                      secretRef: string;
                      /** @default X-Signature */
                      header?: string;
                    }
                  | {
                      /** @constant */
                      type: 'wsSecurity';
                      /** Format: uuid */
                      secretRef: string;
                    };
              };
            };
            mock?: {
              /** @default false */
              enabled?: boolean;
              response: unknown;
            };
            /** @default [] */
            mockScenarios?: {
              key: string;
              /** @enum {string} */
              kind: 'success' | 'empty' | 'error' | 'delay';
              response: unknown;
              /** @default 0 */
              delayMs?: number;
            }[];
            pendingPromotion?: unknown;
            soap?: {
              /** Format: uri */
              namespace: string;
              operation: string;
              action: string;
            };
            graphql?: {
              query: string;
              operationName?: string;
              /** @default 8 */
              maxDepth?: number;
              /** @default 200 */
              maxComplexity?: number;
            };
          };
          policy: {
            /** @default [] */
            allowedOrigins?: string[];
            /** @default false */
            allowHttp?: boolean;
            /** @default 5000 */
            timeoutMs?: number;
            /** @default 1048576 */
            maxResponseBytes?: number;
            /** @default 2 */
            retries?: number;
            /** @default 5 */
            breakerThreshold?: number;
            /** @default 30000 */
            breakerResetMs?: number;
            /** @default 10 */
            concurrency?: number;
            /** @default 0 */
            cacheTtlSeconds?: number;
            /** @default true */
            containsPii?: boolean;
            /** @default [] */
            piiPaths?: string[];
            fallback?: unknown;
          };
        };
      };
    };
    responses: {
      /** @description Data source */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            key: string;
            /** @enum {string} */
            protocol: 'rest' | 'soap' | 'graphql';
            version: number;
            definition: {
              /**
               * @default 1.1.0
               * @constant
               */
              schemaVersion: '1.1.0';
              /** Format: uri */
              baseUrl: string;
              /** Format: starts_with */
              endpoint: string;
              /**
               * @default GET
               * @enum {string}
               */
              method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
              /** @default {} */
              headers: {
                [key: string]: string;
              };
              /** @default {} */
              query: {
                [key: string]: string;
              };
              body?: unknown;
              /**
               * @default {
               *       "type": "none"
               *     }
               */
              auth:
                | {
                    /** @constant */
                    type: 'none';
                  }
                | {
                    /** @constant */
                    type: 'apiKey';
                    /** Format: uuid */
                    secretRef: string;
                    /** @enum {string} */
                    placement: 'header' | 'query';
                    name: string;
                  }
                | {
                    /** @constant */
                    type: 'basic';
                    /** Format: uuid */
                    secretRef: string;
                  }
                | {
                    /** @constant */
                    type: 'bearer';
                    /** Format: uuid */
                    secretRef: string;
                  }
                | {
                    /** @constant */
                    type: 'oauth2-client-credentials';
                    /** Format: uuid */
                    secretRef: string;
                    /** Format: uri */
                    tokenUrl: string;
                    scope?: string;
                  }
                | {
                    /** @constant */
                    type: 'oauth2-password';
                    /** Format: uuid */
                    secretRef: string;
                    /** Format: uri */
                    tokenUrl: string;
                    scope?: string;
                  }
                | {
                    /** @constant */
                    type: 'mtls';
                    /** Format: uuid */
                    secretRef: string;
                  }
                | {
                    /** @constant */
                    type: 'hmac';
                    /** Format: uuid */
                    secretRef: string;
                    /** @default X-Signature */
                    header: string;
                  }
                | {
                    /** @constant */
                    type: 'wsSecurity';
                    /** Format: uuid */
                    secretRef: string;
                  };
              /** @default {} */
              inputSchema: {
                [key: string]: unknown;
              };
              /** @default {} */
              outputSchema: {
                [key: string]: unknown;
              };
              /** @default {} */
              mapping: {
                request?: string;
                response?: string;
              };
              /** @default {} */
              profiles: {
                dev?: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
                test?: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
                prod?: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
              };
              mock?: {
                /** @default false */
                enabled: boolean;
                response: unknown;
              };
              /** @default [] */
              mockScenarios: {
                key: string;
                /** @enum {string} */
                kind: 'success' | 'empty' | 'error' | 'delay';
                response: unknown;
                /** @default 0 */
                delayMs: number;
              }[];
              pendingPromotion?: {
                requestedBy: string;
                /** @enum {string} */
                from: 'dev' | 'test';
                profile: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
                /** Format: date-time */
                requestedAt: string;
                reason: string;
              };
              soap?: {
                /** Format: uri */
                namespace: string;
                operation: string;
                action: string;
              };
              graphql?: {
                query: string;
                operationName?: string;
                /** @default 8 */
                maxDepth: number;
                /** @default 200 */
                maxComplexity: number;
              };
            };
            policy: {
              /** @default [] */
              allowedOrigins: string[];
              /** @default false */
              allowHttp: boolean;
              /** @default 5000 */
              timeoutMs: number;
              /** @default 1048576 */
              maxResponseBytes: number;
              /** @default 2 */
              retries: number;
              /** @default 5 */
              breakerThreshold: number;
              /** @default 30000 */
              breakerResetMs: number;
              /** @default 10 */
              concurrency: number;
              /** @default 0 */
              cacheTtlSeconds: number;
              /** @default true */
              containsPii: boolean;
              /** @default [] */
              piiPaths: string[];
              fallback?: unknown;
            };
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Integrations.introspection': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          /** @enum {string} */
          environment: 'dev' | 'test';
        };
      };
    };
    responses: {
      /** @description GraphQL schema */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Integrations.metrics': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Process-local integration metrics */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            profile: string;
            calls: number;
            errors: number;
            errorRate: number;
            p50: number;
            p95: number;
            p99: number;
            breaker: number;
          }[];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Integrations.preview': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          input: unknown;
          scenario?: string;
          /**
           * @default prod
           * @enum {string}
           */
          environment?: 'dev' | 'test' | 'prod';
        };
      };
    };
    responses: {
      /** @description Redacted console trace */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            request: unknown;
            response: unknown;
            mapped: unknown;
            durationMs: number;
            cached: boolean;
            mock: boolean;
            error: string | null;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Integrations.promote': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          /** @enum {string} */
          from: 'dev' | 'test';
          reason: string;
        };
      };
    };
    responses: {
      /** @description Pending profile */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            key: string;
            /** @enum {string} */
            protocol: 'rest' | 'soap' | 'graphql';
            version: number;
            definition: {
              /**
               * @default 1.1.0
               * @constant
               */
              schemaVersion: '1.1.0';
              /** Format: uri */
              baseUrl: string;
              /** Format: starts_with */
              endpoint: string;
              /**
               * @default GET
               * @enum {string}
               */
              method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
              /** @default {} */
              headers: {
                [key: string]: string;
              };
              /** @default {} */
              query: {
                [key: string]: string;
              };
              body?: unknown;
              /**
               * @default {
               *       "type": "none"
               *     }
               */
              auth:
                | {
                    /** @constant */
                    type: 'none';
                  }
                | {
                    /** @constant */
                    type: 'apiKey';
                    /** Format: uuid */
                    secretRef: string;
                    /** @enum {string} */
                    placement: 'header' | 'query';
                    name: string;
                  }
                | {
                    /** @constant */
                    type: 'basic';
                    /** Format: uuid */
                    secretRef: string;
                  }
                | {
                    /** @constant */
                    type: 'bearer';
                    /** Format: uuid */
                    secretRef: string;
                  }
                | {
                    /** @constant */
                    type: 'oauth2-client-credentials';
                    /** Format: uuid */
                    secretRef: string;
                    /** Format: uri */
                    tokenUrl: string;
                    scope?: string;
                  }
                | {
                    /** @constant */
                    type: 'oauth2-password';
                    /** Format: uuid */
                    secretRef: string;
                    /** Format: uri */
                    tokenUrl: string;
                    scope?: string;
                  }
                | {
                    /** @constant */
                    type: 'mtls';
                    /** Format: uuid */
                    secretRef: string;
                  }
                | {
                    /** @constant */
                    type: 'hmac';
                    /** Format: uuid */
                    secretRef: string;
                    /** @default X-Signature */
                    header: string;
                  }
                | {
                    /** @constant */
                    type: 'wsSecurity';
                    /** Format: uuid */
                    secretRef: string;
                  };
              /** @default {} */
              inputSchema: {
                [key: string]: unknown;
              };
              /** @default {} */
              outputSchema: {
                [key: string]: unknown;
              };
              /** @default {} */
              mapping: {
                request?: string;
                response?: string;
              };
              /** @default {} */
              profiles: {
                dev?: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
                test?: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
                prod?: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
              };
              mock?: {
                /** @default false */
                enabled: boolean;
                response: unknown;
              };
              /** @default [] */
              mockScenarios: {
                key: string;
                /** @enum {string} */
                kind: 'success' | 'empty' | 'error' | 'delay';
                response: unknown;
                /** @default 0 */
                delayMs: number;
              }[];
              pendingPromotion?: {
                requestedBy: string;
                /** @enum {string} */
                from: 'dev' | 'test';
                profile: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
                /** Format: date-time */
                requestedAt: string;
                reason: string;
              };
              soap?: {
                /** Format: uri */
                namespace: string;
                operation: string;
                action: string;
              };
              graphql?: {
                query: string;
                operationName?: string;
                /** @default 8 */
                maxDepth: number;
                /** @default 200 */
                maxComplexity: number;
              };
            };
            policy: {
              /** @default [] */
              allowedOrigins: string[];
              /** @default false */
              allowHttp: boolean;
              /** @default 5000 */
              timeoutMs: number;
              /** @default 1048576 */
              maxResponseBytes: number;
              /** @default 2 */
              retries: number;
              /** @default 5 */
              breakerThreshold: number;
              /** @default 30000 */
              breakerResetMs: number;
              /** @default 10 */
              concurrency: number;
              /** @default 0 */
              cacheTtlSeconds: number;
              /** @default true */
              containsPii: boolean;
              /** @default [] */
              piiPaths: string[];
              fallback?: unknown;
            };
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Integrations.approve': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Promoted profile */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            key: string;
            /** @enum {string} */
            protocol: 'rest' | 'soap' | 'graphql';
            version: number;
            definition: {
              /**
               * @default 1.1.0
               * @constant
               */
              schemaVersion: '1.1.0';
              /** Format: uri */
              baseUrl: string;
              /** Format: starts_with */
              endpoint: string;
              /**
               * @default GET
               * @enum {string}
               */
              method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
              /** @default {} */
              headers: {
                [key: string]: string;
              };
              /** @default {} */
              query: {
                [key: string]: string;
              };
              body?: unknown;
              /**
               * @default {
               *       "type": "none"
               *     }
               */
              auth:
                | {
                    /** @constant */
                    type: 'none';
                  }
                | {
                    /** @constant */
                    type: 'apiKey';
                    /** Format: uuid */
                    secretRef: string;
                    /** @enum {string} */
                    placement: 'header' | 'query';
                    name: string;
                  }
                | {
                    /** @constant */
                    type: 'basic';
                    /** Format: uuid */
                    secretRef: string;
                  }
                | {
                    /** @constant */
                    type: 'bearer';
                    /** Format: uuid */
                    secretRef: string;
                  }
                | {
                    /** @constant */
                    type: 'oauth2-client-credentials';
                    /** Format: uuid */
                    secretRef: string;
                    /** Format: uri */
                    tokenUrl: string;
                    scope?: string;
                  }
                | {
                    /** @constant */
                    type: 'oauth2-password';
                    /** Format: uuid */
                    secretRef: string;
                    /** Format: uri */
                    tokenUrl: string;
                    scope?: string;
                  }
                | {
                    /** @constant */
                    type: 'mtls';
                    /** Format: uuid */
                    secretRef: string;
                  }
                | {
                    /** @constant */
                    type: 'hmac';
                    /** Format: uuid */
                    secretRef: string;
                    /** @default X-Signature */
                    header: string;
                  }
                | {
                    /** @constant */
                    type: 'wsSecurity';
                    /** Format: uuid */
                    secretRef: string;
                  };
              /** @default {} */
              inputSchema: {
                [key: string]: unknown;
              };
              /** @default {} */
              outputSchema: {
                [key: string]: unknown;
              };
              /** @default {} */
              mapping: {
                request?: string;
                response?: string;
              };
              /** @default {} */
              profiles: {
                dev?: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
                test?: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
                prod?: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
              };
              mock?: {
                /** @default false */
                enabled: boolean;
                response: unknown;
              };
              /** @default [] */
              mockScenarios: {
                key: string;
                /** @enum {string} */
                kind: 'success' | 'empty' | 'error' | 'delay';
                response: unknown;
                /** @default 0 */
                delayMs: number;
              }[];
              pendingPromotion?: {
                requestedBy: string;
                /** @enum {string} */
                from: 'dev' | 'test';
                profile: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
                /** Format: date-time */
                requestedAt: string;
                reason: string;
              };
              soap?: {
                /** Format: uri */
                namespace: string;
                operation: string;
                action: string;
              };
              graphql?: {
                query: string;
                operationName?: string;
                /** @default 8 */
                maxDepth: number;
                /** @default 200 */
                maxComplexity: number;
              };
            };
            policy: {
              /** @default [] */
              allowedOrigins: string[];
              /** @default false */
              allowHttp: boolean;
              /** @default 5000 */
              timeoutMs: number;
              /** @default 1048576 */
              maxResponseBytes: number;
              /** @default 2 */
              retries: number;
              /** @default 5 */
              breakerThreshold: number;
              /** @default 30000 */
              breakerResetMs: number;
              /** @default 10 */
              concurrency: number;
              /** @default 0 */
              cacheTtlSeconds: number;
              /** @default true */
              containsPii: boolean;
              /** @default [] */
              piiPaths: string[];
              fallback?: unknown;
            };
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Integrations.test': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          input: unknown;
          scenario?: string;
          /**
           * @default prod
           * @enum {string}
           */
          environment?: 'dev' | 'test' | 'prod';
        };
      };
    };
    responses: {
      /** @description Redacted console trace */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            request: unknown;
            response: unknown;
            mapped: unknown;
            durationMs: number;
            cached: boolean;
            mock: boolean;
            error: string | null;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Integrations.usage': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Consumers */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            data: {
              /** Format: uuid */
              scriptId: string;
              name: string;
              number: number;
            }[];
            truncated: boolean;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Integrations.wsdl': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          xml: string;
        };
      };
    };
    responses: {
      /** @description WSDL operation list */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            operations: {
              name: string;
              action: string;
            }[];
            namespace?: string;
            definition: unknown;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Integrations.draftPreview': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          source: {
            key: string;
            /** @enum {string} */
            protocol: 'rest' | 'soap' | 'graphql';
            definition: {
              /**
               * @default 1.1.0
               * @constant
               */
              schemaVersion?: '1.1.0';
              /** Format: uri */
              baseUrl: string;
              /** Format: starts_with */
              endpoint: string;
              /**
               * @default GET
               * @enum {string}
               */
              method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
              /** @default {} */
              headers?: {
                [key: string]: string;
              };
              /** @default {} */
              query?: {
                [key: string]: string;
              };
              body?: unknown;
              /**
               * @default {
               *       "type": "none"
               *     }
               */
              auth?:
                | {
                    /** @constant */
                    type: 'none';
                  }
                | {
                    /** @constant */
                    type: 'apiKey';
                    /** Format: uuid */
                    secretRef: string;
                    /** @enum {string} */
                    placement: 'header' | 'query';
                    name: string;
                  }
                | {
                    /** @constant */
                    type: 'basic';
                    /** Format: uuid */
                    secretRef: string;
                  }
                | {
                    /** @constant */
                    type: 'bearer';
                    /** Format: uuid */
                    secretRef: string;
                  }
                | {
                    /** @constant */
                    type: 'oauth2-client-credentials';
                    /** Format: uuid */
                    secretRef: string;
                    /** Format: uri */
                    tokenUrl: string;
                    scope?: string;
                  }
                | {
                    /** @constant */
                    type: 'oauth2-password';
                    /** Format: uuid */
                    secretRef: string;
                    /** Format: uri */
                    tokenUrl: string;
                    scope?: string;
                  }
                | {
                    /** @constant */
                    type: 'mtls';
                    /** Format: uuid */
                    secretRef: string;
                  }
                | {
                    /** @constant */
                    type: 'hmac';
                    /** Format: uuid */
                    secretRef: string;
                    /** @default X-Signature */
                    header?: string;
                  }
                | {
                    /** @constant */
                    type: 'wsSecurity';
                    /** Format: uuid */
                    secretRef: string;
                  };
              /** @default {} */
              inputSchema?: {
                [key: string]: unknown;
              };
              /** @default {} */
              outputSchema?: {
                [key: string]: unknown;
              };
              /** @default {} */
              mapping?: {
                request?: string;
                response?: string;
              };
              /** @default {} */
              profiles?: {
                dev?: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header?: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
                test?: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header?: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
                prod?: {
                  /** Format: uri */
                  baseUrl: string;
                  auth:
                    | {
                        /** @constant */
                        type: 'none';
                      }
                    | {
                        /** @constant */
                        type: 'apiKey';
                        /** Format: uuid */
                        secretRef: string;
                        /** @enum {string} */
                        placement: 'header' | 'query';
                        name: string;
                      }
                    | {
                        /** @constant */
                        type: 'basic';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'bearer';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-client-credentials';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'oauth2-password';
                        /** Format: uuid */
                        secretRef: string;
                        /** Format: uri */
                        tokenUrl: string;
                        scope?: string;
                      }
                    | {
                        /** @constant */
                        type: 'mtls';
                        /** Format: uuid */
                        secretRef: string;
                      }
                    | {
                        /** @constant */
                        type: 'hmac';
                        /** Format: uuid */
                        secretRef: string;
                        /** @default X-Signature */
                        header?: string;
                      }
                    | {
                        /** @constant */
                        type: 'wsSecurity';
                        /** Format: uuid */
                        secretRef: string;
                      };
                };
              };
              mock?: {
                /** @default false */
                enabled?: boolean;
                response: unknown;
              };
              /** @default [] */
              mockScenarios?: {
                key: string;
                /** @enum {string} */
                kind: 'success' | 'empty' | 'error' | 'delay';
                response: unknown;
                /** @default 0 */
                delayMs?: number;
              }[];
              pendingPromotion?: unknown;
              soap?: {
                /** Format: uri */
                namespace: string;
                operation: string;
                action: string;
              };
              graphql?: {
                query: string;
                operationName?: string;
                /** @default 8 */
                maxDepth?: number;
                /** @default 200 */
                maxComplexity?: number;
              };
            };
            policy: {
              /** @default [] */
              allowedOrigins?: string[];
              /** @default false */
              allowHttp?: boolean;
              /** @default 5000 */
              timeoutMs?: number;
              /** @default 1048576 */
              maxResponseBytes?: number;
              /** @default 2 */
              retries?: number;
              /** @default 5 */
              breakerThreshold?: number;
              /** @default 30000 */
              breakerResetMs?: number;
              /** @default 10 */
              concurrency?: number;
              /** @default 0 */
              cacheTtlSeconds?: number;
              /** @default true */
              containsPii?: boolean;
              /** @default [] */
              piiPaths?: string[];
              fallback?: unknown;
            };
          };
          call: {
            input: unknown;
            scenario?: string;
            /**
             * @default prod
             * @enum {string}
             */
            environment?: 'dev' | 'test' | 'prod';
          };
        };
      };
    };
    responses: {
      /** @description Redacted mock trace */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            request: unknown;
            response: unknown;
            mapped: unknown;
            durationMs: number;
            cached: boolean;
            mock: boolean;
            error: string | null;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Embedding.policy': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Headers to apply */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['FramePolicy'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'GenesysCloudOAuth.authorize': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Redirect to Genesys Cloud login */
      302: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Browser protocol endpoint: failures redirect back to the app with ?authError=<code>, or RFC 7807 */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'GenesysCloudOAuth.callback': {
    parameters: {
      query?: {
        code?: string;
        state?: string;
        error?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Redirect to agent-web */
      302: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Browser protocol endpoint: failures redirect back to the app with ?authError=<code>, or RFC 7807 */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'GenesysEngageAgent.authorize': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Redirect to Genesys Authentication */
      302: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Browser protocol endpoint: failures redirect back to the app with ?authError=<code>, or RFC 7807 */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'GenesysEngageAgent.unlink': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Unlinked */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'GenesysEngageAgent.status': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Link status */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['EngageLinkStatus'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'GenesysEngageAgent.callback': {
    parameters: {
      query?: {
        code?: string;
        state?: string;
        error?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Redirect to agent-web */
      302: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Browser protocol endpoint: failures redirect back to the app with ?authError=<code>, or RFC 7807 */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Identity.listIdps': {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string;
        sort?: 'createdAt' | '-createdAt';
        status?: 'draft' | 'active' | 'disabled';
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description A page of identity providers */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['IdentityProviderPage'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.createIdp': {
    parameters: {
      query?: never;
      header?: {
        /** @description Makes the POST safely retryable for 24 hours (same key + same body ⇒ same response). */
        'Idempotency-Key'?: string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateIdentityProvider'];
      };
    };
    responses: {
      /** @description Created */
      201: {
        headers: {
          /** @description URL */
          location?: string;
          /** @description Current version */
          etag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['IdentityProviderDetail'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.getIdp': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The identity provider */
      200: {
        headers: {
          /** @description Current version */
          etag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['IdentityProviderDetail'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.deleteIdp': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Deleted */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.updateIdp': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdateIdentityProvider'];
      };
    };
    responses: {
      /** @description Updated */
      200: {
        headers: {
          /** @description New version */
          etag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['IdentityProviderDetail'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.scimTokens': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Tokens (no secrets) */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScimToken'][];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.issueScimToken': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateScimToken'];
      };
    };
    responses: {
      /** @description Issued */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['IssuedScimToken'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.revokeScimToken': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        tokenId: string;
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Revoked */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.rotate': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['RotateSpCredential'];
      };
    };
    responses: {
      /** @description Updated identity provider */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['IdentityProviderDetail'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.removeCredential': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        credentialId: string;
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Updated identity provider */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['IdentityProviderDetail'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.promote': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        credentialId: string;
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Updated identity provider */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['IdentityProviderDetail'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Launch.create': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['LaunchIntentCreate'];
      };
    };
    responses: {
      /** @description Intent created; the code is pushed to the agent or returned for a fragment URL */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LaunchIntentCreated'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Launch.embedded': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['LaunchEmbedded'];
      };
    };
    responses: {
      /** @description Session created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LaunchResult'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Launch.jws': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['LaunchJws'];
      };
    };
    responses: {
      /** @description Session created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LaunchResult'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Launch.signal': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['LaunchParamSignal'];
      };
    };
    responses: {
      /** @description Recorded */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Launch.preview': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['LaunchPreview'];
      };
    };
    responses: {
      /** @description Preview session created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LaunchResult'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Launch.redeem': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['LaunchRedeem'];
      };
    };
    responses: {
      /** @description Session created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LaunchResult'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Launch.ticket': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Socket ticket */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LaunchSocketTicket'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'MePermissions.permissions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Packed rules */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MePermissions'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.mySessions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Sessions */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SessionList'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.endMyOtherSessions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Ended */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SessionsTerminated'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.endMySession': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        sessionId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Ended */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Identity.listRoles': {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string;
        sort?: 'createdAt' | '-createdAt' | 'name' | '-name';
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description A page of roles */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RolePage'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Screens.get': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The screen */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScreenDetail'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Packages.export': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ExportPackage'];
      };
    };
    responses: {
      /** @description .verbis package */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['VerbisPackage'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Packages.import': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json':
          | components['schemas']['PackageImportRequest']
          | {
              [key: string]: unknown;
            };
      };
    };
    responses: {
      /** @description Import result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Routing.resolve': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ScriptResolutionRequest'];
      };
    };
    responses: {
      /** @description Decision */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScriptResolution'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Screens.list': {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string;
        sort?: 'key' | '-key' | 'createdAt' | '-createdAt';
        entry?: 'true' | 'false';
      };
      header?: never;
      path: {
        versionId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description A page of screens */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScreenPage'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Scripts.list': {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string;
        sort?: 'createdAt' | '-createdAt' | 'updatedAt' | '-updatedAt' | 'name' | '-name';
        status?: 'draft' | 'active' | 'archived';
        tag?: string;
        q?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description A page of scripts */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScriptPage'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Scripts.create': {
    parameters: {
      query?: never;
      header?: {
        /** @description Makes the POST safely retryable for 24 hours (same key + same body ⇒ same response). */
        'Idempotency-Key'?: string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateScript'];
      };
    };
    responses: {
      /** @description Created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Script'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Scripts.get': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The script */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Script'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Scripts.update': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdateScript'];
      };
    };
    responses: {
      /** @description Updated */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Script'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Team.rollback': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['RollbackRelease'];
      };
    };
    responses: {
      /** @description New release head */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            currentVersionId: string;
            number: number;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Scripts.listVersions': {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string;
        sort?: 'number' | '-number';
      };
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description A page of versions */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScriptVersionPage'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Scripts.createVersion': {
    parameters: {
      query?: never;
      header?: {
        /** @description Makes the POST safely retryable for 24 hours (same key + same body ⇒ same response). */
        'Idempotency-Key'?: string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateScriptVersion'];
      };
    };
    responses: {
      /** @description Created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CreatedScriptVersion'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Scripts.diff': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        to: number;
        from: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Diff */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScriptVersionDiff'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Scripts.getVersion': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The version */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScriptVersion'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Collaboration.flush': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Room closed */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            closed: boolean;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Collaboration.ticket': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Room ticket */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CollaborationTicket'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Team.threads': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Threads */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['NodeCommentThread'][];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Team.comment': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['NodeCommentInput'];
      };
    };
    responses: {
      /** @description Thread */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['NodeCommentThread'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Team.reply': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        thread: string;
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['NodeCommentReply'];
      };
    };
    responses: {
      /** @description Thread */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['NodeCommentThread'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Team.resolve': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        thread: string;
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ResolveCommentThread'];
      };
    };
    responses: {
      /** @description Thread */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['NodeCommentThread'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Scripts.updateDraft': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdateScriptDraft'];
      };
    };
    responses: {
      /** @description Updated */
      200: {
        headers: {
          /** @description New version */
          etag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CreatedScriptVersion'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Scripts.livePreview': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        source: string;
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          input: {
            [key: string]: components['schemas']['Inline113ae44d83'];
          };
          /** @constant */
          environment: 'test';
        };
      };
    };
    responses: {
      /** @description Secret-scrubbed runtime value; never cached as a replay response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            value: components['schemas']['Inline113ae44d83'];
            durationMs: number;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Scripts.publish': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Published */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScriptVersionSummary'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Scripts.regression': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Regression report for the saved document checksum */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            checksum: string;
            version: number;
            passed: boolean;
            /** Format: date-time */
            checkedAt: string;
            results: {
              id: string;
              passed: boolean;
              durationMs: number;
              assertions: {
                path: string;
                passed: boolean;
              }[];
              code?: string;
            }[];
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Scripts.reopen': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Draft */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScriptVersionSummary'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Scripts.retire': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Retired */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScriptVersionSummary'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Scripts.reviews': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Reviews */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScriptVersionReview'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Scripts.review': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ReviewScriptVersion'];
      };
    };
    responses: {
      /** @description Version after the review */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScriptVersionSummary'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Team.schedule': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ReleaseSchedule'];
      };
    };
    responses: {
      /** @description Scheduled release */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            state: string;
            at: string;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Team.schedules': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Schedules */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            state: string;
            /** Format: date-time */
            runAt: string;
            completedAt: string | null;
          }[];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Scripts.submit': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          semver?: string;
          changeNote: string;
        };
      };
    };
    responses: {
      /** @description In review */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScriptVersionSummary'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Team.members': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Eligible mention recipients */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            name: string;
          }[];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Scripts.withdraw': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        number: number;
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Draft */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ScriptVersionSummary'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Integrations.listSecrets': {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string;
        sort?: 'createdAt' | '-createdAt' | 'name' | '-name';
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description A page of secret metadata */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SecretMetadataPage'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Integrations.setSecret': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          name: string;
          /** @enum {string} */
          kind: 'password' | 'api_key' | 'oauth_client' | 'certificate' | 'generic';
          value: string;
        };
      };
    };
    responses: {
      /** @description Secret metadata */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SecretMetadata'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Integrations.rotate': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          name: string;
          /** @enum {string} */
          kind: 'password' | 'api_key' | 'oauth_client' | 'certificate' | 'generic';
          value: string;
        };
      };
    };
    responses: {
      /** @description Secret metadata */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SecretMetadata'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'SecurityReports.report': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CspSecurityReport'];
      };
    };
    responses: {
      /** @description Security signal durably acknowledged */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.listClients': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Service clients */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ServiceClient'][];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.createClient': {
    parameters: {
      query?: never;
      header?: {
        /** @description Makes the POST safely retryable for 24 hours (same key + same body ⇒ same response). */
        'Idempotency-Key'?: string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateServiceClient'];
      };
    };
    responses: {
      /** @description Created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ServiceClientWithSecret'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.getClient': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Service client */
      200: {
        headers: {
          /** @description Current version */
          etag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ServiceClient'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.deleteClient': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Deleted */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.updateClient': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdateServiceClient'];
      };
    };
    responses: {
      /** @description Updated */
      200: {
        headers: {
          /** @description New version */
          etag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ServiceClient'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.rotateSecret': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Rotated */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ServiceClientWithSecret'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Runtime.list': {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string;
        sort?: 'createdAt' | '-createdAt' | 'startedAt' | '-startedAt';
        state?:
          'launching' | 'paused' | 'active' | 'wrapup' | 'completed' | 'abandoned' | 'expired';
        /** @description UUIDv7 identifier */
        userId?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description A page of sessions */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SessionPage'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Runtime.get': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The session */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Session'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'RuntimeCommands.attach': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          /** Format: uuid */
          tabId: string;
          writeToken?: string;
        };
      };
    };
    responses: {
      /** @description Writer lease */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            state:
              'launching' | 'active' | 'paused' | 'wrapup' | 'completed' | 'abandoned' | 'expired';
            sequence: number;
            readOnly: boolean;
            snapshot: {
              /** @default {} */
              variables: {
                [key: string]: components['schemas']['JsonValue'];
              };
              /** @default null */
              currentPage: string | null;
              /** @default [] */
              history: string[];
              /** @default {} */
              timers: {
                [key: string]: number;
              };
            };
            writeToken?: string;
            leaseUntil: string | null;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'RuntimeCommands.command': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          expectedSequence: number;
          /** Format: uuid */
          tabId: string;
          writeToken: string;
          command:
            | {
                /** @constant */
                type: 'transition';
                /** @enum {string} */
                state: 'active' | 'paused' | 'wrapup' | 'abandoned' | 'expired';
              }
            | {
                /** @constant */
                type: 'field';
                variable: string;
                value: components['schemas']['JsonValue'];
              }
            | {
                /** @constant */
                type: 'page';
                pageId: string;
                history?: string[];
              }
            | {
                /** @constant */
                type: 'timer';
                timerId: string;
                durationMs: number;
              };
        };
      };
    };
    responses: {
      /** @description Updated state */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            state:
              'launching' | 'active' | 'paused' | 'wrapup' | 'completed' | 'abandoned' | 'expired';
            sequence: number;
            readOnly: boolean;
            snapshot: {
              /** @default {} */
              variables: {
                [key: string]: components['schemas']['JsonValue'];
              };
              /** @default null */
              currentPage: string | null;
              /** @default [] */
              history: string[];
              /** @default {} */
              timers: {
                [key: string]: number;
              };
            };
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AgentDesktop.desktop': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Agent desktop */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            view: {
              /** Format: uuid */
              id: string;
              /** @enum {string} */
              state:
                | 'launching'
                | 'active'
                | 'paused'
                | 'wrapup'
                | 'completed'
                | 'abandoned'
                | 'expired';
              sequence: number;
              readOnly: boolean;
              snapshot: {
                /** @default {} */
                variables: {
                  [key: string]: components['schemas']['JsonValue'];
                };
                /** @default null */
                currentPage: string | null;
                /** @default [] */
                history: string[];
                /** @default {} */
                timers: {
                  [key: string]: number;
                };
              };
            };
            document: unknown;
            checksum: string;
            secureCapture?: {
              /** Format: uri */
              url: string;
              /** Format: uri */
              origin: string;
            };
            /** Format: date-time */
            startedAt: string;
            interaction: {
              channel: string;
              status: string;
              queue: string | null;
              platform: string;
              customerName: string | null;
              context: {
                [key: string]: components['schemas']['JsonValue'];
              };
            };
            campaign: {
              name: string;
              outcomes: components['schemas']['CampaignOutcome'][];
            };
            /** @enum {string} */
            writeback: 'none' | 'queued' | 'success';
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AgentDesktop.call': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          expectedSequence: number;
          /** Format: uuid */
          tabId: string;
          writeToken: string;
          sourceId: string;
          input: {
            [key: string]: components['schemas']['JsonValue'];
          };
        };
      };
    };
    responses: {
      /** @description Mapped result and authoritative state */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            value: unknown;
            view: {
              /** Format: uuid */
              id: string;
              /** @enum {string} */
              state:
                | 'launching'
                | 'active'
                | 'paused'
                | 'wrapup'
                | 'completed'
                | 'abandoned'
                | 'expired';
              sequence: number;
              readOnly: boolean;
              snapshot: {
                /** @default {} */
                variables: {
                  [key: string]: components['schemas']['JsonValue'];
                };
                /** @default null */
                currentPage: string | null;
                /** @default [] */
                history: string[];
                /** @default {} */
                timers: {
                  [key: string]: number;
                };
              };
            };
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AgentDesktop.recovery': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          expectedSequence: number;
          /** Format: uuid */
          tabId: string;
          writeToken: string;
          sourceId: string;
          /** @enum {string} */
          mode: 'continue' | 'manual';
        };
      };
    };
    responses: {
      /** @description Authoritative state */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            state:
              'launching' | 'active' | 'paused' | 'wrapup' | 'completed' | 'abandoned' | 'expired';
            sequence: number;
            readOnly: boolean;
            snapshot: {
              /** @default {} */
              variables: {
                [key: string]: components['schemas']['JsonValue'];
              };
              /** @default null */
              currentPage: string | null;
              /** @default [] */
              history: string[];
              /** @default {} */
              timers: {
                [key: string]: number;
              };
            };
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AgentDesktop.failure': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          /** @enum {string} */
          kind: 'script' | 'authorization' | 'network' | 'storage';
          correlationId: string;
        };
      };
    };
    responses: {
      /** @description Recorded */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            recorded: boolean;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'AgentDesktop.telemetry': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          expectedSequence: number;
          /** Format: uuid */
          tabId: string;
          writeToken: string;
          metadata: {
            /** @enum {string} */
            type: 'field.observed' | 'text.acknowledged';
            name: string;
            /** @enum {string} */
            status: 'success' | 'failure';
            durationMs: number;
          };
        };
      };
    };
    responses: {
      /** @description Authoritative state */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            state:
              'launching' | 'active' | 'paused' | 'wrapup' | 'completed' | 'abandoned' | 'expired';
            sequence: number;
            readOnly: boolean;
            snapshot: {
              /** @default {} */
              variables: {
                [key: string]: components['schemas']['JsonValue'];
              };
              /** @default null */
              currentPage: string | null;
              /** @default [] */
              history: string[];
              /** @default {} */
              timers: {
                [key: string]: number;
              };
            };
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Runtime.events': {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string;
        sort?: 'seq' | '-seq';
      };
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description A page of session events */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SessionEventPage'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'RuntimeCommands.outcome': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          expectedSequence: number;
          /** Format: uuid */
          tabId: string;
          writeToken: string;
          code: string;
          /** @default [] */
          subCodes?: string[];
          note?: string;
          /** @default {} */
          fields?: {
            [key: string]: components['schemas']['JsonValue'];
          };
          /** Format: date-time */
          callbackAt?: string;
        };
      };
    };
    responses: {
      /** @description Completed state */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            state:
              'launching' | 'active' | 'paused' | 'wrapup' | 'completed' | 'abandoned' | 'expired';
            sequence: number;
            readOnly: boolean;
            snapshot: {
              /** @default {} */
              variables: {
                [key: string]: components['schemas']['JsonValue'];
              };
              /** @default null */
              currentPage: string | null;
              /** @default [] */
              history: string[];
              /** @default {} */
              timers: {
                [key: string]: number;
              };
            };
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'RuntimeCommands.recording': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          expectedSequence: number;
          /** Format: uuid */
          tabId: string;
          writeToken: string;
          paused: boolean;
        };
      };
    };
    responses: {
      /** @description Updated state */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            state:
              'launching' | 'active' | 'paused' | 'wrapup' | 'completed' | 'abandoned' | 'expired';
            sequence: number;
            readOnly: boolean;
            snapshot: {
              /** @default {} */
              variables: {
                [key: string]: components['schemas']['JsonValue'];
              };
              /** @default null */
              currentPage: string | null;
              /** @default [] */
              history: string[];
              /** @default {} */
              timers: {
                [key: string]: number;
              };
            };
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'RuntimeCommands.release': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          /** Format: uuid */
          tabId: string;
          writeToken: string;
        };
      };
    };
    responses: {
      /** @description Read-only state */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            state:
              'launching' | 'active' | 'paused' | 'wrapup' | 'completed' | 'abandoned' | 'expired';
            sequence: number;
            readOnly: boolean;
            snapshot: {
              /** @default {} */
              variables: {
                [key: string]: components['schemas']['JsonValue'];
              };
              /** @default null */
              currentPage: string | null;
              /** @default [] */
              history: string[];
              /** @default {} */
              timers: {
                [key: string]: number;
              };
            };
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'RuntimeCommands.secure': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          expectedSequence: number;
          /** Format: uuid */
          tabId: string;
          writeToken: string;
          variable: string;
          receipt: string;
        };
      };
    };
    responses: {
      /** @description Updated state */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            state:
              'launching' | 'active' | 'paused' | 'wrapup' | 'completed' | 'abandoned' | 'expired';
            sequence: number;
            readOnly: boolean;
            snapshot: {
              /** @default {} */
              variables: {
                [key: string]: components['schemas']['JsonValue'];
              };
              /** @default null */
              currentPage: string | null;
              /** @default [] */
              history: string[];
              /** @default {} */
              timers: {
                [key: string]: number;
              };
            };
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'RuntimeCommands.ticket': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          /** @default 0 */
          afterSequence?: number;
        };
      };
    };
    responses: {
      /** @description 30-second ticket */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            ticket: string;
            expiresIn: number;
            /** @constant */
            namespace: '/runtime';
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'RuntimeCommands.state': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Runtime state */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            state:
              'launching' | 'active' | 'paused' | 'wrapup' | 'completed' | 'abandoned' | 'expired';
            sequence: number;
            readOnly: boolean;
            snapshot: {
              /** @default {} */
              variables: {
                [key: string]: components['schemas']['JsonValue'];
              };
              /** @default null */
              currentPage: string | null;
              /** @default [] */
              history: string[];
              /** @default {} */
              timers: {
                [key: string]: number;
              };
            };
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'RuntimeCommands.takeover': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          /** Format: uuid */
          tabId: string;
        };
      };
    };
    responses: {
      /** @description Writer lease */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            state:
              'launching' | 'active' | 'paused' | 'wrapup' | 'completed' | 'abandoned' | 'expired';
            sequence: number;
            readOnly: boolean;
            snapshot: {
              /** @default {} */
              variables: {
                [key: string]: components['schemas']['JsonValue'];
              };
              /** @default null */
              currentPage: string | null;
              /** @default [] */
              history: string[];
              /** @default {} */
              timers: {
                [key: string]: number;
              };
            };
            writeToken?: string;
            leaseUntil: string | null;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'RuntimeCommands.transfer': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          expectedSequence: number;
          /** Format: uuid */
          tabId: string;
          writeToken: string;
          /** Format: uuid */
          targetSessionId: string;
          targetSequence: number;
          variables: string[];
        };
      };
    };
    responses: {
      /** @description Source state */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            state:
              'launching' | 'active' | 'paused' | 'wrapup' | 'completed' | 'abandoned' | 'expired';
            sequence: number;
            readOnly: boolean;
            snapshot: {
              /** @default {} */
              variables: {
                [key: string]: components['schemas']['JsonValue'];
              };
              /** @default null */
              currentPage: string | null;
              /** @default [] */
              history: string[];
              /** @default {} */
              timers: {
                [key: string]: number;
              };
            };
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Integrations.execute': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
        sessionId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          input: unknown;
          scenario?: string;
          /**
           * @default prod
           * @enum {string}
           */
          environment?: 'dev' | 'test' | 'prod';
        };
      };
    };
    responses: {
      /** @description Mapped and schema-validated result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'SharedScreens.list': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Shared screens */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'SharedScreens.create': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateSharedScreen'];
      };
    };
    responses: {
      /** @description Created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'SharedScreens.impact': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Impact */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'SharedScreens.publish': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PublishSharedScreenVersion'];
      };
    };
    responses: {
      /** @description Published with impact */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'SiemDestinations.list': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Destinations */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SiemDestination'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'SiemDestinations.create': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateSiemDestination'];
      };
    };
    responses: {
      /** @description Created */
      201: {
        headers: {
          /** @description Current version */
          etag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SiemDestination'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'SiemDestinations.remove': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Deleted */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'SiemDestinations.update': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdateSiemDestination'];
      };
    };
    responses: {
      /** @description Updated */
      200: {
        headers: {
          /** @description New version */
          etag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SiemDestination'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Simulator.state': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description State */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SimulatorState'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Simulator.create': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SimulatedInteraction'];
      };
    };
    responses: {
      /** @description Simulated interaction */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Simulator.act': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        platformInteractionId: string;
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SimulatorAction'];
      };
    };
    responses: {
      /** @description Updated simulated interaction */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'RuntimeSupervisor.list': {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string;
        sort?: 'createdAt' | '-createdAt' | 'startedAt' | '-startedAt';
        state?:
          'launching' | 'paused' | 'active' | 'wrapup' | 'completed' | 'abandoned' | 'expired';
        /** @description UUIDv7 identifier */
        userId?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Live sessions */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SessionPage'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'RuntimeSupervisor.ticket': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          /** @default 0 */
          afterSequence?: number;
        };
      };
    };
    responses: {
      /** @description 30-second ticket */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            ticket: string;
            expiresIn: number;
            /** @constant */
            namespace: '/runtime';
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'RuntimeSupervisor.state': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Supervisor view */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            state:
              'launching' | 'active' | 'paused' | 'wrapup' | 'completed' | 'abandoned' | 'expired';
            sequence: number;
            readOnly: boolean;
            snapshot: {
              /** @default {} */
              variables: {
                [key: string]: components['schemas']['JsonValue'];
              };
              /** @default null */
              currentPage: string | null;
              /** @default [] */
              history: string[];
              /** @default {} */
              timers: {
                [key: string]: number;
              };
            };
          };
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Templates.list': {
    parameters: {
      query?: {
        category?:
          'sales' | 'service' | 'collections' | 'survey' | 'retention' | 'onboarding' | 'other';
        q?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Templates */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Templates.create': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateTemplate'];
      };
    };
    responses: {
      /** @description Created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Templates.instantiate': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['InstantiateTemplate'];
      };
    };
    responses: {
      /** @description Script created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Tenancy.current': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The tenant */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Tenant'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Tenancy.updateSettings': {
    parameters: {
      query?: never;
      header: {
        /** @description Current ETag (optimistic locking). */
        'If-Match': string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UpdateTenantSettings'];
      };
    };
    responses: {
      /** @description Updated */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Tenant'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Identity.listUsers': {
    parameters: {
      query?: {
        limit?: number;
        cursor?: string;
        sort?: 'createdAt' | '-createdAt' | 'updatedAt' | '-updatedAt';
        status?: 'invited' | 'active' | 'suspended' | 'deprovisioned';
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description A page of users */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['UserPage'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'Identity.getUser': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The user */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['User'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.userRoles': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Role assignments */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['UserRoleAssignments'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.setUserRoles': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SetUserRoles'];
      };
    };
    responses: {
      /** @description Role assignments */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['UserRoleAssignments'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.userSessions': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Sessions */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SessionList'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.endUserSessions': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Ended */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SessionsTerminated'];
        };
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
  'IdentityAdmin.endUserSession': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        sessionId: string;
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Ended */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Error (RFC 7807) */
      default: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/problem+json': components['schemas']['ProblemDetails'];
        };
      };
    };
  };
}
