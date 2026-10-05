# Match Act / season evidence

**TASK-DATA-SEASON-01: COMPLETE / ACCEPTED (2026-10-05).**

TASK-DATA-SEASON-01 — SDD STRICT, 2026-10-05. Starting HEAD
`df9a0e90c6a96a08c3862ad35cbf850e60c7bc40`; checkpoint `checkpoint-before-data-season-01`.
Not Riot API, not RSO, not a new provider, not a season calendar, not rank ingestion, not a
Progress Index.

## Provider contract (verified 2026-10-05)

Henrik published OpenAPI (`https://api.henrikdev.xyz/openapi.json`, version **4.6.0**):

- v4 matches: `MatchesV4DataMetadata.season` is **required**, `$ref SeasonIdShortCombo`
  = `{ id: string (required), short: string (required) }`.
- Stored Matches: `StoredMatchMeta.season` is **required**, `$ref StoredMatchMetaSeason`
  = `{ id: string (required), short: string (required) }`; `meta.id` is the match id.
- No example values are published. The repository's sanitized field audit
  (REAL_DATA_FIELD_AUDIT.md, 2026-09-30) observed `metadata.season.id` / `.short` on every
  sampled match. Henrik documentation refers to `e#a#`-style short codes (e.g. `e1a1`).

No Riot call was made. The contract is treated as provider evidence, not a guarantee.

## Migration

**None.** `source_matches.season_id` and `season_short` have existed since migration 0001 and
were never written. `DURABLE_NORMALIZATION_VERSION` stays `durable-evidence-v2`: season is
additive metadata, and `event-metrics-v1` requires that exact version, so bumping it would
invalidate event evidence on every stored row.

## Normalization (`server/evidence/seasonEvidence.ts`)

Each field is validated independently. Neither is derived from the other, and nothing is guessed.

| Input | Result |
|---|---|
| valid `{id: uuid, short: "e9a3"}` | `season_id` = lowercase UUID, `season_short` = `e9a3` |
| season absent / `null` / string / array | no season evidence; the **match is still persisted** |
| id valid, short missing/empty/unsafe | id only |
| short valid, id missing/not a UUID | short only |
| short safe but unrecognized (e.g. `beta-2`) | persisted as evidence; **no public Act key** (未分類) |

Decision: a malformed season never rejects an otherwise-valid match. Season is optional to
product correctness, and losing round/event evidence over metadata would be worse.
`season_id` is server-only. The browser receives only `seasonKey`, derived from a recognized
`season_short` (`e9a3` → `E9:A3`, `v26a1` → `V26:A1`). The `v` format is supported by the
pattern but has not yet been observed in production.

## Persistence and correction semantics

Every path that persists full v4 match data goes through `normalizeHenrikEvidence` and the
single `source_matches` upsert, so season is captured automatically from now on: manual
import, incremental (recent) sync, legacy backfill, deep `live_v4` pages and deep stored-phase
detail fetches. On conflict, keyed by `(provider, provider_match_lookup_hmac)`:

- `season_id = COALESCE(new, existing)` and `season_short = COALESCE(new, existing)`.
- Same values: no change. Missing/invalid later payload: **never erases**. A different valid
  value: **corrects** (the provider is the authority for its own metadata).
- No new source match, and public id, HMAC, rounds, events, consent and identity are untouched
  (tested by row counts across every evidence table).

## Stored-Match season decision: **USED** (season only)

Deep runs already past their newest matches would otherwise revisit them only after the
sweep completes plus a 7/30-day cooldown, because the stored-index phase skips known matches.
Stored rows carry the same required `meta.season`. For each stored-index page,
`PostgresSyncStore.fillKnownMatchSeasons` updates season **only** where:
- the row's HMAC (computed in memory from `meta.id`, never persisted raw) matches an
  **existing** durable source;
- this player participated in that match;
- the player's consent is active in the same statement;
- the value is valid. The same correct-but-never-erase semantics apply.

It never creates a source, participant, round or event row, and never fetches detail for known
matches. Unknown stored rows keep the existing DATA-03A behaviour (one detail per invocation).

## Backfill strategy

The application's own supported paths, with no SQL writes and no direct provider calls:
- `POST /api/valorant/sync/start {playerId, kind:'deep_backfill'}` / `continue {runId}`.
  New deep runs re-observe overlaps from `live_v4` offset 0. Existing paused/failed runs resume
  and, on reaching the stored index, fill known matches from stored rows.
- Serial calls, at least 7 s apart, one player at a time. Existing consent checks, 45-second
  leases, 25-second work budget, backoff and pagination-repeat handling all apply. The DATA-05A
  cron (UTC 18:05 / 18:35) is unchanged and keeps reconciling afterwards.

## Analytics interaction

- `view=analytics` reports `matchesWithSeasonId`, `matchesWithSeasonShort`, Act keys/counts,
  `unrecognizedSeasonCodes`, `latestRecordedAct` (最新有紀錄 Act) and `currentActKnown:false`.
- ACT scope uses only matches tagged with the selected Act. It is `partial` while coverage is
  partial, and unknown-season matches are never included.
- `currentStrength` (crossSeason=false): the window stops at the first observation whose
  season differs from the newest one's (`act_boundary_respected`). During partial coverage an
  **unknown** season also stops the window (conservative). Thresholds are unchanged.
- `recentForm`: the current window keeps the Act boundary. Its **baseline is allowed to cross
  Acts** (policy unchanged) and records `season_crossed_in_baseline`. Review item for
  TASK-PROGRESS-01: whether progression baselines should prefer same-Act evidence.

## Production acceptance — 2026-10-05

Code 00defc2 (feat/test/docs) was deployed: GitHub CI, Pages and Vercel succeeded. No migration.
Every production action used the public application endpoints (`/api/valorant/sync/start|continue`,
`view=analytics`, `view=history`, snapshot), serially and at least 8 s apart. There was no direct
provider call, SQL write, secret access, consent change or cron change. DATA-05A cron stays
enabled; no lock contention, backoff or pagination repeat occurred.

| Read-only `view=analytics` | Baseline 11:46Z | Final 12:30Z |
|---|---:|---:|
| tracked matches | 56 | 183 |
| `season_id` non-null | 0 | 173 |
| `season_short` non-null | 0 | 173 |
| public Act keys | none | E11:A5 = 173 |
| Act coverage | 0 % (unavailable) | **94.5 %** (partial) |
| unrecognized codes | 0 | 0 |

- **Canary** (1 chunk, 1 provider request): 3 overlaps re-observed, season filled 0 → 3,
  tracked unchanged. Observed provider format `e11a5` (the documented `e#a#` pattern) →
  public key E11:A5.
- **Continuation**: 9 players. Pass 1 stopped each player after 2 chunks without new overlaps;
  pass 2 stopped after 3 chunks without reducing "durable matches lacking season"; then one
  incremental (recent) chunk for each of 3 players. About 78 server chunks in total, each with
  one live-v4 provider request (no stored or detail phase was reached). There were no non-200
  responses.
- **Matches**: 46 of the 56 original durable matches now carry season. 127 new durable matches
  were acquired as normal consented DATA-05A deep/incremental behaviour, and all carry season.
  Public IDs are unique (183/183 in the snapshot and across history pages).
- **Remaining 10**: original matches belonging to the three players whose pre-existing deep
  runs had already passed their newest region. They have not been re-observed yet; the
  provider is not known to lack season for them. They will fill through the normal daily
  history cron once those runs reach the stored index (season-only fill), or on the next sweep
  after cooldown. No SQL backfill.
- All tracked history currently lies in one observed Act (E11:A5). The Act *boundary* in
  `currentStrength` is therefore not exercised in production yet (covered by tests).
  `latestRecordedAct` = e11a5 and `currentActKnown` = false.
- UI: the Act selector is enabled on Leaderboard / Compare / Profile / Maps / Agents / Matches,
  and Synergy offers 「指定 Act：E11:A5（最新有紀錄）」. The ACT disclosure says 部分樣本 ·
  「僅部分對戰有 Act 證據」. The only 完整生涯 mentions are negated disclaimers. No error pages,
  NaN or failed requests. Pages Demo shows Act disabled (fictional data has no Act) and makes
  zero `/api` calls.
- SQL-level duplicate/orphan health checks were **NOT RUN** in this session (no read-only
  database console access). Public invariants hold: unique public match IDs and tracked count
  equal to the history traversal count. Running the DATA-05A SELECT-only health query from the
  maintainer's console is recommended.
