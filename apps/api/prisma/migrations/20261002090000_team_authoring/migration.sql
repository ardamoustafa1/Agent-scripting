CREATE TABLE authoring_threads (
 id uuid PRIMARY KEY , tenant_id uuid NOT NULL REFERENCES tenants(id), script_version_id uuid NOT NULL REFERENCES script_versions(id), node_id varchar(128) NOT NULL, resolved boolean NOT NULL DEFAULT false, messages jsonb NOT NULL DEFAULT '[]', version integer NOT NULL DEFAULT 1,
 created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL);
CREATE INDEX authoring_threads_version_idx ON authoring_threads(tenant_id,script_version_id);
CREATE TABLE collaboration_snapshots (
 id uuid PRIMARY KEY , tenant_id uuid NOT NULL REFERENCES tenants(id), script_version_id uuid NOT NULL REFERENCES script_versions(id), state bytea NOT NULL, version integer NOT NULL,
 updated_at timestamptz(3) NOT NULL, UNIQUE(tenant_id,script_version_id));
ALTER TABLE authoring_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE authoring_threads FORCE ROW LEVEL SECURITY;
CREATE POLICY authoring_threads_tenant ON authoring_threads USING (tenant_id = current_setting('app.tenant_id',true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id',true)::uuid);
ALTER TABLE collaboration_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY collaboration_snapshots_tenant ON collaboration_snapshots USING (tenant_id = current_setting('app.tenant_id',true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id',true)::uuid);

CREATE TABLE scheduled_releases (id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),script_id uuid NOT NULL REFERENCES scripts(id),number integer NOT NULL,checksum char(64) NOT NULL,requested_by uuid NOT NULL REFERENCES users(id),run_at timestamptz(3) NOT NULL,state varchar(16) NOT NULL DEFAULT 'pending',created_at timestamptz(3) NOT NULL DEFAULT now(),completed_at timestamptz(3));
CREATE INDEX scheduled_releases_tenant_script_idx ON scheduled_releases(tenant_id,script_id);
ALTER TABLE scheduled_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_releases FORCE ROW LEVEL SECURITY;
CREATE POLICY scheduled_releases_tenant ON scheduled_releases USING (tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK (tenant_id=current_setting('app.tenant_id',true)::uuid);

-- Runtime role remains non-owner; FORCE RLS applies to all new authoring writes.
GRANT SELECT, INSERT, UPDATE ON authoring_threads, collaboration_snapshots, scheduled_releases TO verbis_app;
