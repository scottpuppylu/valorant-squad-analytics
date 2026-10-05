# Member / multi-account identity (TASK-IDENTITY-01)

> **Current contract: `member-identity-v2`, public schema 6** (TASK-IDENTITY-01B, migration 0009).
> Sections below that say v1 / schema 5 describe the TASK-IDENTITY-01 state they were written for.

## Member naming model (TASK-IDENTITY-01B)

Three separate concepts:

| Field | Storage | Meaning | Editable by |
|---|---|---|---|
| Primary community name | `members.display_name` (+ `display_name_source`) | The person's group name. Primary UI identity everywhere | Maintainer: `rename-member` |
| Nickname | `members.nickname` (NULL = unset) | Optional second name of the PERSON. Secondary text only | Maintainer: `set-nickname` / `clear-nickname` |
| Riot account | `players.display_name` + `display_tag` | `GameName#Tag` of one account. Updated by reconnects only | Provider (reconnect) |

Neither name is ever an id, a route or an analytics key; those stay `Member.public_id`.
`players.account_label` (主帳/小帳 style account labels) is unrelated to the member nickname.

**Validation (both names):** NFC, trimmed, 1–32 visible characters, Unicode allowed, no control
or format characters, newlines or tabs. A nickname that is empty or whitespace-only becomes
NULL; an empty string is never stored, and the database CHECK rejects '' and padded values.

**Public contract:** `Player.nickname?: string` is present only when set.
- The snapshot, history, `view=analytics` and `view=analysis` all report schema 6.
- `identityVersion` is `member-identity-v2` on the snapshot and history.
- Validators reject empty, padded, oversized or non-string nicknames, and the old schema/identity.

**UI:**
- Profile: `<h1>` community name, then a `綽號：…` line only when a nickname exists, then
  遊戲帳號.
- Leaderboard, Compare, Dashboard leader, category leaders, player cards and Synergy detail show
  the nickname as small secondary text.
- The nickname never affects sorting. Score tie-breaks still use the primary name, so renaming a
  member can reorder only exact score ties; no score changes.

**Editing boundary:**
- All name and nickname mutations are maintainer-only through `npm run member:admin`, which needs
  server-side `DATABASE_URL`.
- There is **no public edit button and no HTTP mutation endpoint**, because there is no trusted
  administrator authentication boundary. Authenticated browser administration would be a future
  TASK-ADMIN-01, not implemented.
- Edits change no ids, ownership, evidence, consent, sync or scores, and make no provider calls.
  The public snapshot reflects them on the next fetch.
- A Riot reconnect or rename never overwrites `display_name` or `nickname` (tested).

**Commands added:**

| Command | Effect |
|---|---|
| `set-nickname --member <id> --nickname "…" --confirm` | Sets the nickname |
| `clear-nickname --member <id> --confirm` | Clears it |
| `plan-names --mapping <json>` | Read-only exact plan |
| `apply-names --mapping <json> --confirm` | Re-plans, refuses on any problem, then runs `rename-member` per member and stops at the first failure without rollback |

All arguments and `--confirm` are validated before any database connection.

### Approved production mapping (human-approved 2026-10-06)

Stored without any ids in `ops/community-names-2026-10-06.json` (current Riot game name → community name):

| Riot game name | Community name |
|---|---|
| 我架天空架姚明 | 小麻花 |
| jack5487 | jack |
| 我架右邊我泡槍 | 天堂 |
| 我架左邊我被殺 | 魔王 |
| 夏天到了喔耶耶耶 | 夏天 |
| 這個ü加分喔 | 加分 |
| 誰的骨盆最端正 | 走路 |
| 火鍋加芋頭是真理 | 滑板車 |
| 倫家愛滑鏟 | 滑鏟 |

Nicknames: **none provided, so all remain NULL**. Never derive them from community names, Riot
names, tags or account labels.

**Matching rule:** exact equality after trimming surrounding whitespace (Unicode preserved).
- Every entry must hit exactly one live account, and no account may be hit twice.
- The mapping must cover every live 1:1 member.
- Otherwise: no write. Never fuzzy, never by tag, stats or history.

The public pre-check (2026-10-06, schema 5 snapshot) resolved all 9 names to exactly one account
each (9 distinct game names, 9 members, 9 accounts, tracked 191).

### Production name assignment status

**PENDING MAINTAINER EXECUTION.**
- The code and migration 0009 are deployed: production serves schema 6 / v2, with 9 members, 9
  accounts, all `legacy_account` and all nicknames NULL.
- Production `DATABASE_URL` is a Vercel *Sensitive* variable: `vercel env pull` returns only a
  placeholder, so the agent session has no database credential. None was requested in chat and no
  public admin endpoint was built.

The maintainer runs these locally, with the Neon connection string set only in their own terminal:

```
npm run member:admin -- plan-names --mapping ops/community-names-2026-10-06.json
npm run member:admin -- apply-names --mapping ops/community-names-2026-10-06.json --confirm
npm run member:admin -- check
```

Then read-only public acceptance confirms:
- all 9 names, `community` source and nicknames NULL;
- unchanged Riot `Name#Tag`;
- 9 × 1 accounts and 0 merges;
- numeric parity.

## TASK-IDENTITY-01 contract (member-identity-v1)

Identity contract: **`member-identity-v1`**. Public dataset **schema 5**. Migration **0008**. SDD
STRICT, 2026-10-06. Starting HEAD `52a61a86187b9109b7ee21e762ecec1c2080975c`; checkpoint
`checkpoint-before-identity-01`.

## Human-confirmed fact

**The 9 current Riot accounts belong to 9 different real people.**
- Production is therefore 9 members × 1 account.
- No current account was merged.
- No account is inferred to be an alt. There is no heuristic linking of any kind: not by Riot
  name, tag, similarity, history, IP, rank, agent pool or anything else.

## Member vs Account

| Concept | Storage | Meaning |
|---|---|---|
| **Member** | `members` (new) | The real person in the group. Public `Player` = member |
| **Account** | `players` (legacy name kept) | One Riot/VALORANT account, owned by exactly one member |

- `members`: `id`, `public_id`, `display_name`, `display_name_source` (`legacy_account` |
  `community`), `default_emoji`, `created_at`, `updated_at`, `archived_at`.
- `players` gains:
  - `member_id` (NOT NULL, FK)
  - `is_primary_account` (a partial unique index allows at most one primary per member)
  - `account_label` (optional)
- Nothing was dropped, renamed or re-keyed. Provider identity uniqueness is unchanged.

**These stay ACCOUNT-scoped:**
- consent and management credentials
- provider identities
- sync cursors and runs (including FASTSYNC)
- deletion jobs and anonymization
- `match_participants.player_id`
- `rank_observations.player_id`

Member aggregation happens only in the read and analytics projection.

## Migration 0008 (append-only, additive)

1. Create `members` and add the new `players` columns.
2. Backfill **exactly one member per existing account**: `member.id = account.id` and
   `member.public_id = account.public_id`. The name is the account's current Riot game name, with
   `display_name_source = 'legacy_account'`. Every account is primary.
3. A member whose only account was already deleted is archived and named 已刪除成員.
4. A `BEFORE INSERT` trigger on `players` gives any account inserted without a member its **own
   new** 1:1 member (same ids, legacy name, primary). This keeps the previous application code
   safe while the migration runs during the Vercel build. It is also the single canonical creation
   path for new connections, so there is never automatic linking.
5. `member_id` is set NOT NULL, and the indexes are created.

Rollback without a down migration is possible: old application code ignores the new table and
columns. Migrations 0001–0007 are unchanged.

## Public contract (schema 5)

- `Player.id` is the **member public id**. Current member public ids equal the old account public
  ids, so every existing Profile URL and ranking link is unchanged.
- `Player.handle` and `displayName` are the **member name**, never `RiotName#Tag`. The `handle`
  field stays structurally, but now carries member semantics.
- `Player.nameSource` is `legacy_account` or `community`.
- `Player.accounts`: `[{ id: publicAccountId, gameName, tag, isPrimary, label? }]`. Only currently
  public accounts are listed.
- `MatchPerformance.playerId` is the member. `accountId` (public account id) is emitted **only for
  multi-account members**, so 1:1 performances stay byte-identical. It is ready for a future
  optional account filter.
- `snapshot.identityVersion` and the history page carry `identityVersion: 'member-identity-v1'`.
- Validators require ≥ 1 account and ≤ 1 primary per member, and allow only sanitized account keys.
- Never exposed: PUUIDs, lookup/match HMACs, internal account or member ids, credentials, lease
  tokens, provider raw ids or secrets.

## Visibility

- An account is public only under the existing current-policy consent rules. A member is public
  only through at least one such account.
- A revoked account disappears on its own: from the account list, stats, Progress and Synergy.
  Its sibling accounts are untouched.
- Archived members are never public.

## Analytics

- All eligible account performances are **merged at evidence grain**, then go through the scope
  resolver, then scoring.
- Scores are never averaged per account.
- `community-score-v2`, `community-benchmarks-v1`, `overall-profile-v1`, `duo-synergy-v1`,
  `improvement-index-v1` and the scope versions are unchanged.

Behaviour by feature:
- Ranking: one row per member.
- Synergy: member↔member.
- Progress: combined chronological windows.
- Act, map and agent views: merged.
- Tracked match count stays source-match unique.
- `view=analysis`: phase 1 observations carry `member_public_id`, and phase 2 loads the selected
  matches across all of a member's accounts. There is no newest-300 dependence.

**Same-match guard:** a person cannot play two accounts in one match. If durable data ever maps
two performances of one member into a single match, the projection and the server skeletons
**withhold that match** (never summing it). They log only
`{event:'member_identity_conflict', matchesWithheld}`.

**Rank:** `rank_observations` stays account-scoped and is not ingested. TASK-DATA-RANK-01 will
decide how member-level rank treats several accounts.

**Weapon evidence:** `round_participants.weapon_*` and `kill_events.weapon_*` hang off account
participants. TASK-WEAPON-01 must aggregate them per member before scoping, through the same
projection.

## Community names

- `legacy_account` means a safe migrated fallback: the maintainer has **not yet** assigned the
  group nickname.
- Current production: all 9 names are `legacy_account`. **Community names are PENDING an explicit
  maintainer mapping (TASK-IDENTITY-01B).**
- A Riot rename or reconnect updates only the account (`players.display_name/tag`), never the
  member name.
- Only `rename-member` changes it, and it sets the source to `community`.
- Deleting an account scrubs a legacy member name derived from that account (已刪除成員) and
  archives a member left with no live account. Other accounts are untouched.

## Maintainer workflow (server operator only)

`npm run member:admin -- <command>` requires server-side `DATABASE_URL`. It is never an HTTP
endpoint and never imported by `api/` or `src/` (this is tested). It prints only public ids,
names and aggregates.

| Command | Effect |
|---|---|
| `list` | Members with name source and their accounts (public id, `Riot#Tag`, primary) |
| `check` | Aggregate invariants: accounts-per-member distribution, multi-primary, empty members, collisions |
| `rename-member --member <id> --name "<名稱>" --confirm` | Changes only the member name; source becomes `community`; 1–32 visible characters, no control characters |
| `link-account --account <id> --member <id> --confirm` | Explicit alt linking (see below) |
| `set-primary --account <id> --confirm` | Atomically clears the previous primary of that member |

**Linking rules**
- The target must exist and not be archived. The account must exist and not be deleted.
- **Fails closed with `ACCOUNT_COAPPEARANCE_CONFLICT`** if the account ever appeared in the same
  source match as any account of the target member. There is no override.
- Only `players.member_id` moves; consent, identities, sync, deletion and participants stay.
- A linked account is secondary unless the target has no primary.
- An emptied source member is **archived, never deleted**. If the source keeps accounts but lost
  its primary, the earliest remaining account is promoted.

## FASTSYNC interaction

- The sync endpoint is account-scoped. The client sends `accountId`; legacy `playerId` is still
  accepted, and both must agree when both are sent.
- A Profile is member-scoped:
  - **one public account:** the original automatic refresh-if-stale;
  - **several accounts:** no automatic fan-out, only a per-account manual 更新戰績.
- The Connect page stays Riot-account oriented. There is no member picker, because there is no
  trusted admin boundary.

## Demo

The fictional NovaHex has two fictional accounts (NovaMain#DEMO 主帳, NovaAlt#ALT 小帳), whose
matches alternate deterministically and are merged in every view. All other Demo members have one
account. Pages makes 0 `/api` calls.

## Production acceptance (2026-10-06, read-only, 0 provider calls)

- **Baseline (pre-deploy):** schema 4, 9 public players, 9 distinct ids, 186 tracked and 186
  snapshot matches, 0 same-match duplicates.
- **Deployment:** commits `965a31f`…`acac357`. CI, Pages and Vercel all passed. The Vercel build
  applied 0008.
- **After:** schema 5 and `member-identity-v1`; contract valid; no leak pattern.
  - 9 members.
  - Accounts per member: `{1: 9}`. Every account id equals its member id and every member has
    exactly one primary. 0 merges.
  - The same 9 public ids, with Riot `Name#Tag` unchanged.
  - Every member name is still the legacy fallback (`legacy_account`).
- **Matches:** tracked 186 → 186. All 186 shared matches are byte-identical. 0 member collisions.
- **Numeric parity (before vs after, the same engine):** lifetime, currentStrength, recent10,
  recent30, Act e11a5, recentForm, Progress, maps, agents and Synergy are all equal.
  - recentForm was compared without the embedded player identity metadata.
  - The existing server-vs-local `view=analysis` parity script reported 28/28 parity flags true.
  - Progress local parity is true.
- **UI:** `/sync/start` was stubbed in the page, so 0 real sync requests were made.
  - All 9 Profile URLs work and show the member name with a compact 遊戲帳號 line.
  - Refresh requests carried account ids.
  - The Leaderboard has 9 unique members.
  - The Pages Demo shows the two-account member and makes 0 API calls.
- **Production DB health / invariants SQL:** NOT VERIFIED (there is no authorized read-only DB
  path here). The maintainer can run `npm run member:admin -- check`. This remains a V1 gate.
