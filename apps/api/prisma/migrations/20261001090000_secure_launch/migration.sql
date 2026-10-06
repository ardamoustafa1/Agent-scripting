-- Secure launch (SECURITY §4, ADR-0017): launch intents, CTI-less trusted issuers, preview sessions.

ALTER TABLE sessions ADD COLUMN kind varchar(16) NOT NULL DEFAULT 'interaction',
  ADD CONSTRAINT sessions_kind_check CHECK (kind IN ('interaction', 'preview')),
  -- A real session always belongs to an interaction; a preview never does.
  ADD CONSTRAINT sessions_kind_interaction_check CHECK (
    (kind = 'interaction' AND interaction_id IS NOT NULL) OR
    (kind = 'preview' AND interaction_id IS NULL)
  ) NOT VALID;

CREATE TYPE launch_intent_state AS ENUM ('pending', 'redeemed', 'expired', 'revoked');

CREATE TABLE launch_intents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  interaction_id uuid NOT NULL REFERENCES interactions(id) ON DELETE RESTRICT,
  connector_id uuid REFERENCES connectors(id) ON DELETE SET NULL,
  flow varchar(16) NOT NULL CHECK (flow IN ('s2s', 'embedded', 'jws')),
  code_hash varchar(64) NOT NULL CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  jti varchar(128),
  state launch_intent_state NOT NULL DEFAULT 'pending',
  expires_at timestamptz(3) NOT NULL,
  redeemed_at timestamptz(3),
  session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  created_by varchar(128) NOT NULL,
  updated_at timestamptz(3) NOT NULL,
  updated_by varchar(128) NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  -- Lifetime ≤ 60 s is a schema invariant, not only an application default.
  CONSTRAINT launch_intents_ttl_check CHECK (expires_at <= created_at + interval '60 seconds'),
  CONSTRAINT launch_intents_redeemed_check CHECK (
    (state = 'redeemed') = (redeemed_at IS NOT NULL AND session_id IS NOT NULL))
);
CREATE UNIQUE INDEX launch_intents_code_hash_key ON launch_intents(code_hash);
CREATE INDEX launch_intents_tenant_id_user_id_state_idx ON launch_intents(tenant_id, user_id, state);
CREATE INDEX launch_intents_tenant_id_interaction_id_idx ON launch_intents(tenant_id, interaction_id);
CREATE UNIQUE INDEX launch_intents_tenant_jti_key ON launch_intents(tenant_id, jti) WHERE jti IS NOT NULL;

CREATE TABLE launch_trusted_issuers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  issuer varchar(256) NOT NULL,
  jwks jsonb NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  created_by varchar(128) NOT NULL,
  updated_at timestamptz(3) NOT NULL,
  updated_by varchar(128) NOT NULL,
  deleted_at timestamptz(3),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  -- Private key material never belongs here.
  CONSTRAINT launch_trusted_issuers_public_only CHECK (NOT jsonb_path_exists(jwks, '$.keys[*].d'))
);
CREATE UNIQUE INDEX launch_trusted_issuers_tenant_issuer_key ON launch_trusted_issuers(tenant_id, issuer);

-- Intents are never deleted (forensics); state moves forward only.
GRANT SELECT, INSERT, UPDATE ON launch_intents, launch_trusted_issuers TO verbis_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['launch_intents', 'launch_trusted_issuers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) '
      'WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END
$$;

CREATE FUNCTION launch_intents_forward_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'pending' THEN
    RAISE EXCEPTION 'launch intent % is final (%)', OLD.id, OLD.state USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.code_hash <> OLD.code_hash OR NEW.user_id <> OLD.user_id OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.interaction_id <> OLD.interaction_id OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'launch intent binding is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER launch_intents_forward_only BEFORE UPDATE ON launch_intents
  FOR EACH ROW EXECUTE FUNCTION launch_intents_forward_only();
