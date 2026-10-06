# ADR-0042: Named, read-only SQL through the customer gateway

Date: 2026-10-06. Status: accepted for the first PostgreSQL slice.

## Context

R-X1 requires access to databases inside customer networks. Sending arbitrary SQL or database passwords from a browser would bypass the existing tenant, session, version pin, secret and egress boundaries.

## Decision

Add `sql` to the DataSource protocol enum with an additive PostgreSQL migration. SQL definitions require `privateGateway: {clientId, target}` and `sql: {queryKey, parameters}`. The parameter array contains input paths in positional order; only strings, finite numbers, booleans and null are accepted. Query text is absent from both browser input and API jobs.

The outbound worker owns an operator-provisioned query catalog and a separate credentials file. Its PostgreSQL driver validates the target's explicit RFC1918 IPv4 CIDRs, pins the DNS answer, verifies TLS with the original host name (or an explicit local plaintext opt-in), executes `BEGIN READ ONLY`, applies statement/lock timeouts and passes parameter values separately to `pg`. It wraps the catalog query in a SELECT with a bounded row limit. It rejects unknown queries, parameter-count mismatch, multi-statement text, mutation, row overflow and oversized results. Query catalogs are trusted operator configuration; database accounts must have SELECT-only grants on approved views, no CREATE/EXECUTE grants on unsafe functions, and no superuser privileges.

The existing IntegrationExecutor still applies input/output schemas, response mapping, redacted console traces, bulkhead, breaker, timeout, session ownership, pinned DataSource version and audited execution. SQL is never retried automatically. Private results cannot enter the integration result cache. Local credentials are scrubbed from responses.

## First slice and limits

Implemented: PostgreSQL named reads, outbound gateway transport, additive schema migration, API create/list/test/runtime compatibility, and a runnable customer worker. SQL configuration is provisioned through the API; the Designer's full SQL form and query-catalog administration are follow-ups. MySQL, ODBC, writes, streamed result cursors and query planning are deferred. Row/byte limits constrain returned data; the trusted catalog must also limit row width and cost because the first driver materializes rows before the byte check.

Tests include real PostgreSQL transaction enforcement and parameter injection, Redis job isolation, replay rejection and schema/egress denial. These are local fixtures; customer database and vendor acceptance remain deployment checks.
