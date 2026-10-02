ALTER TABLE source_matches
  ADD COLUMN rounds_evidence_status text NOT NULL DEFAULT 'missing'
    CHECK (rounds_evidence_status IN ('observed', 'missing', 'unavailable')),
  ADD COLUMN kills_evidence_status text NOT NULL DEFAULT 'missing'
    CHECK (kills_evidence_status IN ('observed', 'missing', 'unavailable'));
-- statement-breakpoint
ALTER TABLE match_participants
  ADD COLUMN ability_evidence_status text NOT NULL DEFAULT 'missing'
    CHECK (ability_evidence_status IN ('observed', 'missing', 'unavailable')),
  ADD COLUMN economy_evidence_status text NOT NULL DEFAULT 'missing'
    CHECK (economy_evidence_status IN ('observed', 'missing', 'unavailable'));
-- statement-breakpoint
ALTER TABLE rounds
  ADD COLUMN participants_evidence_status text NOT NULL DEFAULT 'missing'
    CHECK (participants_evidence_status IN ('observed', 'missing', 'unavailable'));
