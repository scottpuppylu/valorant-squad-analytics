ALTER TABLE sync_runs DROP CONSTRAINT IF EXISTS sync_runs_status_check;
-- statement-breakpoint
ALTER TABLE sync_runs
  ADD CONSTRAINT sync_runs_status_check
  CHECK (status IN ('pending', 'running', 'paused', 'complete', 'failed', 'cancelled'));
-- statement-breakpoint
ALTER TABLE sync_runs
  ADD COLUMN public_id uuid,
  ADD COLUMN sync_kind text NOT NULL DEFAULT 'backfill' CHECK (sync_kind IN ('backfill', 'incremental', 'rank')),
  ADD COLUMN page_count integer NOT NULL DEFAULT 0,
  ADD COLUMN matches_seen integer NOT NULL DEFAULT 0,
  ADD COLUMN matches_persisted integer NOT NULL DEFAULT 0,
  ADD COLUMN overlap_count integer NOT NULL DEFAULT 0,
  ADD COLUMN provider_request_count integer NOT NULL DEFAULT 0,
  ADD COLUMN provider_fetch_ms bigint NOT NULL DEFAULT 0,
  ADD COLUMN normalization_ms bigint NOT NULL DEFAULT 0,
  ADD COLUMN database_ms bigint NOT NULL DEFAULT 0,
  ADD COLUMN total_ms bigint NOT NULL DEFAULT 0,
  ADD COLUMN sql_query_count integer NOT NULL DEFAULT 0,
  ADD COLUMN termination_reason text,
  ADD COLUMN last_error_at timestamptz;
-- statement-breakpoint
CREATE UNIQUE INDEX sync_runs_public_id_unique ON sync_runs (public_id) WHERE public_id IS NOT NULL;
-- statement-breakpoint
ALTER TABLE sync_cursors DROP CONSTRAINT IF EXISTS sync_cursors_player_id_provider_affinity_queue_scope_key;
-- statement-breakpoint
ALTER TABLE sync_cursors
  ADD COLUMN sync_kind text NOT NULL DEFAULT 'backfill' CHECK (sync_kind IN ('backfill', 'incremental', 'rank')),
  ADD COLUMN last_successful_page integer,
  ADD COLUMN last_page_fingerprint_hmac char(64),
  ADD COLUMN last_error_category text,
  ADD COLUMN last_error_at timestamptz,
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN coverage_complete_for_provider_window boolean NOT NULL DEFAULT false,
  ADD COLUMN coverage_incomplete_reason text,
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz;
-- statement-breakpoint
CREATE UNIQUE INDEX sync_cursors_player_provider_kind_unique
  ON sync_cursors (player_id, provider, affinity, queue_scope, sync_kind);
-- statement-breakpoint
CREATE INDEX sync_cursors_lease_expiry_idx
  ON sync_cursors (lease_expires_at)
  WHERE lease_token IS NOT NULL;
