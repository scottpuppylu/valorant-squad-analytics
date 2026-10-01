ALTER TABLE source_matches
  ADD COLUMN public_id uuid;
-- statement-breakpoint
UPDATE source_matches
SET public_id = gen_random_uuid()
WHERE public_id IS NULL;
-- statement-breakpoint
ALTER TABLE source_matches
  ALTER COLUMN public_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN public_id SET NOT NULL;
-- statement-breakpoint
CREATE UNIQUE INDEX source_matches_public_id_unique ON source_matches (public_id);
