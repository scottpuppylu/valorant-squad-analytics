ALTER TABLE players
  ADD COLUMN anonymized_at timestamptz;
-- statement-breakpoint
ALTER TABLE consents
  ADD COLUMN management_credential_hmac char(64),
  ADD COLUMN management_credential_version text,
  ADD COLUMN management_credential_issued_at timestamptz;
-- statement-breakpoint
ALTER TABLE consents
  ADD CONSTRAINT consents_management_credential_complete_check CHECK (
    (management_credential_hmac IS NULL AND management_credential_version IS NULL AND management_credential_issued_at IS NULL)
    OR
    (management_credential_hmac IS NOT NULL AND management_credential_version IS NOT NULL AND management_credential_issued_at IS NOT NULL)
  );
-- statement-breakpoint
ALTER TABLE sync_runs DROP CONSTRAINT IF EXISTS sync_runs_player_id_fkey;
-- statement-breakpoint
ALTER TABLE sync_runs ALTER COLUMN player_id DROP NOT NULL;
-- statement-breakpoint
ALTER TABLE sync_runs
  ADD CONSTRAINT sync_runs_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL;
-- statement-breakpoint
DROP INDEX IF EXISTS deletion_jobs_one_open_per_player;
-- statement-breakpoint
ALTER TABLE deletion_jobs DROP CONSTRAINT IF EXISTS deletion_jobs_status_check;
-- statement-breakpoint
ALTER TABLE deletion_jobs DROP CONSTRAINT IF EXISTS deletion_jobs_check;
-- statement-breakpoint
ALTER TABLE deletion_jobs DROP CONSTRAINT IF EXISTS deletion_jobs_player_id_fkey;
-- statement-breakpoint
ALTER TABLE deletion_jobs ALTER COLUMN player_id DROP NOT NULL;
-- statement-breakpoint
ALTER TABLE deletion_jobs
  ADD CONSTRAINT deletion_jobs_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL;
-- statement-breakpoint
ALTER TABLE deletion_jobs
  ADD COLUMN public_id uuid,
  ADD COLUMN management_credential_hmac char(64),
  ADD COLUMN credential_version text,
  ADD COLUMN stage text NOT NULL DEFAULT 'cancel_sync',
  ADD COLUMN progress_cursor uuid,
  ADD COLUMN stage_started_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN rank_rows_removed integer NOT NULL DEFAULT 0,
  ADD COLUMN exclusive_matches_removed integer NOT NULL DEFAULT 0,
  ADD COLUMN shared_matches_anonymized integer NOT NULL DEFAULT 0,
  ADD COLUMN participants_anonymized integer NOT NULL DEFAULT 0,
  ADD COLUMN provider_identities_removed integer NOT NULL DEFAULT 0,
  ADD COLUMN memberships_removed integer NOT NULL DEFAULT 0,
  ADD COLUMN sync_cursors_removed integer NOT NULL DEFAULT 0,
  ADD COLUMN sync_runs_anonymized integer NOT NULL DEFAULT 0,
  ADD COLUMN last_error_safe text,
  ADD COLUMN last_error_at timestamptz,
  ADD COLUMN retention_until timestamptz;
-- statement-breakpoint
UPDATE deletion_jobs
SET public_id=id,
    stage_started_at=COALESCE(stage_started_at, requested_at),
    retention_until=COALESCE(retention_until, requested_at + interval '90 days')
WHERE public_id IS NULL;
-- statement-breakpoint
ALTER TABLE deletion_jobs ALTER COLUMN public_id SET NOT NULL;
-- statement-breakpoint
ALTER TABLE deletion_jobs
  ADD CONSTRAINT deletion_jobs_status_check CHECK (status IN ('pending', 'running', 'paused', 'complete', 'failed')),
  ADD CONSTRAINT deletion_jobs_stage_check CHECK (stage IN (
    'cancel_sync',
    'remove_rank_observations',
    'process_matches',
    'remove_provider_identity',
    'remove_membership',
    'clear_sync_metadata',
    'purge_player_profile_identity',
    'finalize_job'
  )),
  ADD CONSTRAINT deletion_jobs_complete_check CHECK (
    (status = 'complete' AND completed_at IS NOT NULL) OR status <> 'complete'
  );
-- statement-breakpoint
CREATE UNIQUE INDEX deletion_jobs_public_id_unique ON deletion_jobs (public_id);
-- statement-breakpoint
CREATE UNIQUE INDEX deletion_jobs_one_open_per_player
  ON deletion_jobs (player_id)
  WHERE player_id IS NOT NULL AND status <> 'complete';
-- statement-breakpoint
CREATE INDEX deletion_jobs_lease_expiry_idx
  ON deletion_jobs (lease_expires_at)
  WHERE lease_token IS NOT NULL;
