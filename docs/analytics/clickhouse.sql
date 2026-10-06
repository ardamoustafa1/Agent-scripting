-- Run with a schema-owner provisioning account; application has no DDL privileges.
CREATE TABLE IF NOT EXISTS analytics_facts (
 tenant_id UUID, event_id UUID, occurred_at DateTime64(3,'UTC'), session_id UUID, fact String
) ENGINE=ReplacingMergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id,event_id);
-- ReplacingMergeTree + SELECT FINAL provide retry-safe, logical event-id deduplication.
-- Provision the server-only service user separately: SELECT, INSERT, ALTER DELETE on this table only.
-- No public BI SQL user shares this multi-tenant service account.
