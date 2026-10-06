-- Immutable, append-only history of every data source revision (ADR-0042). Published script
-- versions pin (key, version); runtime resolves the pin here, never the live row.
-- Credentials are secretRefs only (UUIDs of secret metadata); no secret values exist in definitions.
CREATE TABLE data_source_versions (
  id             UUID           NOT NULL,
  tenant_id      UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  data_source_id UUID           NOT NULL REFERENCES data_sources (id) ON DELETE RESTRICT,
  key            TEXT           NOT NULL,
  version        INTEGER        NOT NULL,
  protocol       datasource_protocol NOT NULL,
  definition     JSONB          NOT NULL,
  secret_refs    UUID[]         NOT NULL DEFAULT '{}',
  policy         JSONB          NOT NULL,
  content_hash   CHAR(64)       NOT NULL,
  created_at     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by     VARCHAR(128)   NOT NULL,
  CONSTRAINT data_source_versions_pkey PRIMARY KEY (id),
  CONSTRAINT data_source_versions_hash_format CHECK (content_hash ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX data_source_versions_source_version_key ON data_source_versions (data_source_id, version);
CREATE INDEX data_source_versions_tenant_key_idx ON data_source_versions (tenant_id, key, version);

CREATE FUNCTION data_source_content_hash(k TEXT, p datasource_protocol, d JSONB, r UUID[], pol JSONB)
RETURNS CHAR(64) LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT encode(sha256(convert_to(
    jsonb_build_object('key', k, 'protocol', p::text, 'definition', d,
                       'secretRefs', to_jsonb(r), 'policy', pol)::text, 'UTF8')), 'hex')::char(64);
$$;

-- Snapshot on every create/update in the SAME transaction as the mutation (and its audit event).
-- Non-versioning updates (soft delete) hit ON CONFLICT and add nothing.
CREATE FUNCTION data_source_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO data_source_versions
    (id, tenant_id, data_source_id, key, version, protocol, definition, secret_refs, policy,
     content_hash, created_at, created_by)
  SELECT (lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0') || '7'
            || substring(bits, 1, 3) || '8' || substring(bits, 4, 15))::uuid,
         NEW.tenant_id, NEW.id, NEW.key, NEW.version, NEW.protocol, NEW.definition, NEW.secret_refs,
         NEW.policy, data_source_content_hash(NEW.key, NEW.protocol, NEW.definition, NEW.secret_refs, NEW.policy),
         clock_timestamp(), CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by ELSE NEW.updated_by END
    FROM (SELECT replace(gen_random_uuid()::text, '-', '') AS bits) entropy
  ON CONFLICT (data_source_id, version) DO NOTHING;
  RETURN NULL;
END
$$;
CREATE TRIGGER data_sources_snapshot AFTER INSERT OR UPDATE ON data_sources
  FOR EACH ROW EXECUTE FUNCTION data_source_snapshot();

-- Backfill the current revision of existing sources (earlier revisions were never stored).
INSERT INTO data_source_versions
  (id, tenant_id, data_source_id, key, version, protocol, definition, secret_refs, policy, content_hash, created_at, created_by)
SELECT (lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0') || '7'
          || substring(bits, 1, 3) || '8' || substring(bits, 4, 15))::uuid,
       s.tenant_id, s.id, s.key, s.version, s.protocol, s.definition, s.secret_refs, s.policy,
       data_source_content_hash(s.key, s.protocol, s.definition, s.secret_refs, s.policy),
       s.updated_at, s.updated_by
  FROM data_sources s, LATERAL (SELECT replace(gen_random_uuid()::text, '-', '') AS bits) entropy;

CREATE TRIGGER data_source_versions_append_only BEFORE UPDATE OR DELETE ON data_source_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER data_source_versions_no_truncate BEFORE TRUNCATE ON data_source_versions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

ALTER TABLE data_source_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_source_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON data_source_versions
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT ON data_source_versions TO verbis_app;
