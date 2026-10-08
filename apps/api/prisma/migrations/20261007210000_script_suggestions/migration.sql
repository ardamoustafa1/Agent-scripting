-- Suggestion mode (ADR-0051): reviewer-proposed RFC 6902 changes the owner applies in one step.
CREATE TABLE "script_suggestions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "script_version_id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "note" TEXT,
    "operations" JSONB NOT NULL,
    "guards" JSONB NOT NULL DEFAULT '[]',
    "base_checksum" TEXT NOT NULL,
    "state" VARCHAR(16) NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(128) NOT NULL,
    "decided_at" TIMESTAMPTZ(3),
    "decided_by" VARCHAR(128),
    "decision_reason" TEXT,

    CONSTRAINT "script_suggestions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "script_suggestions_state_check" CHECK ("state" IN ('open', 'accepted', 'rejected', 'stale'))
);

CREATE INDEX "script_suggestions_version_idx" ON "script_suggestions"("tenant_id", "script_version_id", "state", "created_at");

ALTER TABLE "script_suggestions" ADD CONSTRAINT "script_suggestions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "script_suggestions" ADD CONSTRAINT "script_suggestions_script_version_id_fkey" FOREIGN KEY ("script_version_id") REFERENCES "script_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "script_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "script_suggestions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "script_suggestions"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- Decisions are state changes; the application role never deletes suggestions.
GRANT SELECT, INSERT, UPDATE ON "script_suggestions" TO verbis_app;
