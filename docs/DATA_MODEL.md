# Data model

TASK-001 uses a deterministic fictional dataset. It contains no private player identifiers, Riot API data, or third-party match data.

## Entities

### `Player`

Stable profile metadata stored in `src/data/players.ts`:

- `id`: internal stable key used by routes and joins
- `handle` and `displayName`: fictional display labels
- `role`: Duelist, Initiator, Controller, or Sentinel
- `agents`: the fictional player's demonstrated agent pool
- `accent`, `tagline`, and `playstyle`: presentation metadata

### `MatchRecord`

One row per fictional squad match in `src/data/demoMatches.ts`:

- stable match ID and ISO timestamp
- map, deterministic demo game mode, and fictional opponent
- squad and opponent round scores
- win/loss state and duration
- five `MatchPerformance` rows, one for each squad member in the lineup

The fixture produces 32 unique matches. Five of eight players participate in each match, giving every player 20 appearances. The match generator is deterministic so tests and screenshots are reproducible.

### `MatchPerformance`

The raw player-match grain. Required fields are kills, deaths, assists, ACS, ADR, KAST, agent, and player ID. HS%, first kills, first deaths, clutch attempts, and clutch wins are optional to exercise missing-data behavior.

### `RawPlayerStats`

`src/utils/aggregateStats.ts` aggregates player-match rows. Totals are additive. ACS, ADR, and KAST are round-weighted averages. HS% is kill-weighted when present. Ratios use safe division and return a finite fallback when the denominator is zero.

### `PlayerScores`

`src/scoring/` converts aggregated statistics into the initial 0–100 Firepower, Entry, Teamplay, Clutch, and Consistency categories. Overall is a weighted combination of those categories. Confidence is stored alongside the scores but is never included in Overall.

## Data flow

```text
fictional player metadata + 32 fictional matches
  -> aggregatePlayerStats
  -> role-aware normalization
  -> category scores
  -> overall score + separate confidence
  -> dashboard, leaderboard, and profile UI
```

## Data-source boundary

`src/dataSources/types.ts` defines `AnalyticsDataSource` and `NormalizedAnalyticsDataset`. Every dataset declares `mode: DEMO | REAL`; the two modes are never merged. `DemoDataSource` provides deterministic local fixtures. `RiotDataSource` remains a deliberately non-operational official-provider boundary.

Future official data follows this flow:

```text
Riot API DTO -> server-side Riot adapter -> normalized internal model
  -> aggregation -> derived metrics -> scoring -> UI
```

Scoring and React components must not import Riot DTOs directly. See `docs/RIOT_API_CAPABILITY.md`.

## Analytical selection layer

TASK-003 derives `PerformanceEntry` values from any `NormalizedAnalyticsDataset`. Each entry references, rather than copies, the source `Player`, `MatchRecord` and `MatchPerformance`, and adds the resolved player plus round count needed for selection.

```text
NormalizedAnalyticsDataset
  -> createPerformanceEntries
  -> contextual filters (player/date/map/agent/role/game mode)
  -> per-player chronological grouping
  -> recent 10/30 cap per player when requested
  -> aggregateSelection
  -> existing aggregatePlayerStats + calculatePlayerScores
  -> ranking, comparison, map/agent/profile summaries
```

Minimum matches and minimum rounds are cohort eligibility rules applied after aggregation. They never create a numeric score for a zero-observation player. Agent filtering occurs at the individual `MatchPerformance.agent` grain, so teammates are not included merely because someone else selected that agent.

Filter state uses compact HashRouter-compatible query parameters. It does not serialize datasets or large application state.

## Contextual derived analysis

- Recent Form is `Overall(latest up to 5 eligible appearances) − Overall(all earlier eligible appearances)`. Both windows require at least three matches; more than +2 is up, below −2 is down, otherwise flat.
- Map and agent groups add totals and round-weighted ACS, ADR and KAST, then call the current scoring interface for player score profiles.
- Strongest/weakest profile maps require at least two eligible appearances on the map.
- Badges are recalculated from the current selection. Firepower, Entry, Teamplay, Clutch, Consistency and HS% require at least five matches and 100 rounds; Map requires three appearances on one map; Recent Improvement requires five recent and at least three prior appearances. Values within 0.1 of the maximum tie.

## Browser-local emoji identity

Every `Player` has a required `defaultEmoji`. `AvatarRepository` stores only an optional allow-listed emoji override keyed by internal player ID. `BrowserAvatarRepository` serializes the versioned override map under `valorant-squad-analytics:emoji-avatars:v1` in localStorage. The setting is local to one browser profile and is not part of the analytics dataset, Git repository or GitHub Pages deployment.

Resolution order is browser override, then the player's committed default emoji. The previous uploaded-image blob path is no longer read. Legacy IndexedDB records are left untouched rather than deleted automatically.

Malformed JSON, an unknown storage version, or a record with an emoji outside the allow-list is ignored and resolves to the player's default emoji. Selecting the default emoji or pressing `重設頭像` removes that player's override from the versioned map. Legacy image-avatar IndexedDB data is safely retired: active application code neither reads nor writes it, and automatic destructive deletion is intentionally avoided.

## Production third-party boundary

TASK-API-02 replaces the local probe as the intended product flow:

```text
React #/connect -> same-origin Vercel API -> HenrikDataProvider
  -> normalizeHenrikMatches -> sanitized NormalizedAnalyticsDataset
  -> browser-local REAL dataset -> existing TASK-003 analytics
```

Server routes validate explicit consent and keep `HENRIK_API_KEY` outside the browser. The adapter uses PUUID and provider match ID only while processing one response; the returned player and match keys are one-way opaque SHA-256 prefixes. PUUIDs, raw provider match IDs and raw payloads are not returned or persisted.

Phase 1 stores the sanitized envelope under `goblin-survey:real-dataset:v1` in localStorage. The value has schema version 1, import timestamp and exactly one normalized `REAL` dataset. Malformed, wrong-mode or identifier-bearing values are removed and the app falls back to Demo. Removing the dataset from `#/connect` immediately returns the app to Demo after reload.

TASK-DATA-01A now provides server-side player, self-asserted consent and normalized evidence persistence. The public frontend deliberately still uses the browser-local REAL envelope; cross-device reads, historical synchronization and deletion execution require later tasks.

`src/dataSources/thirdParty/henrikV4.ts` now contains a sanitized structural summarizer. A bounded consenting audit observed the field families documented in `docs/REAL_DATA_FIELD_AUDIT.md`; it did not store raw payloads or identifier values and does not prove lifetime completeness.

## Neon durable evidence schema

Migration `0001_durable_evidence_foundation.sql` implements UUID primary keys, UTC timestamps, foreign keys, uniqueness constraints and explicit source/normalization versions. Production configuration status is tracked separately from the committed schema. See `docs/DATABASE.md` for migration, identity and transaction semantics.

| Table | Required purpose and key fields |
|---|---|
| `squads` | private group, display name, created/archived timestamps |
| `players` | internal UUID, public display label, emoji default; no provider secret |
| `squad_memberships` | squad/player role, joined/left timestamps, visibility state |
| `provider_identities` | player/provider/affinity plus keyed or encrypted provider identifier; never returned publicly |
| `consents` | player, scope, policy version, granted/revoked timestamps, actor and provenance |
| `sync_runs` | provider, player, trigger, status, started/finished, request counts, error class and coverage window |
| `sync_cursors` | player/queue endpoint, newest/oldest observed time, boundary match fingerprint, last success |
| `source_matches` | internal UUID, keyed provider-match fingerprint, queue/map/start/duration/version/completion, source schema version |
| `match_teams` | match/team key, won, rounds won/lost |
| `match_participants` | match/player/team/agent, K/D/A, score, damage, shots, aggregate ability and economy evidence |
| `rounds` | match/round index, winner/result, plant/defuse actor and timing when observed |
| `round_participants` | round/player kills, score, loadout, remaining credits, weapon/armor, evidence flags |
| `kill_events` | match/round/sequence, time, killer/victim internal player keys, weapon and location |
| `kill_assistants` | kill event and assistant player key |
| `event_player_locations` | kill event, observed player key and coordinates; optional high-volume retention |
| `rank_observations` | player, observed timestamp, season, tier/RR/Elo, match fingerprint when present |
| `deletion_jobs` | consent/player scope, requested/completed timestamps, status and audit result |

Provider match IDs and PUUIDs are converted to domain-separated keyed HMACs for deduplication and joins. Non-consenting players use match-scoped HMACs and do not receive player records. Public application UUIDs are independent random values. Recoverable encrypted provider identity columns exist but remain null until a separate encryption design is reviewed. Scores do not belong in ingestion tables; they are derived from versioned evidence.

## Initial backfill design — DATA-01B, not started

1. Require active consent and membership, then open a `sync_runs` row.
2. Fetch bounded v4 history windows newest-to-oldest with `size` and `start`.
3. Stop on an empty/short page, an already committed boundary fingerprint, a configured time horizon or a request budget.
4. Normalize one response in memory, upsert match/team/participant/round/event evidence in one transaction, and never log raw identifiers or payload bodies.
5. Persist the oldest/newest covered timestamps and an explicit `coverage_incomplete` flag. Stored matches may supplement diagnostics but never establish lifetime completeness.
6. Recompute versioned derived metrics only for changed matches and affected players.

Backfill is idempotent by keyed provider-match fingerprint plus source schema version. A failed page leaves the previous cursor unchanged and records a retryable sync result.

## Incremental sync design — DATA-01B, not started

- Start from `start=0`, move backward until reaching the latest committed boundary, and deduplicate every match.
- Re-fetch a small overlap window so late corrections can update completed matches.
- Store provider/OpenAPI version, normalizer version and response observation time.
- Use a per-player distributed lock, request budget, exponential backoff and provider-aware rate limits.
- Separate ingestion from metric reconstruction; queue changed internal match IDs rather than recalculating the whole dataset synchronously.
- Expose `lastSuccessfulSyncAt`, coverage dates, stale/error status and source limitations through a sanitized read API.

## Revocation and deletion design — DATA-01C, not started

Revocation immediately blocks new provider calls and creates an idempotent deletion job. In one auditable workflow it removes or anonymizes provider identity, match participation, derived metrics, rank observations and caches belonging only to the revoked player. Shared match facts needed by other consenting members may remain only after unlinking the revoked identity and proving that no public or operator-facing path can re-identify it. The job invalidates dataset caches and records counts, completion time and policy version without copying deleted identifiers into logs.

Retention jobs must handle orphaned rounds/events, expired raw quarantine data and revoked consent. Re-consent creates a new consent record; it does not silently revive deleted history.

## Missing data

- Optional statistics remain `undefined`; they are not silently converted to observed zero.
- A category renormalizes its available weights when one optional input is missing.
- A category with no usable inputs returns the documented neutral fallback of 50.
- A zero denominator returns a finite fallback rather than `Infinity` or `NaN`.

## Future-compatible fields

Economy, utility, trade, impact, and synergy evidence are deliberately absent from TASK-001 because the fixture does not support them. Later tasks can add new raw fields and derived modules without placing calculation logic in React components.
