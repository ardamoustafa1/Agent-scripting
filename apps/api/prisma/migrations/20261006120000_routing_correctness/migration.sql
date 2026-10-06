CREATE INDEX sessions_tenant_active_idx ON sessions(tenant_id,state) WHERE deleted_at IS NULL;
CREATE INDEX sessions_interaction_idx ON sessions(tenant_id,interaction_id) WHERE deleted_at IS NULL;
CREATE TABLE session_capacity_reservations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  expires_at timestamptz(3) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX session_capacity_reservations_tenant_id_expires_at_idx ON session_capacity_reservations(tenant_id,expires_at);
ALTER TABLE session_capacity_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_capacity_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON session_capacity_reservations
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,DELETE ON session_capacity_reservations TO verbis_app;
CREATE FUNCTION consume_session_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expiry timestamptz;
BEGIN
  DELETE FROM session_capacity_reservations
    WHERE tenant_id=NEW.tenant_id AND id=NEW.id RETURNING expires_at INTO expiry;
  IF FOUND THEN
    IF expiry <= clock_timestamp() THEN RAISE EXCEPTION 'session capacity reservation expired' USING ERRCODE='40001'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sessions_consume_capacity BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION consume_session_capacity();
