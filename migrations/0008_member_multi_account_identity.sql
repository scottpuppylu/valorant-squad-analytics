-- TASK-IDENTITY-01 member-identity-v1 (append-only, additive).
-- members = people; players = Riot ACCOUNTS (legacy table name retained).
-- Consent, provider identities, sync, deletion and match participants stay account-scoped.
-- Backfill is deterministic 1:1 (human-confirmed: every current account is a different person):
-- member.id = account id, member.public_id = account public_id, never merged.
CREATE TABLE members (
  id uuid PRIMARY KEY,
  public_id uuid NOT NULL UNIQUE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 64),
  display_name_source text NOT NULL DEFAULT 'legacy_account'
    CHECK (display_name_source IN ('legacy_account', 'community')),
  default_emoji text NOT NULL DEFAULT '🤖',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
-- statement-breakpoint
ALTER TABLE players
  ADD COLUMN member_id uuid REFERENCES members(id),
  ADD COLUMN is_primary_account boolean NOT NULL DEFAULT false,
  ADD COLUMN account_label text CHECK (account_label IS NULL OR char_length(account_label) BETWEEN 1 AND 16);
-- statement-breakpoint
INSERT INTO members (id, public_id, display_name, display_name_source, default_emoji, created_at, updated_at)
SELECT p.id, p.public_id, left(p.display_name, 64), 'legacy_account', p.default_emoji, p.created_at, p.updated_at
FROM players p
ON CONFLICT (id) DO NOTHING;
-- statement-breakpoint
UPDATE players SET member_id = id, is_primary_account = true WHERE member_id IS NULL;
-- statement-breakpoint
-- Members whose only account was already anonymized (deleted) are archived and carry no name.
UPDATE members m SET archived_at = p.anonymized_at, display_name = '已刪除成員', default_emoji = '👤'
FROM players p WHERE p.member_id = m.id AND p.anonymized_at IS NOT NULL AND m.archived_at IS NULL;
-- statement-breakpoint
-- Zero-downtime safety: application code deployed before this migration inserts players without
-- member_id. Give every such account its own new 1:1 member (never a guessed existing member).
CREATE FUNCTION players_ensure_member() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.member_id IS NULL THEN
    INSERT INTO members (id, public_id, display_name, display_name_source, default_emoji)
    VALUES (NEW.id, NEW.public_id, left(NEW.display_name, 64), 'legacy_account', NEW.default_emoji)
    ON CONFLICT (id) DO NOTHING;
    NEW.member_id := NEW.id;
    NEW.is_primary_account := true;
  END IF;
  RETURN NEW;
END;
$$;
-- statement-breakpoint
CREATE TRIGGER players_ensure_member BEFORE INSERT ON players
  FOR EACH ROW EXECUTE FUNCTION players_ensure_member();
-- statement-breakpoint
ALTER TABLE players ALTER COLUMN member_id SET NOT NULL;
-- statement-breakpoint
CREATE INDEX players_member_id_idx ON players (member_id);
-- statement-breakpoint
CREATE UNIQUE INDEX players_one_primary_per_member ON players (member_id) WHERE is_primary_account;
