# Full-tracked analytics latency — TASK-DATA-03B.2D

SDD STRICT, 2026-10-06. Starting HEAD `a265f9e`; checkpoint `checkpoint-before-data-03b2d-latency`.

## Phase A — profile before design

### Production baseline (read-only GET, 2026-10-06; 3 warm runs per unbounded feature; medians)

Inventory: tracked **672** (Competitive 309, Unrated 158, other 205). Acts: e11a5 497, e11a4 86, e11a3 64 and smaller.

| Feature | Population | Wall | Server total | phase1 | phase2 | Bytes |
|---|---|---|---|---|---|---|
| lifetimeTotals | 309 | 6.43 s | 5.28 s | 1.32 s | 3.76 s | 599 KB |
| mapStats | 309 | 6.28 s | 5.16 s | 1.36 s | 3.63 s | 599 KB |
| agentStats | 309 | 6.07 s | 5.18 s | 1.35 s | 3.65 s | 599 KB |
| actOverview e11a5 | 226 | 5.60 s | 4.72 s | 1.35 s | 3.28 s | 583 KB |
| synergy | 309 | 6.00 s | 5.27 s | 1.35 s | 3.64 s | 360 KB |
| currentStrength + form (bounded) | 130 | 4.96 s | 4.04 s | 1.38 s | 2.60 s | 939 KB |
| improvementIndex (bounded) | 97 | 4.40 s | 3.66 s | 1.37 s | 2.27 s | 342 KB |
| weapon all / current (unchanged engine) | — | 6.59 / 7.51 s | 6.11 / 7.04 s | — | — | 108 / 84 KB |

### Local realistic-topology benchmark (PGlite, current engine)

The earlier DATA-03B.2C benchmark had 1–3 participants and no kill events per match, so it understated the
cost. `tests/support/analysisBenchFixture.ts` generates realistic matches:
- 10 participants per match (1–3 consenting), everyone present in every round.
- 13–20 rounds per match and 3–7 kills per round, with assistants and valid alive-topology.
- Production-like queue mix and 3 Acts.
- Partial evidence: ~4 % of matches without kills, ~2 % without rounds, plus missing headshot, ability and economy fields.

| Matches | rounds / round_participants / kills | lifetime total | phase 2 (SQL + projection) | projection (event engine) | aggregate | queries | chunks |
|---|---|---|---|---|---|---|---|
| 1,000 | 16 k / 162 k / 76 k | 3.64 s | 2.92 s | 1.03 s | 0.55 s | 17 | 3 |
| 5,000 | 81 k / 809 k / 382 k | 22.1 s | 18.1 s | 5.58 s | 2.37 s | 57 | 13 |

### Bottleneck

1. **Phase-2 SQL is super-linear.** `EXPLAIN ANALYZE` of one 250-match chunk shows a `Seq Scan` over the
   **entire** `round_participants` table (161,860 rows at 1k) feeding a hash join. Each chunk rereads the full
   table, so the work is O(chunks × table) = O(n²).
   - On Neon each chunk costs ~3.5 s at 309 matches.
   - The statement count is `5 + 4·⌈selected/250⌉`.
2. **Event reconstruction is O(n) CPU on every request:** ~1.8 ms per match (5.6 s at 3,015 matches).
   Any design that rebuilds event-metrics-v1 from raw topology per request keeps this cost.
3. Aggregation (`summarizeSelection`) is O(n) CPU. It is measured separately and shared by all designs.

### Options

| | A — set-based exact facts on demand (no migration) | B — materialized per-participant facts | C — cache |
|---|---|---|---|
| Idea | One fixed set of statements reads all selected topology (or SQL re-derives event metrics) | Persist the event-metrics-v1 output per linked participant at write time; read one compact row per performance | Memoize responses |
| Prototype at 5k | Unchunked 4 statements: **10.2 s SQL + 4.3 s reconstruction = 14.4 s** | One read of 6,122 performance+fact rows: **363 ms** | — |
| Event-metric exactness | Either the same engine (keeps the O(n) CPU) or a SQL re-implementation of event-metrics-v1 (a second semantic engine, rejected by rule 41) | Same engine, same code path (stored output of the shared reconstruction) | Same |
| Raw topology per request | O(n) rows (5k: 499 k round_participants) | None in the steady state | Every miss |
| Migration / backfill | None | One additive table; deterministic hydration needed for existing matches | None |
| Write path | Unchanged | Facts refreshed in the same per-match transaction | Invalidation |
| Decision | **Rejected:** fails the latency gate and still reads raw topology linearly | **Chosen** | **Rejected:** a cache miss still reconstructs linearly (rule 5) |

**Decision: B (materialized facts) with an exact raw fallback.**
- No exact set-based design passed. Without persistence, the event engine's per-request O(n) CPU and the O(n)
  topology read remain.
- The fact table stores only derived evidence (reconstructed event metrics, round coverage, trade edges) at
  participant × match grain, keyed by internal FKs. It stores no scores.

## Chosen architecture — `full-tracked-aggregate-v1` over `analysis-match-facts-v1`

### Before (server-analysis-v2 as of `a265f9e`)

```
phase 1: one observation statement over all history (per-row LATERAL round counts)
  -> scope engine selects the feature population
phase 2: all selected matches -> 250-match chunks (2 in parallel)
  -> 4 detail statements per chunk (performances, rounds, round_participants, kill_events)
  -> full raw topology -> DatasetProjectionService (event-metrics-v1 per match) -> MatchRecords
  -> summarizeSelection / buildSynergy
statements = 5 + 4 * ceil(selected / 250)
```

### After (implemented)

```
write (every durable match write, same per-match transaction as the evidence):
  upsertMatch -> refreshAnalysisFacts: 1 read (the four detail SELECTs as JSON, linked participants)
  -> reconstructMatchFacts (the same event-metrics-v1 engine) -> 1 upsert of analysis_participant_facts
phase 1: the same observation statement; a FRESH fact supplies the basic round-evidence gate,
  and only rows without one evaluate the round counts (lazy scalar subqueries)
  -> the unchanged scope engine selects the population
phase 2: ONE statement: the projection's visible performance rows for the selected ids,
  LEFT JOIN fresh facts
  -> assembleMatch (the shared projection code) for every match whose visible participants all have facts
  -> matches without fresh facts only: exact raw reconstruction in work-unit chunks (fallback)
  -> summarizeSelection / buildSynergy (unchanged)
statements = 6 in the steady state (5 phase-1/context + 1 fact read), independent of n
```

**One projection.** `server/dataset/matchAssembly.ts` holds the only per-match projection, split in two:
- `reconstructMatchFacts` runs event-metrics-v1 for one match.
- `assembleMatch` turns visible rows plus facts into a `MatchRecord`.

Snapshot, history, raw fallback and the fact path all call it. The materialized path stores the output of the
first half and later runs only the second.

### Fact contract (`analysis-match-facts-v1`, migration `0011_analysis_participant_facts.sql`)

| Column | Meaning |
|---|---|
| `match_participant_id` (PK, FK -> match_participants ON DELETE CASCADE) | Grain: one LINKED participant = Riot account x source match |
| `source_match_id` (FK -> source_matches ON DELETE CASCADE, indexed) | Per-match refresh and cleanup |
| `engine_key` | `analysis-match-facts-v1:event-metrics-v1:durable-evidence-v2`. Any engine or normalization change invalidates every fact |
| `source_observed_at` | `source_matches.last_observed_at` the fact was computed from |
| `observed_rounds`, `present_every_round` | Round coverage (ACS/ADR denominator, basic evidence gate) |
| `metrics` (json, text order preserved) | The event-metrics-v1 reconstruction of the participant (trace excluded) |
| `trade_edges` (json) | Direct trade edges `[victim participant id, count]` where this participant is the trader |

What it stores, and what it does not:
- **Stored:** internal FKs, derived numeric evidence and evidence statuses.
- **Not stored:** scores, raw PUUIDs, provider ids, HMACs, names, mode-policy results or member aggregates.
- **Grain:** facts are per account (member aggregation stays downstream), so consent, revocation and
  multi-account semantics are unchanged.
- **Size:** about 1.4 KB per linked participant. That is roughly 2 MB for production's ~1.3 k linked
  participants and roughly 28 MB at 10 k realistic matches.

### Exactness

- **Visibility independence.** Facts are computed for every LINKED participant. The read projection feeds
  the engine round-present participants plus only the VISIBLE (consenting) performances.
  - The two inputs can differ only for a linked participant who is outside every round.
  - Such a participant can affect others only through the objective-owner lookup, the winning-team presence
    check or the trade team lookup.
  - `factsAreVisibilityIndependent` stores facts only when none of those can differ. Otherwise the match
    keeps no facts and is always reconstructed raw.
- **Freshness.** A fact is used only if `engine_key` matches the running code and `source_observed_at`
  equals the match's current `last_observed_at`. Stale or absent facts are never trusted: that match alone is
  reconstructed from raw durable evidence (exact fallback). It is never skipped and never counted twice.
- **JSON.** `json` (not `jsonb`) keeps key order and number text, so the assembled payload is byte-identical.
- **Oracle (local, 2026-10-06).**
  - The unmodified engine at `a265f9e` (separate worktree), the new raw fallback and the new fact path
    produced **byte-identical** JSON: 29 analysis requests plus the snapshot, 7.18 MB.
  - The fixture was 600 realistic matches with a two-account member, a revoked account, mixed modes,
    partial evidence and Acts.
  - Requests covered lifetime with player, multi-account member, map, agent, role, mode and date contexts;
    mapStats, agentStats and actOverview with context; fixedRecent 10/30; currentStrength with form;
    improvementIndex; and synergy with map, Act, date and mode.
- **Committed tests.** `tests/analysisFacts.test.ts` checks fact path versus raw path byte for byte through:
  - the write path, incremental addition, correction or reimport, healing and replay;
  - stale and missing facts;
  - visibility-dependent withholding and deletion;
  - privacy;
  - the mixed-mode versus Competitive-only database;
  - multi-account plus revoked.

  `tests/fullTrackedAnalytics.test.ts` adds a raw fallback versus facts check.

**Versions unchanged:** server-analysis-v2, selection-summary-v1, community-score-v2, community-benchmarks-v1,
overall-profile-v1, duo-synergy-v1, improvement-index-v1, event-metrics-v1, durable-evidence-v2,
adaptive-window-v1, feature-scope-policy-v3, mode-eligibility-policy-v1, weapon-analytics-v2,
historical-identity-v1, schema 6 and member-identity-v2. The public response contract is unchanged; the
engine label `full-tracked-aggregate-v1` is internal (metrics and Server-Timing only).

**Observation (pre-existing, unchanged).** The member profile (`player.agents` / `player.role`) is derived
from all durable history, not only Competitive. Strength statistics, scores, map and agent groups and
synergy are Competitive-only exactly as before. This is recorded, not changed.

### Write path and transactionality

- Every durable match write goes through `PostgresMatchEvidenceRepository.upsertMatch`, and the fact
  refresh runs inside that same per-match transaction. That covers:
  - `persistMatches` (connect import);
  - `persistSyncPage` (incremental, FASTSYNC, cron recent, backfill, deep live_v4 and stored_index detail);
  - historical replay and reimport.
- Evidence and facts commit together, or neither does.
- Cost: +2 statements per written match (one JSON read, one upsert). A deep page of 3 matches goes from 52 to
  58 statements (about +12 %). Locally it is about 2.3 ms per match. No provider behaviour changes.
- Revocation/deletion:
  - Exclusive matches are deleted, and the facts cascade with them.
  - In shared matches the anonymized participant's fact is deleted in the same deletion transaction. The other
    participants' facts stay exact, because anonymization keeps rounds, presence and team keys.
  - Public reads always join the current consenting accounts, so a revoked account disappears immediately.
- Season fill (`fillKnownMatchSeasons`) changes neither facts nor `last_observed_at`; Act keys are read live.

### Backfill: deploy-time deterministic hydration

- `vercel-build` runs `db:migrate:vercel` -> `db:hydrate-facts:vercel` -> `build`.
- `scripts/hydrate-analysis-facts-vercel.ts` runs only in Vercel Production, with the existing build
  environment (no secret retrieval). It calls `hydrateAnalysisFacts`:
  - one keyset pass over matches with a linked participant lacking a fresh fact;
  - batches of 100, each recomputed from durable evidence in its own short transaction.
- It is idempotent and makes no provider call. It logs aggregate counts only (`analysis_fact_hydration`).
- A hydration failure never blocks a deploy: the read path's exact fallback covers any match without facts.
- Concurrent writes are safe:
  - the upsert only lands while `source_matches.last_observed_at` still equals what was read and the
    participant is still linked;
  - a fresher fact is never overwritten.

### Consistency semantics

- There is no request-wide snapshot transaction. Phase 2 reads exactly the phase-1 match-id set.
- Each match is assembled from one consistent per-match state: facts and evidence committed atomically, or
  raw evidence when the facts are not fresh.
- A match whose visible rows vanish between phases is not scored, and `populationComplete=false` (unchanged).
- Matches are deduplicated by public id.

### Query complexity

- **Old:** `5 + 4 * ceil(selected/250)`.
- **New:** **6**, independent of n, whenever facts are fresh. Facts are fresh in the steady state, because
  every write refreshes them and every deploy hydrates.
- **Transitional:** only matches without fresh facts add `4 * ceil(fallback/250)`.

Still O(n), and stated honestly:
- the phase-1 observation scan;
- fact rows read and JSON-parsed (about 2 per match);
- assembly;
- the unchanged aggregation CPU (`summarizeSelection`, `buildSynergy`), which dominates at 10 k.

No raw topology is read per request in the steady state, and response bytes are flat.

**Why no cap is needed.** At 10 k realistic matches the slowest unbounded feature (synergy) takes 6.3 s
locally, against the 60 s function budget.

## Local benchmark (PGlite, realistic topology; machine-dependent, informational)

`ANALYSIS_BENCH_SIZES="300,1000,2000,5000,10000" npx vitest run tests/fullTrackedLatency.test.ts`. The
same generator runs against the unmodified `a265f9e` engine in a separate worktree. Values are server total
seconds.

| Matches | Engine | currentStrength+form | lifetime | map | agent | Act e11a5 | synergy | improvement | lifetime queries | lifetime bytes |
|---|---|---|---|---|---|---|---|---|---|---|
| 300 | old | 0.32 | 0.71 | 0.67 | 0.68 | 0.43 | 0.70 | 0.25 | 9 | 362 KB |
| 300 | **new** | 0.10 | 0.17 | 0.16 | 0.16 | 0.11 | 0.19 | 0.04 | **6** | 362 KB |
| 1,000 | old | 0.50 | 3.64 | — | — | — | 3.29 | — | 17 | 367 KB |
| 1,000 | **new** | 0.12 | 0.41 | 0.40 | 0.40 | 0.27 | 0.50 | 0.08 | **6** | 367 KB |
| 2,000 | old | 0.53 | 4.28 | 4.21 | 4.27 | 2.60 | 4.36 | 0.48 | 25 | 368 KB |
| 2,000 | **new** | 0.24 | 1.11 | 1.05 | 1.02 | 0.67 | 1.58 | 0.25 | **6** | 368 KB |
| 5,000 | old | 2.10 | 22.1 | — | — | — | 22.4 | — | 57 | 369 KB |
| 5,000 | **new** | 0.52 | 2.47 | 2.38 | 2.39 | 1.45 | 3.01 | 0.39 | **6** | 369 KB |
| 10,000 | old | 5.08 | 39.9 | 32.8 | 31.5 | 18.0 | 30.3 | 1.85 | 105 | 370 KB |
| 10,000 | **new** | 0.95 | **4.53** | **4.36** | **4.57** | 3.02 | **6.27** | 0.80 | **6** | 370 KB |

- 10 k raw volume: 161,800 rounds, 1,618,000 round_participants, 765,454 kills, 594,532 assistants and
  20,073 facts.
- Hydration from zero takes 23.3 s locally at 10 k; it is a one-time deploy step.
- Gates (≤ 6 s lifetime/map/agent, ≤ 8 s synergy at 10 k) are met.
- Statement count is constant (6) at every size. Bytes are flat.
- Old and new response sizes are identical, which is consistent with byte parity.
- New 1 k → 5 k → 10 k lifetime: 0.41 → 2.47 → 4.53 s (×6.0, then ×1.8). This is roughly linear in the
  Competitive population, as expected for the remaining O(n) CPU.
- At 10 k, lifetime is aggregation 3.05 s + fact read 0.73 s + phase 1 0.51 s + assembly 0.09 s.
  Aggregation (the unchanged `summarizeSelection`) is now the largest component.

**CI (hard assertions):**
- 300 and 1,000 realistic matches: statements = 6, `phase2Chunks` = 0, `fallbackMatches` = 0, full
  population, no shipped population matches, flat bytes.
- 1,999 / 2,000 / 2,001 / 5,000 (`fullTrackedAnalytics`) and 100…10,000 (`serverAnalysis`): statements = 6.
- Raw fallback equals facts byte for byte.
- No wall-clock thresholds.
