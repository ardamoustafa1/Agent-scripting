-- In-script knowledge base (ADR-0057): tenant articles agents search and read beside the script.
-- Scripts reference an article by its stable key. The search_* columns hold the Turkish-folded
-- text the application writes (`foldText`); the weighted tsvector is generated from them.
CREATE TABLE "knowledge_articles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "locale" VARCHAR(16) NOT NULL DEFAULT 'tr',
    "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMPTZ(3),
    "search_title" TEXT NOT NULL DEFAULT '',
    "search_tags" TEXT NOT NULL DEFAULT '',
    "search_body" TEXT NOT NULL DEFAULT '',
    "search" TSVECTOR GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', "search_title"), 'A') ||
      setweight(to_tsvector('simple', "search_tags"), 'B') ||
      setweight(to_tsvector('simple', "search_body"), 'C')
    ) STORED,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(128) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" VARCHAR(128) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "knowledge_articles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_articles_key_format_check" CHECK ("key" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
    CONSTRAINT "knowledge_articles_status_check" CHECK ("status" IN ('draft', 'published', 'archived')),
    CONSTRAINT "knowledge_articles_published_at_check" CHECK ("status" <> 'published' OR "published_at" IS NOT NULL),
    CONSTRAINT "knowledge_articles_body_length_check" CHECK (char_length("body") <= 20000),
    CONSTRAINT "knowledge_articles_tags_check" CHECK (cardinality("tags") <= 10)
);

CREATE UNIQUE INDEX "knowledge_articles_tenant_key_active_key" ON "knowledge_articles"("tenant_id", "key") WHERE (deleted_at IS NULL);
CREATE INDEX "knowledge_articles_tenant_id_updated_at_id_idx" ON "knowledge_articles"("tenant_id", "updated_at", "id");
CREATE INDEX "knowledge_articles_search_idx" ON "knowledge_articles" USING GIN ("search");

ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "knowledge_articles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_articles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "knowledge_articles"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- Articles are archived, never deleted: the application role cannot hard-delete them.
GRANT SELECT, INSERT, UPDATE ON "knowledge_articles" TO verbis_app;
