-- TASK-DATA-POSITION-NORMALIZATION-01: position-evidence-v1 (additive, nullable; private derived evidence only).
-- event_player_locations already holds PLAYER_SNAPSHOT_LOCATION per kill event; it gains the provider view direction.
-- rounds gains PLANT_SITE (provider label, never inferred), PLANT / DEFUSE event coordinates and the explicit round
-- side (winning_team_role as given + the attacking team derived from explicit per-round evidence, with its source).
-- source_matches records which position-evidence version wrote the spatial columns (NULL = written before the fix).
-- Coordinates stay in the provider's raw coordinate system; nothing here is exported publicly.
ALTER TABLE event_player_locations ADD COLUMN view_radians numeric;
-- statement-breakpoint
ALTER TABLE rounds
  ADD COLUMN plant_site text,
  ADD COLUMN plant_location_x numeric,
  ADD COLUMN plant_location_y numeric,
  ADD COLUMN defuse_location_x numeric,
  ADD COLUMN defuse_location_y numeric,
  ADD COLUMN winning_team_role text CHECK (winning_team_role IN ('Attacker', 'Defender')),
  ADD COLUMN attacking_team_key text,
  ADD COLUMN side_source text CHECK (side_source IN ('winning_team_role', 'plant', 'defuse')),
  ADD CONSTRAINT rounds_side_source_present CHECK ((attacking_team_key IS NULL) = (side_source IS NULL));
-- statement-breakpoint
ALTER TABLE source_matches ADD COLUMN position_evidence_version text;
