-- Tenant location (site) catalog. Role scopes pick named locations instead of typing free text.
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(128) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" VARCHAR(128) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "locations_tenant_id_created_at_id_idx" ON "locations"("tenant_id", "created_at", "id");
CREATE UNIQUE INDEX "locations_tenant_code_active_key" ON "locations"("tenant_id", "code") WHERE (deleted_at IS NULL);

ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "locations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "locations"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- Soft delete only: the application role never hard-deletes catalog rows.
GRANT SELECT, INSERT, UPDATE ON "locations" TO verbis_app;
