-- Step 10: CASL rules for custom roles and ABAC scope per role assignment (ADR-0013).
ALTER TABLE "roles" ADD COLUMN "rules" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "roles" ADD CONSTRAINT "roles_rules_is_array" CHECK (jsonb_typeof("rules") = 'array');

ALTER TABLE "user_roles" ADD COLUMN "scope" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_scope_is_object" CHECK (jsonb_typeof("scope") = 'object');
