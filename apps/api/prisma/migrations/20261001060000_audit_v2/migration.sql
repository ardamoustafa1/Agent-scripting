-- Audit v2 (ADR-0014): ULID ids, richer event shape, monthly range partitions, chain heads,
-- signed checkpoints, WORM archive registry, SIEM delivery cursors, hash-chained session events.
-- Reviewed SQL: Prisma does not model partitions, generated tsvector columns or role policies.

-- ─── Roles ────────────────────────────────────────────────────────────────────
-- The audit worker is a separate process with its own least-privilege role. NOLOGIN here;
-- `pnpm db:app-role` enables LOGIN from DATABASE_AUDIT_WORKER_PASSWORD.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verbis_audit_worker') THEN
    CREATE ROLE verbis_audit_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;
ALTER ROLE verbis_audit_worker SET statement_timeout = '120s';
ALTER ROLE verbis_audit_worker SET idle_in_transaction_session_timeout = '60s';
GRANT USAGE ON SCHEMA public TO verbis_audit_worker;
GRANT EXECUTE ON FUNCTION app_current_tenant() TO verbis_audit_worker;

-- ─── audit_events → partitioned ──────────────────────────────────────────────
ALTER TABLE audit_events RENAME TO audit_events_v1;
ALTER TABLE audit_events_v1 RENAME CONSTRAINT audit_events_pkey TO audit_events_v1_pkey;
ALTER INDEX audit_events_tenant_seq_key RENAME TO audit_events_v1_tenant_seq_key;
ALTER INDEX audit_events_tenant_id_occurred_at_idx RENAME TO audit_events_v1_tenant_occurred_idx;
ALTER INDEX audit_events_tenant_id_target_type_target_id_idx RENAME TO audit_events_v1_tenant_target_idx;
DROP TRIGGER audit_events_append_only ON audit_events_v1;
DROP TRIGGER audit_events_no_truncate ON audit_events_v1;

CREATE TABLE audit_events (
  id                 VARCHAR(36)     NOT NULL,
  tenant_id          UUID            NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  seq                BIGINT          NOT NULL CHECK (seq > 0),
  -- 1 = prompt-3 hash input (migrated rows), 2 = ADR-0014 hash input.
  hash_version       SMALLINT        NOT NULL DEFAULT 2 CHECK (hash_version IN (1, 2)),
  action             TEXT            NOT NULL CHECK (action ~ '^[a-z][a-zA-Z]*(\.[a-z][a-zA-Z]*){1,2}$'),
  actor_type         TEXT            NOT NULL CHECK (actor_type IN ('user', 'system', 'apiClient', 'connector', 'service')),
  actor_id           VARCHAR(128)    NOT NULL,
  -- displayName (@pii), ip (@pii), userAgent, sessionId.
  actor              JSONB           NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(actor) = 'object'),
  target_type        TEXT            NOT NULL,
  target_id          TEXT            NOT NULL,
  target_name        TEXT,
  outcome            audit_outcome   NOT NULL,
  reason             TEXT,
  -- {mode: 'snapshot', before, after} | {mode: 'patch', ops: RFC 6902}; PII masked before insert.
  diff               JSONB,
  correlation_id     TEXT            NOT NULL,
  interaction_id     TEXT,
  metadata           JSONB           NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at        TIMESTAMPTZ(3)  NOT NULL,
  -- Chain time: monotonic per tenant, the partition key (seq order == partition order).
  recorded_at        TIMESTAMPTZ(3)  NOT NULL,
  prev_hash          CHAR(64)        NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  hash               CHAR(64)        NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  search             TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(action, '') || ' ' || coalesce(target_type, '') || ' ' || coalesce(target_id, '') || ' ' ||
      coalesce(target_name, '') || ' ' || coalesce(reason, '') || ' ' || coalesce(actor_id, '') || ' ' ||
      coalesce(correlation_id, ''))
  ) STORED,
  CONSTRAINT audit_events_pkey PRIMARY KEY (tenant_id, seq, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE UNIQUE INDEX audit_events_id_key ON audit_events (id, recorded_at);
CREATE INDEX audit_events_tenant_occurred_idx ON audit_events (tenant_id, occurred_at DESC);
CREATE INDEX audit_events_tenant_target_idx ON audit_events (tenant_id, target_type, target_id);
CREATE INDEX audit_events_tenant_actor_idx ON audit_events (tenant_id, actor_type, actor_id);
CREATE INDEX audit_events_tenant_action_idx ON audit_events (tenant_id, action);
CREATE INDEX audit_events_tenant_correlation_idx ON audit_events (tenant_id, correlation_id);
CREATE INDEX audit_events_search_idx ON audit_events USING GIN (search);

-- Catch-all for clock anomalies; normal rows always land in a monthly partition.
CREATE TABLE audit_events_default PARTITION OF audit_events DEFAULT;

-- ─── session_events → partitioned and hash-chained per session ───────────────
ALTER TABLE session_events RENAME TO session_events_v1;
ALTER TABLE session_events_v1 RENAME CONSTRAINT session_events_pkey TO session_events_v1_pkey;
ALTER INDEX session_events_session_seq_key RENAME TO session_events_v1_session_seq_key;
ALTER INDEX session_events_tenant_id_occurred_at_idx RENAME TO session_events_v1_tenant_occurred_idx;
DROP TRIGGER session_events_append_only ON session_events_v1;
DROP TRIGGER session_events_no_truncate ON session_events_v1;

CREATE TABLE session_events (
  id           UUID            NOT NULL,
  tenant_id    UUID            NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  session_id   UUID            NOT NULL REFERENCES sessions (id) ON DELETE RESTRICT,
  seq          INTEGER         NOT NULL CHECK (seq > 0),
  type         TEXT            NOT NULL,
  -- Agent input per page/field; redacted per variable classification before insert.
  payload      JSONB           NOT NULL DEFAULT '{}',
  actor_id     VARCHAR(128),
  page_id      TEXT,
  occurred_at  TIMESTAMPTZ(3)  NOT NULL,
  recorded_at  TIMESTAMPTZ(3)  NOT NULL,
  created_at   TIMESTAMPTZ(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by   VARCHAR(128)    NOT NULL,
  prev_hash    CHAR(64)        NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  hash         CHAR(64)        NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT session_events_pkey PRIMARY KEY (session_id, seq, recorded_at)
) PARTITION BY RANGE (recorded_at);
CREATE UNIQUE INDEX session_events_id_key ON session_events (id, recorded_at);
CREATE INDEX session_events_tenant_occurred_idx ON session_events (tenant_id, occurred_at);
CREATE TABLE session_events_default PARTITION OF session_events DEFAULT;

-- ─── Chain heads (one row per tenant stream / per session) ───────────────────
-- The row lock serializes appends; seq/hash here are a cache that verification never trusts.
CREATE TABLE audit_chain_heads (
  tenant_id    UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  seq          BIGINT         NOT NULL DEFAULT 0,
  hash         CHAR(64)       NOT NULL,
  recorded_at  TIMESTAMPTZ(3) NOT NULL DEFAULT '1970-01-01T00:00:00Z',
  CONSTRAINT audit_chain_heads_pkey PRIMARY KEY (tenant_id)
);
CREATE TABLE session_chain_heads (
  session_id   UUID           NOT NULL REFERENCES sessions (id) ON DELETE RESTRICT,
  tenant_id    UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  seq          INTEGER        NOT NULL DEFAULT 0,
  hash         CHAR(64)       NOT NULL,
  recorded_at  TIMESTAMPTZ(3) NOT NULL DEFAULT '1970-01-01T00:00:00Z',
  -- Set when the session's final head was anchored in the tenant audit chain.
  sealed_at    TIMESTAMPTZ(3),
  CONSTRAINT session_chain_heads_pkey PRIMARY KEY (session_id)
);
CREATE INDEX session_chain_heads_tenant_recorded_idx ON session_chain_heads (tenant_id, recorded_at);

-- ─── Checkpoints (Ed25519-signed chain heads) ────────────────────────────────
CREATE TABLE audit_checkpoints (
  id                   VARCHAR(26)    NOT NULL,
  tenant_id            UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  seq                  BIGINT         NOT NULL,
  hash                 CHAR(64)       NOT NULL,
  -- Digest over (sessionId, seq, hash) of session chains that moved since the previous checkpoint.
  session_heads_digest CHAR(64)       NOT NULL,
  session_heads_count  INTEGER        NOT NULL DEFAULT 0,
  prev_checkpoint_id   VARCHAR(26),
  key_id               TEXT           NOT NULL,
  signature            TEXT           NOT NULL,
  signed_at            TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT audit_checkpoints_pkey PRIMARY KEY (id),
  CONSTRAINT audit_checkpoints_tenant_seq_key UNIQUE (tenant_id, seq)
);

-- ─── WORM archive registry ───────────────────────────────────────────────────
CREATE TABLE audit_archives (
  id              VARCHAR(26)    NOT NULL,
  tenant_id       UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  stream          TEXT           NOT NULL CHECK (stream IN ('audit', 'session')),
  partition_name  TEXT           NOT NULL,
  from_seq        BIGINT,
  to_seq          BIGINT,
  row_count       BIGINT         NOT NULL,
  object_key      TEXT           NOT NULL,
  sha256          CHAR(64)       NOT NULL,
  retain_until    TIMESTAMPTZ(3) NOT NULL,
  -- `uploaded` → `verified` (object re-read and checksum compared).
  status          TEXT           NOT NULL CHECK (status IN ('uploaded', 'verified')),
  created_at      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT audit_archives_pkey PRIMARY KEY (id),
  CONSTRAINT audit_archives_unique UNIQUE (tenant_id, stream, partition_name, status)
);

-- ─── SIEM destinations and delivery cursors ──────────────────────────────────
CREATE TABLE siem_destinations (
  id            UUID           NOT NULL,
  tenant_id     UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  name          TEXT           NOT NULL,
  kind          TEXT           NOT NULL CHECK (kind IN ('syslog', 'webhook', 'kafka')),
  format        TEXT           NOT NULL CHECK (format IN ('rfc5424', 'cef', 'json')),
  -- Non-secret settings (host, port, url, topic, facility…). Secrets are secretRefs only.
  config        JSONB          NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(config) = 'object'),
  secret_ref    TEXT,
  enabled       BOOLEAN        NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by    VARCHAR(128)   NOT NULL,
  updated_at    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by    VARCHAR(128)   NOT NULL,
  deleted_at    TIMESTAMPTZ(3),
  version       INTEGER        NOT NULL DEFAULT 1,
  CONSTRAINT siem_destinations_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX siem_destinations_tenant_name_key ON siem_destinations (tenant_id, name) WHERE deleted_at IS NULL;

-- Ordered, at-least-once delivery: the cursor only advances after the sink acknowledged.
CREATE TABLE siem_cursors (
  destination_id  UUID           NOT NULL REFERENCES siem_destinations (id) ON DELETE RESTRICT,
  tenant_id       UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  last_seq        BIGINT         NOT NULL DEFAULT 0,
  attempts        INTEGER        NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error      TEXT,
  delivered_at    TIMESTAMPTZ(3),
  CONSTRAINT siem_cursors_pkey PRIMARY KEY (destination_id)
);

-- ─── Owner-only policy: global retention floor for partition drops ───────────
CREATE TABLE audit_policy (
  singleton           BOOLEAN NOT NULL DEFAULT true PRIMARY KEY CHECK (singleton),
  min_retention_days  INTEGER NOT NULL DEFAULT 365 CHECK (min_retention_days >= 30)
);
INSERT INTO audit_policy DEFAULT VALUES;

-- ─── Append-only enforcement (triggers + grants) ─────────────────────────────
-- Row triggers on a partitioned parent are inherited by every partition, existing and future.
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER session_events_append_only BEFORE UPDATE OR DELETE ON session_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_checkpoints_append_only BEFORE UPDATE OR DELETE ON audit_checkpoints
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_archives_append_only BEFORE UPDATE OR DELETE ON audit_archives
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- TRUNCATE triggers are per table: install on the parents and on every partition.
CREATE OR REPLACE FUNCTION audit_install_truncate_guard(p_table regclass) RETURNS void
  LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format(
    'CREATE OR REPLACE TRIGGER no_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()',
    p_table);
END
$$;
ALTER TABLE audit_events_default ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_events_default ENABLE ROW LEVEL SECURITY;
SELECT audit_install_truncate_guard(t) FROM unnest(ARRAY[
  'audit_events'::regclass, 'audit_events_default'::regclass,
  'session_events'::regclass, 'session_events_default'::regclass,
  'audit_checkpoints'::regclass, 'audit_archives'::regclass]) AS t;

GRANT SELECT, INSERT ON audit_events, session_events TO verbis_app;
GRANT SELECT, INSERT, UPDATE ON audit_chain_heads, session_chain_heads TO verbis_app;
GRANT SELECT ON audit_checkpoints, audit_archives TO verbis_app;
GRANT SELECT, INSERT, UPDATE ON siem_destinations TO verbis_app;
GRANT SELECT, INSERT ON siem_cursors TO verbis_app;

GRANT SELECT, INSERT ON audit_events, session_events, audit_checkpoints, audit_archives TO verbis_audit_worker;
GRANT SELECT, INSERT, UPDATE ON audit_chain_heads, session_chain_heads, siem_cursors TO verbis_audit_worker;
GRANT SELECT ON siem_destinations, tenants, sessions, audit_policy TO verbis_audit_worker;
GRANT SELECT, INSERT, UPDATE ON outbox_events, processed_events TO verbis_audit_worker;

-- ─── Partition maintenance (SECURITY DEFINER, worker only) ───────────────────
-- Monthly partitions `<parent>_yYYYYmMM`, created ahead of time.
CREATE OR REPLACE FUNCTION audit_ensure_partitions(p_months_ahead integer) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  parent text;
  m integer;
  start_at timestamptz;
  name text;
  created integer := 0;
BEGIN
  IF p_months_ahead < 0 OR p_months_ahead > 24 THEN
    RAISE EXCEPTION 'p_months_ahead out of range';
  END IF;
  FOREACH parent IN ARRAY ARRAY['audit_events', 'session_events'] LOOP
    FOR m IN -1..p_months_ahead LOOP
      start_at := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + make_interval(months => m);
      name := format('%s_y%sm%s', parent, to_char(start_at AT TIME ZONE 'UTC', 'YYYY'), to_char(start_at AT TIME ZONE 'UTC', 'MM'));
      IF to_regclass(name) IS NULL THEN
        EXECUTE format('CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
          name, parent, start_at, start_at + interval '1 month');
        PERFORM audit_install_truncate_guard(name::regclass);
        -- Defense in depth: partitions have no grants; RLS without policies denies direct reads.
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
        created := created + 1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN created;
END
$$;

-- Detaches and drops one monthly partition, only if it ended before the global retention floor
-- and EVERY tenant with rows in it (computed here, not trusted from the caller) has a `verified`
-- WORM archive of it (recorded by the worker after re-reading the object). The floor is owner-only.
CREATE OR REPLACE FUNCTION audit_drop_partition(p_partition text) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  parent text;
  upper_bound timestamptz;
  floor_days integer;
  missing integer;
  v_stream text;
  v_tenants uuid[];
BEGIN
  IF p_partition !~ '^(audit_events|session_events)_y[0-9]{4}m[0-9]{2}$' THEN
    RAISE EXCEPTION 'not a monthly audit partition: %', p_partition;
  END IF;
  IF to_regclass(p_partition) IS NULL THEN
    RAISE EXCEPTION 'partition % does not exist', p_partition;
  END IF;
  parent := substring(p_partition from '^(audit_events|session_events)');
  v_stream := CASE parent WHEN 'audit_events' THEN 'audit' ELSE 'session' END;
  upper_bound := make_timestamptz(
    substring(p_partition from 'y([0-9]{4})')::int, substring(p_partition from 'm([0-9]{2})$')::int, 1, 0, 0, 0, 'UTC')
    + interval '1 month';
  SELECT min_retention_days INTO floor_days FROM audit_policy;
  IF upper_bound > now() - make_interval(days => floor_days) THEN
    RAISE EXCEPTION 'partition % is inside the retention floor (% days)', p_partition, floor_days;
  END IF;
  -- Owner reads the partition directly (RLS ENABLEd, not forced, on partitions).
  EXECUTE format('SELECT coalesce(array_agg(DISTINCT tenant_id), ARRAY[]::uuid[]) FROM %I', p_partition) INTO v_tenants;
  SELECT count(*) INTO missing FROM unnest(v_tenants) AS t(tenant_id)
   WHERE NOT EXISTS (
     SELECT 1 FROM audit_archives a
      WHERE a.tenant_id = t.tenant_id AND a.stream = v_stream
        AND a.partition_name = p_partition AND a.status = 'verified');
  IF missing > 0 THEN
    RAISE EXCEPTION 'partition % has % tenant(s) without a verified archive', p_partition, missing;
  END IF;
  EXECUTE format('ALTER TABLE %I DETACH PARTITION %I', parent, p_partition);
  EXECUTE format('DROP TABLE %I', p_partition);
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION audit_ensure_partitions(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_drop_partition(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_install_truncate_guard(regclass) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_ensure_partitions(integer) TO verbis_audit_worker;
GRANT EXECUTE ON FUNCTION audit_drop_partition(text) TO verbis_audit_worker;

-- Monthly partitions around now so the first writes never land in the default partition.
SELECT audit_ensure_partitions(3);

-- ─── Migrate v1 rows (hash_version 1 keeps their original hashes verifiable) ──
INSERT INTO audit_events (
  id, tenant_id, seq, hash_version, action, actor_type, actor_id, actor, target_type, target_id,
  target_name, outcome, diff, correlation_id, occurred_at, recorded_at, prev_hash, hash)
SELECT id::text, tenant_id, seq, 1, action, actor_type, actor_id, actor, target_type, target_id,
       target_name, outcome, diff, correlation_id, occurred_at, occurred_at, prev_hash, hash
  FROM audit_events_v1;
INSERT INTO audit_chain_heads (tenant_id, seq, hash, recorded_at)
SELECT DISTINCT ON (tenant_id) tenant_id, seq, hash, occurred_at
  FROM audit_events_v1 ORDER BY tenant_id, seq DESC;
-- Session events had no chain; none exist before the runtime (step 24). Fail loudly otherwise.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM session_events_v1) THEN
    RAISE EXCEPTION 'session_events_v1 is not empty; migrate it with a reviewed chain backfill';
  END IF;
END
$$;
DROP TABLE session_events_v1;
-- v1 audit rows were copied verbatim; the old table is kept read-only for one release.
REVOKE ALL ON audit_events_v1 FROM verbis_app;
CREATE TRIGGER audit_events_v1_append_only BEFORE INSERT OR UPDATE OR DELETE ON audit_events_v1
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_events_v1_no_truncate BEFORE TRUNCATE ON audit_events_v1
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- ─── Row-Level Security ──────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audit_events', 'session_events', 'audit_chain_heads', 'session_chain_heads',
    'audit_checkpoints', 'audit_archives', 'siem_destinations', 'siem_cursors'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- audit_archives is only ENABLEd: audit_drop_partition (owner, SECURITY DEFINER) reads it
    -- across tenants. Runtime roles are never the owner, so RLS still applies to them.
    IF t <> 'audit_archives' THEN
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    END IF;
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) '
      'WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END
$$;
-- The worker discovers work across tenants (read-only); every write still runs in a tenant tx.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audit_events', 'session_events', 'audit_chain_heads', 'session_chain_heads',
    'audit_checkpoints', 'audit_archives', 'siem_destinations', 'siem_cursors'
  ] LOOP
    EXECUTE format('CREATE POLICY audit_worker_read ON %I FOR SELECT TO verbis_audit_worker USING (true)', t);
  END LOOP;
END
$$;

-- Worker: active tenants (cross-tenant discovery without reading tenant rows).
CREATE OR REPLACE FUNCTION audit_active_tenants() RETURNS TABLE (id uuid, settings jsonb)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$ SELECT t.id, t.settings FROM tenants t WHERE t.status = 'active' AND t.deleted_at IS NULL $$;
REVOKE ALL ON FUNCTION audit_active_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_active_tenants() TO verbis_audit_worker;

-- Low-latency wake-up for the worker (SIEM, checkpoints); payload is the tenant id only.
CREATE OR REPLACE FUNCTION audit_notify_appended() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('verbis_audit_appended', NEW.tenant_id::text);
  RETURN NULL;
END
$$;
CREATE TRIGGER audit_chain_heads_notify AFTER INSERT OR UPDATE ON audit_chain_heads
  FOR EACH ROW EXECUTE FUNCTION audit_notify_appended();
