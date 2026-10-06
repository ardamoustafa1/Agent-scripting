-- No bodies or user/customer identities are persisted in this projection.
CREATE TABLE analytics_facts (
 tenant_id uuid NOT NULL REFERENCES tenants(id), event_id uuid NOT NULL, occurred_at timestamptz NOT NULL,
 session_id uuid NOT NULL, fact jsonb NOT NULL, PRIMARY KEY(tenant_id,event_id,occurred_at)
);
CREATE INDEX analytics_facts_time ON analytics_facts(tenant_id,occurred_at,session_id);
CREATE INDEX analytics_facts_session ON analytics_facts(tenant_id,session_id,occurred_at);
ALTER TABLE analytics_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_facts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_facts USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,DELETE ON analytics_facts TO verbis_app;
-- TimescaleDB is installed by the operator, never by the application role.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='timescaledb') THEN
 PERFORM create_hypertable('analytics_facts','occurred_at',if_not_exists=>true);
END IF; END $$;
CREATE TABLE analytics_schedules (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), owner_id uuid NOT NULL REFERENCES users(id),
 definition jsonb NOT NULL, next_run_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 created_by varchar(128) NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar(128) NOT NULL,
 version integer NOT NULL DEFAULT 1, deleted_at timestamptz
);
ALTER TABLE analytics_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_schedules USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON analytics_schedules TO verbis_app;

-- Minimal worker inventory; contains no identities or secret values.
CREATE FUNCTION analytics_active_tenants() RETURNS TABLE(id uuid,settings jsonb) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT id,jsonb_build_object('audit',settings->'audit') FROM public.tenants WHERE status='active' AND deleted_at IS NULL $$;
REVOKE ALL ON FUNCTION analytics_active_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics_active_tenants() TO verbis_app;

-- Tombstones prevent retained NATS messages from resurrecting erased session projections.
CREATE TABLE analytics_erased_sessions(tenant_id uuid NOT NULL REFERENCES tenants(id),session_id uuid NOT NULL,erased_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,session_id));
ALTER TABLE analytics_erased_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_erased_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_erased_sessions USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT ON analytics_erased_sessions TO verbis_app;
