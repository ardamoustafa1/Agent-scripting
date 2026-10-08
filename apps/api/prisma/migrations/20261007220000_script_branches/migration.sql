-- Script branches (ADR-0051, DIFFERENTIATORS C3): a branch is one working version labelled with a
-- name and remembering the version it was created from. Branches never publish (enforced in the
-- lifecycle); the merge back creates a normal mainline draft.
ALTER TABLE "script_versions" ADD COLUMN "branch" VARCHAR(64);
ALTER TABLE "script_versions" ADD COLUMN "parent_version_id" UUID;

ALTER TABLE "script_versions"
  ADD CONSTRAINT "script_versions_branch_format_check"
  CHECK ("branch" IS NULL OR "branch" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "script_versions"
  ADD CONSTRAINT "script_versions_parent_version_id_fkey"
  FOREIGN KEY ("parent_version_id") REFERENCES "script_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "script_versions"
  ADD CONSTRAINT "script_versions_branch_parent_check"
  CHECK (("branch" IS NULL) = ("parent_version_id" IS NULL));

CREATE UNIQUE INDEX "script_versions_branch_key"
  ON "script_versions"("script_id", "branch")
  WHERE "branch" IS NOT NULL AND "deleted_at" IS NULL;
