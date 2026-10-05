-- TASK-IDENTITY-01B member-identity-v2 (append-only, additive).
-- members.display_name = primary community name; members.nickname = optional second name of the
-- PERSON (never an account label, never an identity). NULL = no nickname; never an empty string.
ALTER TABLE members
  ADD COLUMN nickname text
  CHECK (nickname IS NULL OR (char_length(nickname) BETWEEN 1 AND 64 AND btrim(nickname) = nickname));
