-- TASK-IDENTITY-01B one-time, human-approved production DATA migration (append-only).
-- Assigns the 9 approved community names (ops/community-names-2026-10-06.json) to the members
-- owning the accounts whose CURRENT Riot game name matches EXACTLY. Writes only
-- members.display_name / display_name_source / updated_at. Never nickname, never players, never
-- any account-scoped row. FAIL-CLOSED: every precondition and postcondition raises, rolling back
-- the whole migration transaction (no partial writes). The schema_migrations ledger makes it run
-- once, so later `member:admin rename-member` edits are never reset by future deploys.
--
-- Locking: SHARE ROW EXCLUSIVE on members and players. It blocks concurrent INSERT/UPDATE/DELETE
-- (Connect, reconnect, deletion, admin edits) for the few milliseconds between verification and
-- update, still allows plain reads (ACCESS SHARE), and is self-conflicting so two runners cannot
-- interleave. A short lock_timeout fails the deploy instead of waiting behind long transactions.
DO $$
DECLARE
  approved int;
  live_members int;
  live_accounts int;
  total_members int;
  total_accounts int;
  ownership_before text;
  nicknames_before text;
  problem int;
  resolved int;
  distinct_accounts int;
  distinct_members int;
  changed int;
BEGIN
  -- Everything runs inside this one statement (and the runner's migration transaction): the lock is
  -- held until that transaction commits or rolls back.
  PERFORM set_config('lock_timeout', '10s', true);
  LOCK TABLE members, players IN SHARE ROW EXCLUSIVE MODE;
  CREATE TEMP TABLE approved_community_names (game_name text PRIMARY KEY, community_name text NOT NULL) ON COMMIT DROP;
  INSERT INTO approved_community_names (game_name, community_name) VALUES
    ('我架天空架姚明', '小麻花'),
    ('jack5487', 'jack'),
    ('我架右邊我泡槍', '天堂'),
    ('我架左邊我被殺', '魔王'),
    ('夏天到了喔耶耶耶', '夏天'),
    ('這個ü加分喔', '加分'),
    ('誰的骨盆最端正', '走路'),
    ('火鍋加芋頭是真理', '滑板車'),
    ('倫家愛滑鏟', '滑鏟');

  SELECT count(*) INTO approved FROM approved_community_names;
  IF approved <> 9 THEN RAISE EXCEPTION 'IDENTITY-01B: expected 9 approved mappings, found %', approved; END IF;
  SELECT count(*) INTO problem FROM approved_community_names
    WHERE char_length(community_name) NOT BETWEEN 1 AND 32 OR community_name <> btrim(community_name)
       OR (SELECT count(*) FROM approved_community_names o WHERE o.community_name = approved_community_names.community_name) <> 1;
  IF problem <> 0 THEN RAISE EXCEPTION 'IDENTITY-01B: % invalid or duplicate approved community names', problem; END IF;

  -- Scope: this data migration targets ONLY the production identity set. A database where NONE of
  -- the approved game names exist (fresh, test or developer database) is not that set: record the
  -- migration as a no-op. If ANY approved game name exists, every check below is mandatory.
  IF NOT EXISTS (SELECT 1 FROM approved_community_names a JOIN players p ON p.display_name = a.game_name) THEN
    RAISE NOTICE 'IDENTITY-01B: no approved game name present; not the production identity set, no changes';
    RETURN;
  END IF;

  -- 1-3, 7, 9: exactly 9 live members, 9 live accounts, strictly 1:1, none on an archived member.
  SELECT count(*) INTO live_members FROM members WHERE archived_at IS NULL;
  SELECT count(*) INTO live_accounts FROM players WHERE anonymized_at IS NULL;
  IF live_members <> 9 THEN RAISE EXCEPTION 'IDENTITY-01B: expected 9 live members, found %', live_members; END IF;
  IF live_accounts <> 9 THEN RAISE EXCEPTION 'IDENTITY-01B: expected 9 live accounts, found %', live_accounts; END IF;
  SELECT count(*) INTO problem FROM members m WHERE m.archived_at IS NULL
    AND (SELECT count(*) FROM players p WHERE p.member_id = m.id AND p.anonymized_at IS NULL) <> 1;
  IF problem <> 0 THEN RAISE EXCEPTION 'IDENTITY-01B: % live members do not own exactly one live account', problem; END IF;
  SELECT count(*) INTO problem FROM players p JOIN members m ON m.id = p.member_id
    WHERE p.anonymized_at IS NULL AND m.archived_at IS NOT NULL;
  IF problem <> 0 THEN RAISE EXCEPTION 'IDENTITY-01B: % live accounts belong to archived members', problem; END IF;
  SELECT count(*) INTO problem FROM players WHERE member_id IS NULL;
  IF problem <> 0 THEN RAISE EXCEPTION 'IDENTITY-01B: % accounts without a member', problem; END IF;

  -- 8: zero same-match member identity collisions.
  SELECT count(*) INTO problem FROM (SELECT mp.source_match_id, p.member_id FROM match_participants mp
    JOIN players p ON p.id = mp.player_id GROUP BY 1, 2 HAVING count(*) > 1) c;
  IF problem <> 0 THEN RAISE EXCEPTION 'IDENTITY-01B: % same-match member collisions', problem; END IF;

  -- 4, 10: every approved game name matches EXACTLY ONE account of any state (exact Unicode
  -- equality; no fuzzy/LIKE/case/tag matching), and that account is live.
  SELECT count(*) INTO problem FROM approved_community_names a
    WHERE (SELECT count(*) FROM players p WHERE p.display_name = a.game_name) <> 1
       OR NOT EXISTS (SELECT 1 FROM players p WHERE p.display_name = a.game_name AND p.anonymized_at IS NULL);
  IF problem <> 0 THEN RAISE EXCEPTION 'IDENTITY-01B: % approved game names are missing, ambiguous or deleted', problem; END IF;

  CREATE TEMP TABLE approved_resolution ON COMMIT DROP AS
    SELECT a.game_name, a.community_name, p.id AS account_id, m.id AS member_id,
           m.display_name AS current_name, m.display_name_source AS current_source, m.archived_at
    FROM approved_community_names a
    JOIN players p ON p.display_name = a.game_name AND p.anonymized_at IS NULL
    JOIN members m ON m.id = p.member_id;

  -- 5, 6: 9 resolutions to 9 distinct accounts and 9 distinct, non-archived members.
  SELECT count(*), count(DISTINCT account_id), count(DISTINCT member_id) INTO resolved, distinct_accounts, distinct_members FROM approved_resolution;
  IF resolved <> 9 OR distinct_accounts <> 9 OR distinct_members <> 9 THEN
    RAISE EXCEPTION 'IDENTITY-01B: resolved % mappings to % accounts / % members (expected 9/9/9)', resolved, distinct_accounts, distinct_members;
  END IF;
  SELECT count(*) INTO problem FROM approved_resolution WHERE archived_at IS NOT NULL;
  IF problem <> 0 THEN RAISE EXCEPTION 'IDENTITY-01B: % matched members are archived', problem; END IF;

  -- Never overwrite a DIFFERENT explicitly curated community name.
  SELECT count(*) INTO problem FROM approved_resolution
    WHERE current_source = 'community' AND current_name <> community_name;
  IF problem <> 0 THEN RAISE EXCEPTION 'IDENTITY-01B: % members already have a different curated community name', problem; END IF;
  SELECT count(*) INTO problem FROM approved_resolution WHERE current_source NOT IN ('legacy_account', 'community');
  IF problem <> 0 THEN RAISE EXCEPTION 'IDENTITY-01B: % members have an unknown name source', problem; END IF;

  SELECT count(*) INTO total_members FROM members;
  SELECT count(*) INTO total_accounts FROM players;
  SELECT md5(coalesce(string_agg(id::text || ':' || member_id::text, ',' ORDER BY id), '')) INTO ownership_before FROM players;
  SELECT md5(coalesce(string_agg(id::text || ':' || coalesce(nickname, '<null>'), ',' ORDER BY id), '')) INTO nicknames_before FROM members;

  UPDATE members m SET display_name = r.community_name, display_name_source = 'community', updated_at = now()
    FROM approved_resolution r
    WHERE m.id = r.member_id AND (m.display_name <> r.community_name OR m.display_name_source <> 'community');
  GET DIAGNOSTICS changed = ROW_COUNT;

  -- Postconditions (any failure rolls back everything above).
  SELECT count(*) INTO problem FROM approved_resolution r JOIN members m ON m.id = r.member_id
    WHERE m.display_name <> r.community_name OR m.display_name_source <> 'community';
  IF problem <> 0 THEN RAISE EXCEPTION 'IDENTITY-01B: % members do not carry the approved name after update', problem; END IF;
  IF (SELECT count(*) FROM members) <> total_members THEN RAISE EXCEPTION 'IDENTITY-01B: member count changed'; END IF;
  IF (SELECT count(*) FROM players) <> total_accounts THEN RAISE EXCEPTION 'IDENTITY-01B: account count changed'; END IF;
  IF (SELECT md5(coalesce(string_agg(id::text || ':' || member_id::text, ',' ORDER BY id), '')) FROM players) <> ownership_before THEN
    RAISE EXCEPTION 'IDENTITY-01B: account ownership changed';
  END IF;
  IF (SELECT md5(coalesce(string_agg(id::text || ':' || coalesce(nickname, '<null>'), ',' ORDER BY id), '')) FROM members) <> nicknames_before THEN
    RAISE EXCEPTION 'IDENTITY-01B: nickname values changed';
  END IF;
  SELECT count(*) INTO problem FROM (SELECT mp.source_match_id, p.member_id FROM match_participants mp
    JOIN players p ON p.id = mp.player_id GROUP BY 1, 2 HAVING count(*) > 1) c;
  IF problem <> 0 THEN RAISE EXCEPTION 'IDENTITY-01B: same-match member collisions after update'; END IF;
  RAISE NOTICE 'IDENTITY-01B: approved community names verified; % member rows updated', changed;
END
$$;
