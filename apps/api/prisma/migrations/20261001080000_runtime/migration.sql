ALTER TYPE session_state ADD VALUE IF NOT EXISTS 'paused';
ALTER TABLE sessions
  ADD COLUMN sequence integer NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  ADD COLUMN team_id uuid,
  ADD COLUMN writer_hash varchar(64),
  ADD COLUMN writer_tab_id uuid,
  ADD COLUMN writer_bff_id uuid,
  ADD COLUMN writer_until timestamptz(3),
  ADD COLUMN expires_at timestamptz(3);
-- Align the new concurrency watermark with existing event chains.
UPDATE sessions s SET sequence = h.seq FROM session_chain_heads h WHERE h.session_id = s.id;
ALTER TABLE interactions ADD COLUMN platform varchar(64) NOT NULL DEFAULT 'generic',
  ADD COLUMN status varchar(32) NOT NULL DEFAULT 'alerting', ADD COLUMN agent_id uuid,
  ADD CONSTRAINT interactions_status_check CHECK (status IN ('alerting','connected','held','transferred','wrapup','ended'));
ALTER TABLE outcomes ADD COLUMN sealed_data text;
CREATE INDEX sessions_runtime_expiry ON sessions(tenant_id, expires_at) WHERE deleted_at IS NULL;
