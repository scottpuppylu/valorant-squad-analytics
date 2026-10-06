-- TASK-DATA-03B.2D analysis-match-facts-v1 (append-only, additive).
-- Derived evidence only: the event-metrics-v1 reconstruction of one LINKED participant of one source match,
-- its round coverage and its direct trade edges. No scores, no provider identifiers, no HMACs, no names.
-- Facts are written in the same per-match transaction as the durable evidence and are trusted only while
-- engine_key matches the running code and source_observed_at equals source_matches.last_observed_at;
-- otherwise the analysis read path reconstructs that match from raw durable evidence (exact fallback).
-- Rollback-compatible: older application code never reads this table.
CREATE TABLE analysis_participant_facts (
  match_participant_id uuid PRIMARY KEY REFERENCES match_participants(id) ON DELETE CASCADE,
  source_match_id uuid NOT NULL REFERENCES source_matches(id) ON DELETE CASCADE,
  engine_key text NOT NULL CHECK (char_length(engine_key) BETWEEN 1 AND 128),
  source_observed_at timestamptz NOT NULL,
  observed_rounds integer NOT NULL CHECK (observed_rounds >= 0),
  present_every_round boolean NOT NULL,
  metrics json NOT NULL,
  trade_edges json NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE INDEX analysis_participant_facts_match_idx ON analysis_participant_facts (source_match_id);
