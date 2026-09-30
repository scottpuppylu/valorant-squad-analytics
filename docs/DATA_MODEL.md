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

TASK-DATA-01A provides production-validated server-side player, self-asserted consent and normalized evidence persistence. TASK-DATA-01B adds durable historical and incremental synchronization behind the same consent boundary. TASK-DATA-01C now implements credential-authorized revocation and durable deletion, with production destructive validation still pending. The public frontend deliberately still uses the browser-local REAL envelope; cross-device reads require DATA-02.

`src/dataSources/thirdParty/henrikV4.ts` now contains a sanitized structural summarizer. A bounded consenting audit observed the field families documented in `docs/REAL_DATA_FIELD_AUDIT.md`; it did not store raw payloads or identifier values and does not prove lifetime completeness.

## Neon durable evidence schema

Migration `0001_durable_evidence_foundation.sql` implements UUID primary keys, UTC timestamps, foreign keys, uniqueness constraints and explicit source/normalization versions. Migration `0002_bounded_historical_sync.sql` adds public run IDs, sync kinds, cumulative metrics, termination/error fields, cursor coverage and expiring lease fields. Both are applied to production and remain immutable. Migration `0003_consent_revocation_deletion.sql` adds consent-credential HMACs, player tombstones and the leased staged deletion audit; its production application is pending the DATA-01C validation gate.

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
| `deletion_jobs` | public job ID, credential HMAC, stage/cursor, lease, attempts, safe error and aggregate removal/anonymization counts |

Provider match IDs and PUUIDs are converted to domain-separated keyed HMACs for deduplication and joins. Non-consenting players use match-scoped HMACs and do not receive player records. Public application UUIDs are independent random values. Recoverable encrypted provider identity columns exist but remain null until a separate encryption design is reviewed. Scores do not belong in ingestion tables; they are derived from versioned evidence.

## Initial backfill — DATA-01B complete

1. Require active consent and membership, then open a `sync_runs` row.
2. Fetch bounded v4 history windows newest-to-oldest with `size` and `start`.
3. Stop on an empty/short page, repeated page fingerprint, no older unique matches or the 300-match configured horizon. Reaching the horizon is explicitly incomplete.
4. Normalize one response in memory, upsert match/team/participant/round/event evidence in one transaction, and never log raw identifiers or payload bodies.
5. Persist oldest/newest covered timestamps, last sync time, provider-window completeness and an explicit incomplete reason.
6. Release or expire the 45-second per-player lease so another serverless instance can resume safely.

Backfill is idempotent by keyed provider-match fingerprint plus source schema version. A failed page leaves the previous cursor unchanged and records a retryable sync result.

## Incremental sync — DATA-01B complete

- Start from `start=0`, move backward until reaching the latest committed boundary, and deduplicate every match.
- Re-fetch a small overlap window so late corrections can update completed matches.
- Store provider/OpenAPI version, normalizer version and response observation time.
- Use a per-player distributed lock, request budget, exponential backoff and provider-aware rate limits.
- Keep ingestion separate from future metric reconstruction; TASK-METRICS-01 remains deferred.
- Expose only public run IDs, aggregate progress, coverage dates, safe error classes and performance totals through the status API.

Production validation observed 159 match responses over 54 chunks, six overlap updates and zero retries before `empty_page`; a later incremental run observed three existing matches and stopped at `known_boundary`. The stored range is a provider-available window, not lifetime history. Exact mechanics and capacity are in `docs/HISTORICAL_SYNC.md`.

## Revocation and deletion model — DATA-01C implemented, production destructive validation pending

New active consents may carry one management credential HMAC; plaintext is returned once to the consenting browser and is never stored server-side. Legacy active consent remains null until the explicit operator-only provisioning workflow is used. A public player UUID is lookup-only and cannot authorize deletion.

Revocation atomically changes consent to revoked, deactivates membership, cancels unfinished sync runs, releases cursor leases and creates/reuses one open deletion job. The worker stages remove rank observations, process exclusive/shared matches, remove provider identity and membership, clear or anonymize sync metadata, tombstone player PII and finalize aggregate audit.

An exclusive source match is deleted with its children. In a shared match, the revoked participant loses `player_id`, receives a random match-scoped tombstone, and loses agent, combat aggregate, ability, economy, weapon, armor and location evidence. Team membership, round presence and killer/victim/assistant/plant/defuse references remain only as anonymous topology needed by other active consenting members. Re-consent after completion creates a new player/consent/credential and does not relink deleted history.

## Missing data

- Optional statistics remain `undefined`; they are not silently converted to observed zero.
- A category renormalizes its available weights when one optional input is missing.
- A category with no usable inputs returns the documented neutral fallback of 50.
- A zero denominator returns a finite fallback rather than `Infinity` or `NaN`.

## Future-compatible fields

Economy, utility, trade, impact, and synergy evidence are deliberately absent from TASK-001 because the fixture does not support them. Later tasks can add new raw fields and derived modules without placing calculation logic in React components.
