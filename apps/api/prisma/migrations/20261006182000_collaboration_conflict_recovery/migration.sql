CREATE TABLE collaboration_conflicts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  script_version_id uuid NOT NULL REFERENCES script_versions(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  state bytea NOT NULL,
  base_version integer NOT NULL,
  current_version integer NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX collaboration_conflicts_tenant_id_script_version_id_created_idx
ON collaboration_conflicts(tenant_id, script_version_id, created_at);
ALTER TABLE collaboration_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_conflicts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON collaboration_conflicts
USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT ON collaboration_conflicts TO verbis_app;
