DROP INDEX IF EXISTS consents_one_active_version;
-- statement-breakpoint
CREATE UNIQUE INDEX consents_one_active_player
  ON consents (player_id)
  WHERE status = 'active';
