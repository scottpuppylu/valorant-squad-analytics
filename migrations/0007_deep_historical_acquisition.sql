ALTER TABLE sync_runs DROP CONSTRAINT sync_runs_sync_kind_check;
-- statement-breakpoint
ALTER TABLE sync_runs ADD CONSTRAINT sync_runs_sync_kind_check
  CHECK (sync_kind IN ('backfill','incremental','rank','deep_backfill'));
-- statement-breakpoint
ALTER TABLE sync_cursors DROP CONSTRAINT sync_cursors_sync_kind_check;
-- statement-breakpoint
ALTER TABLE sync_cursors ADD CONSTRAINT sync_cursors_sync_kind_check
  CHECK (sync_kind IN ('backfill','incremental','rank','deep_backfill'));
-- statement-breakpoint
ALTER TABLE sync_cursors
  ADD COLUMN history_phase text NOT NULL DEFAULT 'live_v4' CHECK (history_phase IN ('live_v4','stored_index','complete')),
  ADD COLUMN stored_page integer NOT NULL DEFAULT 1 CHECK (stored_page >= 1),
  ADD COLUMN stored_item_index integer NOT NULL DEFAULT 0 CHECK (stored_item_index >= 0),
  ADD COLUMN stored_total integer CHECK (stored_total >= 0),
  ADD COLUMN discovery_page integer CHECK (discovery_page >= 1),
  ADD COLUMN live_history_exhausted boolean NOT NULL DEFAULT false,
  ADD COLUMN stored_history_exhausted boolean NOT NULL DEFAULT false,
  ADD COLUMN history_rule_version text,
  ADD CONSTRAINT sync_cursors_deep_complete_check CHECK (
    history_phase <> 'complete' OR (live_history_exhausted AND stored_history_exhausted)
  );
-- statement-breakpoint
ALTER TABLE sync_runs
  ADD COLUMN stored_matches_seen integer NOT NULL DEFAULT 0 CHECK (stored_matches_seen >= 0),
  ADD COLUMN detail_requests integer NOT NULL DEFAULT 0 CHECK (detail_requests >= 0),
  ADD COLUMN detail_unavailable_count integer NOT NULL DEFAULT 0 CHECK (detail_unavailable_count >= 0);
