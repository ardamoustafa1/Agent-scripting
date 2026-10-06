-- Authoring lifecycle + routing (ADR-0015): approved state, semver/change notes, reviews,
-- shared screens (linked/detached), templates, campaign codes/mappings/hours/outcomes,
-- assignment conditions + version policy + A/B variants, published-version immutability.

-- ─── Version lifecycle ────────────────────────────────────────────────────────
ALTER TYPE script_version_state ADD VALUE IF NOT EXISTS 'approved' AFTER 'in_review';

ALTER TABLE script_versions
  ADD COLUMN semver        VARCHAR(64),
  ADD COLUMN change_note   TEXT,
  ADD COLUMN submitted_at  TIMESTAMPTZ(3),
  ADD COLUMN submitted_by  VARCHAR(128),
  ADD COLUMN approved_at   TIMESTAMPTZ(3),
  ADD COLUMN retired_at    TIMESTAMPTZ(3),
  ADD COLUMN retired_by    VARCHAR(128),
  -- Provenance of imported versions (.verbis package id + source environment).
  ADD COLUMN source        JSONB;
ALTER TABLE script_versions ADD CONSTRAINT script_versions_semver_format
  CHECK (semver IS NULL OR semver ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$');
CREATE UNIQUE INDEX script_versions_script_semver_key ON script_versions (script_id, semver)
  WHERE semver IS NOT NULL AND deleted_at IS NULL;

-- Per-script approval policy override (tenant default in tenants.settings.authoring.approval).
ALTER TABLE scripts ADD COLUMN approval_policy JSONB;

-- Content of a version is frozen outside draft; published/retired cannot go back.
CREATE OR REPLACE FUNCTION script_version_guard() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.state::text <> 'draft' AND (
       NEW.document IS DISTINCT FROM OLD.document OR
       NEW.document_compressed IS DISTINCT FROM OLD.document_compressed OR
       NEW.checksum IS DISTINCT FROM OLD.checksum OR
       NEW.schema_version IS DISTINCT FROM OLD.schema_version OR
       NEW.semver IS DISTINCT FROM OLD.semver) THEN
    RAISE EXCEPTION 'script version % is % and immutable', OLD.id, OLD.state
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.state::text = 'published' AND NEW.state::text NOT IN ('published', 'retired') THEN
    RAISE EXCEPTION 'published script version % can only be retired', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.state::text = 'retired' AND NEW.state::text <> 'retired' THEN
    RAISE EXCEPTION 'retired script version % is final', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND OLD.state::text <> 'draft' THEN
    RAISE EXCEPTION 'only draft versions can be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER script_versions_guard BEFORE UPDATE ON script_versions
  FOR EACH ROW EXECUTE FUNCTION script_version_guard();
CREATE TRIGGER script_versions_no_delete BEFORE DELETE ON script_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Review trail (append-only).
CREATE TABLE script_version_reviews (
  id                UUID           NOT NULL,
  tenant_id         UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  script_version_id UUID           NOT NULL REFERENCES script_versions (id) ON DELETE RESTRICT,
  -- Review round: increments on every submit, so old approvals never count for a resubmission.
  round             INTEGER        NOT NULL,
  reviewer          VARCHAR(128)   NOT NULL,
  decision          TEXT           NOT NULL CHECK (decision IN ('approved', 'rejected', 'commented')),
  comment           TEXT,
  reason            TEXT,
  created_at        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT script_version_reviews_pkey PRIMARY KEY (id),
  CONSTRAINT script_version_reviews_reject_reason CHECK (decision <> 'rejected' OR coalesce(reason, '') <> '')
);
CREATE INDEX script_version_reviews_version_idx ON script_version_reviews (tenant_id, script_version_id, round);
CREATE UNIQUE INDEX script_version_reviews_one_vote ON script_version_reviews (script_version_id, round, reviewer)
  WHERE decision IN ('approved', 'rejected');
ALTER TABLE script_versions ADD COLUMN review_round INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER script_version_reviews_append_only BEFORE UPDATE OR DELETE ON script_version_reviews
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ─── Shared screens (reusable page groups) ───────────────────────────────────
CREATE TABLE shared_screens (
  id          UUID           NOT NULL,
  tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  key         VARCHAR(64)    NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]*$'),
  name        TEXT           NOT NULL,
  description TEXT,
  tags        TEXT[]         NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by  VARCHAR(128)   NOT NULL,
  updated_at  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by  VARCHAR(128)   NOT NULL,
  deleted_at  TIMESTAMPTZ(3),
  version     INTEGER        NOT NULL DEFAULT 1,
  CONSTRAINT shared_screens_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX shared_screens_tenant_key ON shared_screens (tenant_id, key) WHERE deleted_at IS NULL;

-- Immutable published content: pages (+ the variables/i18n/data sources they need).
CREATE TABLE shared_screen_versions (
  id               UUID           NOT NULL,
  tenant_id        UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  shared_screen_id UUID           NOT NULL REFERENCES shared_screens (id) ON DELETE RESTRICT,
  number           INTEGER        NOT NULL CHECK (number > 0),
  semver           VARCHAR(64)    NOT NULL,
  change_note      TEXT,
  fragment         JSONB          NOT NULL,
  checksum         CHAR(64)       NOT NULL,
  created_at       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       VARCHAR(128)   NOT NULL,
  CONSTRAINT shared_screen_versions_pkey PRIMARY KEY (id),
  CONSTRAINT shared_screen_versions_number_key UNIQUE (shared_screen_id, number),
  CONSTRAINT shared_screen_versions_semver_key UNIQUE (shared_screen_id, semver)
);
CREATE TRIGGER shared_screen_versions_append_only BEFORE UPDATE OR DELETE ON shared_screen_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Which script version uses which shared screen version, and how.
CREATE TABLE script_screen_links (
  id                      UUID           NOT NULL,
  tenant_id               UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  script_version_id       UUID           NOT NULL REFERENCES script_versions (id) ON DELETE RESTRICT,
  shared_screen_id        UUID           NOT NULL REFERENCES shared_screens (id) ON DELETE RESTRICT,
  shared_screen_version_id UUID          NOT NULL REFERENCES shared_screen_versions (id) ON DELETE RESTRICT,
  mode                    TEXT           NOT NULL CHECK (mode IN ('linked', 'detached')),
  page_ids                TEXT[]         NOT NULL,
  created_at              TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by              VARCHAR(128)   NOT NULL,
  CONSTRAINT script_screen_links_pkey PRIMARY KEY (id),
  CONSTRAINT script_screen_links_unique UNIQUE (script_version_id, shared_screen_id)
);
CREATE INDEX script_screen_links_screen_idx ON script_screen_links (tenant_id, shared_screen_id, mode);

-- ─── Template library ────────────────────────────────────────────────────────
CREATE TABLE templates (
  id                UUID           NOT NULL,
  tenant_id         UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  kind              TEXT           NOT NULL CHECK (kind IN ('script', 'screen')),
  name              TEXT           NOT NULL,
  category          VARCHAR(64)    NOT NULL,
  description       TEXT,
  tags              TEXT[]         NOT NULL DEFAULT '{}',
  locale            VARCHAR(16),
  document          JSONB          NOT NULL,
  checksum          CHAR(64)       NOT NULL,
  source_version_id UUID,
  created_at        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by        VARCHAR(128)   NOT NULL,
  updated_at        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by        VARCHAR(128)   NOT NULL,
  deleted_at        TIMESTAMPTZ(3),
  version           INTEGER        NOT NULL DEFAULT 1,
  CONSTRAINT templates_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX templates_tenant_name_key ON templates (tenant_id, kind, name) WHERE deleted_at IS NULL;

-- ─── Campaigns ───────────────────────────────────────────────────────────────
ALTER TABLE campaigns
  ADD COLUMN code          VARCHAR(64),
  ADD COLUMN locales       TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN working_hours JSONB,
  ADD COLUMN outcome_set   JSONB   NOT NULL DEFAULT '[]';
ALTER TABLE campaigns ADD CONSTRAINT campaigns_code_format CHECK (code IS NULL OR code ~ '^[A-Z0-9][A-Z0-9_-]*$');
CREATE UNIQUE INDEX campaigns_tenant_code_key ON campaigns (tenant_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;

-- One platform object maps to at most one campaign per tenant (deterministic routing).
CREATE TABLE campaign_external_mappings (
  id          UUID           NOT NULL,
  tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  campaign_id UUID           NOT NULL REFERENCES campaigns (id) ON DELETE RESTRICT,
  platform    VARCHAR(32)    NOT NULL CHECK (platform ~ '^[a-z][a-z0-9-]*$'),
  kind        VARCHAR(32)    NOT NULL CHECK (kind ~ '^[a-z][a-zA-Z0-9]*$'),
  external_id VARCHAR(256)   NOT NULL,
  created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by  VARCHAR(128)   NOT NULL,
  deleted_at  TIMESTAMPTZ(3),
  CONSTRAINT campaign_external_mappings_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX campaign_external_mappings_key ON campaign_external_mappings (tenant_id, platform, kind, external_id)
  WHERE deleted_at IS NULL;
CREATE INDEX campaign_external_mappings_campaign_idx ON campaign_external_mappings (tenant_id, campaign_id);

-- ─── Assignments ─────────────────────────────────────────────────────────────
ALTER TABLE assignments
  ADD COLUMN version_policy TEXT  NOT NULL DEFAULT 'latestPublished' CHECK (version_policy IN ('pinned', 'latestPublished')),
  -- {channels, locales, queues, skills, segments} (empty/absent = any); `rule` is the expression.
  ADD COLUMN conditions     JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(conditions) = 'object');
UPDATE assignments SET version_policy = 'pinned' WHERE pinned_version_id IS NOT NULL;
ALTER TABLE assignments ADD CONSTRAINT assignments_pinned_requires_version
  CHECK (version_policy <> 'pinned' OR pinned_version_id IS NOT NULL);

-- ─── Grants + RLS ────────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON script_version_reviews, shared_screen_versions, script_screen_links TO verbis_app;
GRANT SELECT, INSERT, UPDATE ON shared_screens, templates, campaign_external_mappings TO verbis_app;
-- Draft re-projection replaces read models; links of a draft are rebuilt the same way.
GRANT DELETE ON script_screen_links TO verbis_app;
REVOKE DELETE ON script_versions FROM verbis_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'script_version_reviews', 'shared_screens', 'shared_screen_versions', 'script_screen_links',
    'templates', 'campaign_external_mappings'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) '
      'WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END
$$;
