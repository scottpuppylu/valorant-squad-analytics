CREATE TABLE squads (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
-- statement-breakpoint
CREATE TABLE players (
  id uuid PRIMARY KEY,
  public_id uuid NOT NULL UNIQUE,
  display_name text NOT NULL,
  display_tag text NOT NULL,
  default_emoji text NOT NULL DEFAULT '🤖',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE TABLE squad_memberships (
  id uuid PRIMARY KEY,
  squad_id uuid NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  membership_role text NOT NULL DEFAULT 'member' CHECK (membership_role IN ('member', 'admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  UNIQUE (squad_id, player_id)
);
-- statement-breakpoint
CREATE TABLE provider_identities (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  provider text NOT NULL,
  affinity text NOT NULL,
  lookup_hmac char(64) NOT NULL,
  encrypted_identifier bytea,
  encryption_nonce bytea,
  encryption_key_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, affinity, lookup_hmac),
  CHECK (
    (encrypted_identifier IS NULL AND encryption_nonce IS NULL AND encryption_key_version IS NULL)
    OR
    (encrypted_identifier IS NOT NULL AND encryption_nonce IS NOT NULL AND encryption_key_version IS NOT NULL)
  )
);
-- statement-breakpoint
CREATE TABLE consents (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  consent_method text NOT NULL CHECK (consent_method IN ('self_asserted', 'riot_rso_verified')),
  privacy_version text NOT NULL,
  consented_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR
    (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);
-- statement-breakpoint
CREATE UNIQUE INDEX consents_one_active_version
  ON consents (player_id, consent_method, privacy_version)
  WHERE status = 'active';
-- statement-breakpoint
CREATE TABLE source_matches (
  id uuid PRIMARY KEY,
  squad_id uuid NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_match_lookup_hmac char(64) NOT NULL,
  provider_schema_version text NOT NULL,
  normalization_version text NOT NULL,
  affinity text NOT NULL,
  map_id text,
  map_name text,
  queue_id text,
  queue_name text,
  started_at timestamptz,
  game_length_ms integer,
  game_version text,
  platform text,
  region text,
  cluster text,
  season_id text,
  season_short text,
  is_completed boolean,
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  UNIQUE (provider, provider_match_lookup_hmac)
);
-- statement-breakpoint
CREATE TABLE match_teams (
  id uuid PRIMARY KEY,
  source_match_id uuid NOT NULL REFERENCES source_matches(id) ON DELETE CASCADE,
  team_key text NOT NULL,
  won boolean,
  rounds_won integer,
  rounds_lost integer,
  UNIQUE (source_match_id, team_key)
);
-- statement-breakpoint
CREATE TABLE match_participants (
  id uuid PRIMARY KEY,
  source_match_id uuid NOT NULL REFERENCES source_matches(id) ON DELETE CASCADE,
  player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  participant_lookup_hmac char(64) NOT NULL,
  team_key text NOT NULL,
  agent_id text,
  agent_name text,
  stats_evidence_status text NOT NULL CHECK (stats_evidence_status IN ('observed', 'missing', 'unavailable')),
  kills integer,
  deaths integer,
  assists integer,
  score integer,
  damage_dealt integer,
  damage_received integer,
  headshots integer,
  bodyshots integer,
  legshots integer,
  ability_1_casts integer,
  ability_2_casts integer,
  grenade_casts integer,
  ultimate_casts integer,
  loadout_value_total integer,
  loadout_value_average numeric,
  spent_total integer,
  spent_average numeric,
  UNIQUE (source_match_id, participant_lookup_hmac)
);
-- statement-breakpoint
CREATE TABLE rounds (
  id uuid PRIMARY KEY,
  source_match_id uuid NOT NULL REFERENCES source_matches(id) ON DELETE CASCADE,
  round_number integer NOT NULL,
  winning_team text,
  result text,
  plant_status text NOT NULL CHECK (plant_status IN ('present', 'absent', 'missing', 'unavailable')),
  plant_participant_id uuid REFERENCES match_participants(id) ON DELETE SET NULL,
  plant_time_ms integer,
  defuse_status text NOT NULL CHECK (defuse_status IN ('present', 'absent', 'missing', 'unavailable')),
  defuse_participant_id uuid REFERENCES match_participants(id) ON DELETE SET NULL,
  defuse_time_ms integer,
  UNIQUE (source_match_id, round_number)
);
-- statement-breakpoint
CREATE TABLE round_participants (
  id uuid PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  match_participant_id uuid NOT NULL REFERENCES match_participants(id) ON DELETE CASCADE,
  present boolean NOT NULL DEFAULT true,
  stats_evidence_status text NOT NULL CHECK (stats_evidence_status IN ('observed', 'missing', 'unavailable')),
  kills integer,
  score integer,
  loadout_evidence_status text NOT NULL CHECK (loadout_evidence_status IN ('observed', 'missing', 'unavailable')),
  loadout_value integer,
  remaining_credits integer,
  weapon_evidence_status text NOT NULL CHECK (weapon_evidence_status IN ('observed', 'missing', 'unavailable')),
  weapon_id text,
  weapon_name text,
  armor_evidence_status text NOT NULL CHECK (armor_evidence_status IN ('observed', 'missing', 'unavailable')),
  armor_id text,
  armor_name text,
  UNIQUE (round_id, match_participant_id)
);
-- statement-breakpoint
CREATE TABLE kill_events (
  id uuid PRIMARY KEY,
  source_match_id uuid NOT NULL REFERENCES source_matches(id) ON DELETE CASCADE,
  round_id uuid NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  event_lookup_hmac char(64) NOT NULL,
  event_sequence integer NOT NULL,
  time_in_round_ms integer NOT NULL,
  time_in_match_ms integer,
  killer_participant_id uuid NOT NULL REFERENCES match_participants(id) ON DELETE CASCADE,
  victim_participant_id uuid NOT NULL REFERENCES match_participants(id) ON DELETE CASCADE,
  weapon_id text,
  weapon_name text,
  location_x numeric,
  location_y numeric,
  UNIQUE (source_match_id, event_lookup_hmac),
  UNIQUE (round_id, event_sequence)
);
-- statement-breakpoint
CREATE TABLE kill_assistants (
  kill_event_id uuid NOT NULL REFERENCES kill_events(id) ON DELETE CASCADE,
  match_participant_id uuid NOT NULL REFERENCES match_participants(id) ON DELETE CASCADE,
  PRIMARY KEY (kill_event_id, match_participant_id)
);
-- statement-breakpoint
CREATE TABLE event_player_locations (
  kill_event_id uuid NOT NULL REFERENCES kill_events(id) ON DELETE CASCADE,
  match_participant_id uuid NOT NULL REFERENCES match_participants(id) ON DELETE CASCADE,
  location_x numeric NOT NULL,
  location_y numeric NOT NULL,
  PRIMARY KEY (kill_event_id, match_participant_id)
);
-- statement-breakpoint
CREATE TABLE rank_observations (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  provider text NOT NULL,
  observed_at timestamptz NOT NULL,
  season_id text,
  tier_id integer,
  tier_name text,
  rr integer,
  elo integer,
  change_amount integer,
  source_match_lookup_hmac char(64),
  UNIQUE (player_id, provider, observed_at, season_id, tier_id, rr, elo)
);
-- statement-breakpoint
CREATE TABLE sync_runs (
  id uuid PRIMARY KEY,
  squad_id uuid NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  provider text NOT NULL,
  trigger_kind text NOT NULL CHECK (trigger_kind IN ('connect', 'manual', 'scheduled')),
  status text NOT NULL CHECK (status IN ('pending', 'running', 'complete', 'failed')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  coverage_from timestamptz,
  coverage_to timestamptz,
  cursor_start integer,
  last_provider_match_boundary_hmac char(64),
  error_category text,
  retry_count integer NOT NULL DEFAULT 0,
  CHECK ((status = 'complete' AND completed_at IS NOT NULL) OR status <> 'complete')
);
-- statement-breakpoint
CREATE TABLE sync_cursors (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  provider text NOT NULL,
  affinity text NOT NULL,
  queue_scope text NOT NULL DEFAULT '*',
  next_start integer NOT NULL DEFAULT 0,
  coverage_from timestamptz,
  coverage_to timestamptz,
  last_provider_match_boundary_hmac char(64),
  last_success_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, provider, affinity, queue_scope)
);
-- statement-breakpoint
CREATE TABLE deletion_jobs (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  consent_id uuid REFERENCES consents(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'complete', 'failed')),
  requested_at timestamptz NOT NULL,
  completed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  error_category text,
  CHECK ((status = 'complete' AND completed_at IS NOT NULL) OR status <> 'complete')
);
-- statement-breakpoint
CREATE UNIQUE INDEX deletion_jobs_one_open_per_player
  ON deletion_jobs (player_id)
  WHERE status IN ('pending', 'running');
-- statement-breakpoint
CREATE INDEX source_matches_started_at_idx ON source_matches (started_at DESC);
-- statement-breakpoint
CREATE INDEX match_participants_player_idx ON match_participants (player_id) WHERE player_id IS NOT NULL;
-- statement-breakpoint
CREATE INDEX kill_events_round_time_idx ON kill_events (round_id, time_in_round_ms);
-- statement-breakpoint
CREATE INDEX sync_runs_player_started_idx ON sync_runs (player_id, started_at DESC);
