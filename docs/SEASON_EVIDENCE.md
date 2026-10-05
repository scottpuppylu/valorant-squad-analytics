# Match Act / season evidence

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
