-- Tenant isolation, least-privilege runtime role, append-only guarantees (ADR-0003, ADR-0011).
-- Prisma does not model these objects; they are reviewed SQL and covered by the RLS integration suite.

-- ─── Runtime role ─────────────────────────────────────────────────────────────
-- Migrations run as the schema owner. The API connects as `verbis_app`, which can never bypass RLS.
-- The role is created NOLOGIN here; `pnpm db:app-role` enables LOGIN with a password from the
-- environment (passwords never live in migrations).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verbis_app') THEN
    CREATE ROLE verbis_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE verbis_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE verbis_app SET statement_timeout = '30s';

GRANT USAGE ON SCHEMA public TO verbis_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Domain tables: read, insert, update. Hard deletes are not part of the domain (soft delete).
GRANT SELECT, INSERT, UPDATE ON
  users, roles, user_roles, identity_providers, campaigns, assignments, scripts, script_versions,
  screens, components, flows, variables, data_sources, secrets, channels, connectors, interactions,
  sessions, outcomes, analytics_event_counts
TO verbis_app;
-- Read models are rebuilt per script version.
GRANT DELETE ON screens, components, flows, variables TO verbis_app;
-- Own tenant row only (via RLS); provisioning uses the owner connection.
GRANT SELECT, UPDATE ON tenants TO verbis_app;
-- Append-only tables.
GRANT SELECT, INSERT ON audit_events, session_events, outbox_events, processed_events TO verbis_app;
-- Idempotency records are short-lived.
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO verbis_app;

-- ─── Tenant context ───────────────────────────────────────────────────────────
-- `SET LOCAL app.tenant_id = '<uuid>'` is issued by the API at the start of every transaction.
-- Missing context yields NULL, so policies match nothing (fail closed); a malformed value raises.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

GRANT EXECUTE ON FUNCTION app_current_tenant() TO verbis_app;

-- ─── Row-Level Security ───────────────────────────────────────────────────────
-- FORCE makes the policies apply to the table owner too. `tenants` and `outbox_events` are only
-- ENABLEd: SECURITY DEFINER functions below (owned by the migration role) need cross-tenant access
-- for CORS origin lookup and the outbox relay. `verbis_app` is never the owner, so RLS always
-- applies to it.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'roles', 'user_roles', 'identity_providers', 'campaigns', 'assignments', 'scripts',
    'script_versions', 'screens', 'components', 'flows', 'variables', 'data_sources', 'secrets',
    'channels', 'connectors', 'interactions', 'sessions', 'session_events', 'outcomes',
    'audit_events', 'processed_events', 'idempotency_keys', 'analytics_event_counts'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) '
      'WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END
$$;

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON outbox_events
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = app_current_tenant())
  WITH CHECK (id = app_current_tenant());

-- ─── Append-only enforcement ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (% is not allowed)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER session_events_append_only BEFORE UPDATE OR DELETE ON session_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER session_events_no_truncate BEFORE TRUNCATE ON session_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- ─── Script version document storage ──────────────────────────────────────────
-- Exactly one representation: JSONB, or gzip bytes for large documents.
ALTER TABLE script_versions ADD CONSTRAINT script_versions_document_encoding_check CHECK (
  (document_encoding = 'json' AND document IS NOT NULL AND document_compressed IS NULL)
  OR (document_encoding = 'gzip' AND document IS NULL AND document_compressed IS NOT NULL)
);
ALTER TABLE script_versions ADD CONSTRAINT script_versions_checksum_check
  CHECK (checksum ~ '^[0-9a-f]{64}$');
-- TOAST compression for JSONB documents (PostgreSQL 14+ built with lz4).
ALTER TABLE script_versions ALTER COLUMN document SET COMPRESSION lz4;

-- Optimistic-lock versions are positive.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants', 'users', 'roles', 'user_roles', 'identity_providers', 'campaigns', 'assignments',
    'scripts', 'script_versions', 'screens', 'components', 'flows', 'variables', 'data_sources',
    'secrets', 'channels', 'connectors', 'interactions', 'sessions', 'outcomes'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (version > 0)', t, t || '_version_check');
  END LOOP;
END
$$;

-- ─── Cross-tenant system operations (SECURITY DEFINER, minimal surface) ───────

-- CORS: is `p_origin` allow-listed by any active tenant? Returns a boolean only.
CREATE OR REPLACE FUNCTION tenant_origin_allowed(p_origin text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenants
    WHERE status = 'active' AND deleted_at IS NULL
      AND jsonb_typeof(settings -> 'allowedOrigins') = 'array'
      AND (settings -> 'allowedOrigins') ? p_origin
  )
$$;

-- Outbox relay: lease a batch of due events (SKIP LOCKED keeps concurrent relays apart).
CREATE OR REPLACE FUNCTION outbox_claim(p_limit integer, p_lease_seconds integer)
  RETURNS SETOF outbox_events
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  UPDATE outbox_events o
     SET locked_until = now() + make_interval(secs => p_lease_seconds),
         attempts = o.attempts + 1
   WHERE o.id IN (
     SELECT id FROM outbox_events
      WHERE status = 'pending'
        AND available_at <= now()
        AND (locked_until IS NULL OR locked_until < now())
      ORDER BY available_at, id
      LIMIT LEAST(GREATEST(p_limit, 1), 500)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING o.*
$$;

CREATE OR REPLACE FUNCTION outbox_mark_published(p_ids uuid[]) RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  WITH updated AS (
    UPDATE outbox_events
       SET status = 'published', published_at = now(), locked_until = NULL, last_error = NULL
     WHERE id = ANY(p_ids) AND status = 'pending'
    RETURNING 1
  )
  SELECT count(*)::integer FROM updated
$$;

CREATE OR REPLACE FUNCTION outbox_mark_failed(
  p_id uuid, p_error text, p_retry_at timestamptz, p_dead boolean
) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  UPDATE outbox_events
     SET status = CASE WHEN p_dead THEN 'dead'::outbox_status ELSE 'pending'::outbox_status END,
         available_at = p_retry_at,
         locked_until = NULL,
         last_error = left(p_error, 500)
   WHERE id = p_id AND status = 'pending'
$$;

-- Retention: drop published events older than the given age.
CREATE OR REPLACE FUNCTION outbox_purge_published(p_older_than interval) RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  WITH deleted AS (
    DELETE FROM outbox_events WHERE status = 'published' AND published_at < now() - p_older_than
    RETURNING 1
  )
  SELECT count(*)::integer FROM deleted
$$;

-- Only the runtime role may call the definer functions.
REVOKE ALL ON FUNCTION tenant_origin_allowed(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION outbox_claim(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION outbox_mark_published(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION outbox_mark_failed(uuid, text, timestamptz, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION outbox_purge_published(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_origin_allowed(text) TO verbis_app;
GRANT EXECUTE ON FUNCTION outbox_claim(integer, integer) TO verbis_app;
GRANT EXECUTE ON FUNCTION outbox_mark_published(uuid[]) TO verbis_app;
GRANT EXECUTE ON FUNCTION outbox_mark_failed(uuid, text, timestamptz, boolean) TO verbis_app;
GRANT EXECUTE ON FUNCTION outbox_purge_published(interval) TO verbis_app;

-- Admin: requeue a dead-lettered event of the caller's tenant.
CREATE OR REPLACE FUNCTION outbox_requeue(p_id uuid) RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  WITH updated AS (
    UPDATE outbox_events
       SET status = 'pending', attempts = 0, available_at = now(), locked_until = NULL
     WHERE id = p_id AND status = 'dead' AND tenant_id = app_current_tenant()
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM updated)
$$;
REVOKE ALL ON FUNCTION outbox_requeue(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outbox_requeue(uuid) TO verbis_app;
