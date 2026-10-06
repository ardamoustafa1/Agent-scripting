CREATE INDEX assignments_tenant_script_active_idx ON assignments (tenant_id, script_id) WHERE deleted_at IS NULL;
CREATE INDEX launch_intents_push_dedupe_idx ON launch_intents (tenant_id, interaction_id, user_id);
