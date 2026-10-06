# Data model

> **TASK-WEAPON-01.1:** `weapon-catalog-v2` classifies Warden as Rifle (Riot Patch 13.06); classification only, no data change.

> **TASK-WEAPON-01 (weapon-analytics-v1):** descriptive member-level weapon analytics read existing `round_participants.weapon_*` (round observation) and `kill_events.weapon_*` (kill weapon) — two separate domains; no new columns, no persisted weapon statistics; per-weapon HS%/ADR/damage/accuracy and attack/defense are unavailable. See [WEAPON_ANALYTICS.md](WEAPON_ANALYTICS.md).

> **TASK-IDENTITY-01B (member-identity-v2, schema 6):** `Player.nickname?` = optional second name of the person (secondary, never an id); `handle`/`displayName` = primary community name; Riot `GameName#Tag` lives only in `accounts`. See [MEMBER_IDENTITY.md](MEMBER_IDENTITY.md#member-naming-model-task-identity-01b).

> **TASK-IDENTITY-01 (member-identity-v1, 2026-10-06):** public `Player` = MEMBER (person) with 1..N sanitized `accounts`; `players` rows are Riot ACCOUNTS; `MatchPerformance.playerId` = member public id, `accountId` only for multi-account members. Schema 5. See [MEMBER_IDENTITY.md](MEMBER_IDENTITY.md).

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

The raw player-match grain. Required fields are kills, deaths, assists, ACS, ADR, agent, and player ID. KAST, HS%, first kills, first deaths, clutch attempts, and clutch wins are optional. Schema-4 REAL performances always include actual engine `eventEvidence` statuses for KAST and Opening; partial/unavailable event evidence has no fabricated value.

### `RawPlayerStats`

`src/utils/aggregateStats.ts` aggregates player-match rows. Totals are additive. ACS and ADR are round-weighted averages. KAST uses reconstructed observed rows only and is undefined when none exists; scoring retains selected evidence coverage. HS% is kill-weighted when present. Ratios preserve their existing explicit denominator semantics.

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
  -> normalizeHenrikEvidence -> normalized durable Neon evidence
  -> DatasetProjectionService -> versioned browser-safe REAL dataset
  -> DatasetProvider -> existing TASK-003 analytics
```

Server routes validate explicit consent and keep `HENRIK_API_KEY` outside the browser. The adapter uses PUUID and provider match ID only while processing one response; the returned player and match keys are one-way opaque SHA-256 prefixes. PUUIDs, raw provider match IDs and raw payloads are not returned or persisted.

The old phase-1 envelope `goblin-survey:real-dataset:v1` is retired from the active product path. `DatasetProvider` deletes that legacy value on startup, never reads it as the source of truth, and never writes server-read REAL data to localStorage. Emoji overrides and the separate consent-management/deletion credential remain browser-local.

TASK-DATA-01A provides production-validated server-side player, self-asserted consent and normalized evidence persistence. TASK-DATA-01B adds durable historical and incremental synchronization behind the same consent boundary. TASK-DATA-01C provides production-validated credential-authorized revocation and durable deletion. TASK-DATA-02 adds the versioned public durable read projection and explicit React runtime states. TASK-METRICS-01 adds independently versioned evidence reconstruction without changing the score engine. Vercel exposes only sanitized current-policy consenting-player analytics without viewer authentication; GitHub Pages remains Demo-only.

The single current policy constant is `PUBLIC_DATASET_PRIVACY_VERSION = 2026-10-02-public-v1` in `shared/privacyPolicy.ts`. Connection requests must carry this exact version. Only explicit current-policy connection consent can replace an older active consent; it revokes the old row and creates one new active row in one transaction. Manual import, historical/incremental sync, cursor commits and dataset visibility all require the exact current active version and never auto-upgrade it.

DATA-02A.1 hardens the durable read boundary without changing this schema. Match-level `stats_evidence_status='observed'` means the provider supplied a stats object; individual nullable columns can still be missing and therefore remain `NULL`. The projection requires observed finite K/D/A, score and damage plus an agent, at least one durable round, and complete round-presence evidence before emitting a legacy-compatible `MatchPerformance`. An unusable performance is omitted, and a match with no usable visible performance is omitted. Active player profiles remain governed by consent and membership rather than by whether one match is usable.

Shot-location fields preserve the same distinction: all three observed zero counts produce the valid measured `HS%=0`, while any missing head/body/leg count omits optional HS% and marks its dataset-level availability partial. Complete evidence may also legitimately produce zero kills, assists, FK, FD or KAST. Missing evidence is never converted into measured zero.

`src/dataSources/thirdParty/henrikV4.ts` now contains a sanitized structural summarizer. A bounded consenting audit observed the field families documented in `docs/REAL_DATA_FIELD_AUDIT.md`; it did not store raw payloads or identifier values and does not prove lifetime completeness.

## Neon durable evidence schema

Migration `0001_durable_evidence_foundation.sql` implements UUID primary keys, UTC timestamps, foreign keys, uniqueness constraints and explicit source/normalization versions. Migration `0002_bounded_historical_sync.sql` adds public run IDs, sync kinds, cumulative metrics, termination/error fields, cursor coverage and expiring lease fields. Migration `0003_consent_revocation_deletion.sql` adds consent-credential HMACs, player tombstones and the leased staged deletion audit. Migration `0004_dataset_read_runtime.sql` adds a distinct immutable public match UUID used by the sanitized read API. Migration `0005_public_dataset_consent.sql` changes active-consent uniqueness to one active consent per player across all versions. Migration `0006_metric_evidence_status.sql` records observed/missing/unavailable state for match round/kill collections, round participant collections and match-level ability/economy values. Applied migrations are never edited.

| Table | Required purpose and key fields |
|---|---|
| `squads` | private group, display name, created/archived timestamps |
| `players` | internal UUID, public display label, emoji default; no provider secret |
| `squad_memberships` | squad/player role, joined/left timestamps, visibility state |
| `provider_identities` | player/provider/affinity plus keyed or encrypted provider identifier; never returned publicly |
| `consents` | player, scope, policy version, granted/revoked timestamps, actor and provenance; at most one active row per player |
| `sync_runs` | provider, player, trigger, status, started/finished, request counts, error class and coverage window |
| `sync_cursors` | player/queue endpoint, newest/oldest observed time, boundary match fingerprint, last success |
| `source_matches` | internal UUID, independent public application UUID, keyed provider-match fingerprint, queue/map/start/duration/version/completion, source schema version, round/kill collection evidence status |
| `match_teams` | match/team key, won, rounds won/lost |
| `match_participants` | match/player/team/agent, K/D/A, score, damage, shots, aggregate ability/economy values and evidence status |
| `rounds` | match/round index, winner/result, plant/defuse actor and timing, participant-collection evidence status |
| `round_participants` | round/player kills, score, loadout, remaining credits, weapon/armor, evidence flags |
| `kill_events` | match/round/sequence, time, killer/victim internal player keys, weapon and location |
| `kill_assistants` | kill event and assistant player key |
| `event_player_locations` | kill event, observed player key and coordinates; optional high-volume retention |
| `source_matches.season_id` / `season_short` | TASK-DATA-SEASON-01: validated provider season UUID (server-only) and short code; COALESCE upsert, never erased by omission; public `seasonKey` derived only from recognized short codes |
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
- Keep ingestion separate from `event-metrics-v1` reconstruction; provider, normalization, reconstruction, public projection and scoring versions advance independently.
- Expose only public run IDs, aggregate progress, coverage dates, safe error classes and performance totals through the status API.

Production validation observed 159 match responses over 54 chunks, six overlap updates and zero retries before `empty_page`; a later incremental run observed three existing matches and stopped at `known_boundary`. The stored range is a provider-available window, not lifetime history. Exact mechanics and capacity are in `docs/HISTORICAL_SYNC.md`.

## Revocation and deletion model — DATA-01C complete and production validated

New active consents may carry one management credential HMAC; plaintext is returned once to the consenting browser and is never stored server-side. Legacy active consent remains null until the explicit operator-only provisioning workflow is used. A public player UUID is lookup-only and cannot authorize deletion.

Revocation atomically changes consent to revoked, deactivates membership, cancels unfinished sync runs, releases cursor leases and creates/reuses one open deletion job. The worker stages remove rank observations, process exclusive/shared matches, remove provider identity and membership, clear or anonymize sync metadata, tombstone player PII and finalize aggregate audit.

An exclusive source match is deleted with its children. In a shared match, the revoked participant loses `player_id`, receives a random match-scoped tombstone, and loses agent, combat aggregate, ability, economy, weapon, armor and location evidence. Team membership, round presence and killer/victim/assistant/plant/defuse references remain only as anonymous topology needed by other active consenting members. Re-consent after completion creates a new player/consent/credential and does not relink deleted history.

The first production validation processed 154 exclusive matches and no shared matches in three deletion attempts. It removed the provider identity, membership, consent and two cursors, anonymized personal fields on two sync runs, tombstoned the player and left zero orphan rows. This validates the observed exclusive path; shared-match behavior remains covered by disposable-database tests because the production subject had no shared match.

## Deep acquisition cursor — DATA-03A

Migration 0007 adds independent deep_backfill and preserves legacy rows. New
cursor fields: history_phase (live_v4/stored_index/complete), stored_page (1-based),
stored_item_index, optional stored_total/discovery_page, live_history_exhausted,
stored_history_exhausted and history_rule_version. Live next_start is an offset.
Existing HMAC fingerprints detect repetition/page changes; no plaintext discovery
ID is persisted. Run counters: stored_matches_seen/detail_requests/detail_unavailable_count.
Counts describe committed processing observations/upserts, not unique lifetime totals.
Recorded failed requests count attempts; abrupt death before failure/status commit
can leave telemetry incomplete. Full detail uses the same evidence pipeline;
compact stored rows never fabricate rounds/kills/advanced zeros. Both phases are
required for sourceExhausted; lifetimeComplete=false always. Public schema 4 and
newest-300 response unchanged; DATA-03B deferred. See DEEP_HISTORY.md.

## Missing data

- Optional statistics remain `undefined`; they are not silently converted to observed zero.
- Durable REAL performances with incomplete required compatibility evidence are omitted rather than projected with fabricated ACS, ADR or KAST values.
- A durable match with zero usable browser-visible performances is omitted, and the dataset is `empty` when no usable matches remain.
- Observed numeric zero remains a valid value and is not treated as missing.
- A dimension renormalizes only after >=70% configured component evidence; partial coverage is explicit.
- A dimension with insufficient evidence has no numeric value; there is no neutral fallback.
- A scored zero denominator is unavailable, never a numeric substitute or Infinity/NaN.

## Advanced metric evidence

`MatchPerformance.advancedMetrics` is optional so deterministic Demo and legacy clients need not fabricate REAL evidence. REAL schema 2 performances may carry `event-metrics-v1` coverage plus compact Trade, clutch, objective, direct ability-cast, economy-efficiency and impact-context aggregates. Zero-valued domain objects may be omitted only when their domain evidence status proves a measured zero; missing data remains `partial` or `unavailable`.

Full anonymous participant topology and ordered event evidence are read only on the server. The public response contains no raw timeline, coordinates, internal IDs, HMACs or non-consenting participant rows. `src/analytics/advancedMetrics.ts` aggregates counts and recomputes ratios from additive totals; it does not score them. Eight-dimension scoring is computed by the versioned frontend engine from these sanitized aggregates; no score is persisted. Utility effects and a separately defined Frag Quality score remain future work. Pair Synergy is implemented separately below.

## Evidence-aware scores

PlayerScores contains Overall and eight ScoreResult objects plus independent confidence. See src/scoring/types.ts and docs/SCORING.md for status/value, configured and observed coverage, sample gates and aggregate-only traces. Optional raw KD and FK/FD remain undefined for zero denominators. Demo now contains explicitly fictional advanced aggregates; REAL evidence is never synthesized. TASK-002B required no schema or database migration; TASK-SYNERGY-01 advances the public contract without a database migration.


## Pair analytics contract — TASK-SYNERGY-01

Public schema 3 adds optional match-local teamGroup A/B and teamWon/teamRoundsWon/teamRoundsLost to each visible performance.
Only same known group establishes teammates; same match alone does not. Outcome belongs to the specific member's side.
Legacy MatchRecord outcome fields retain compatibility meaning for existing pages. No database migration.
MatchRecord.synergyEvidence is compact shared event-metrics-v1 coverage plus public-performance-index directional trade tuples.
Only observed visible same-team pairs are projected; anonymous topology stays internal. See SYNERGY.md for the exact tuple schema.
DuoSynergyResult contains pair identity, status/value, separate confidence, shared samples, both paired/baseline windows,
directional lifts, components, supporting trade evidence, aggregate trace and independent duo versions.
No raw event or internal identity is public, and no pair score/ranking is persisted or added to individual Overall/radar.
