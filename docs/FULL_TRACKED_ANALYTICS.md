# Full-tracked analytics — TASK-DATA-03B.2C (2026-10-06)

> **TASK-DATA-MODE-POLICY-01:** 全部已追蹤 for strength features now means all tracked **Competitive** matches (全部已追蹤排位). Inventory counts stay all-mode. There is still no match-count cap. See [MODE_ELIGIBILITY.md](MODE_ELIGIBILITY.md).

Status: **COMPLETE / ACCEPTED**. The REAL website has **no 300-match functional ceiling** and **no generic
2000-match ALL/ACT/PAIR ceiling**.

## Product semantics

- **全部已追蹤** = ALL currently eligible durable tracked evidence matching the requested context.
- It is not Riot lifetime: `lifetimeComplete` stays `false`.
- The UI says 全部已追蹤 / 已追蹤戰績 / 歷史資料持續補齊中, and never 完整生涯.
- The UI distinguishes **已追蹤總場次** (`trackedMatchCount`) from **目前分析樣本**
  (`populationMatches`, scope sample).
- **Intentional analytical windows are definitions, not caps**, and are unchanged:
  - currentStrength (adaptive-window-v1);
  - recentForm;
  - fixedRecent 10/30;
  - improvementIndex (improvement-index-v1).
- Their *search* covers the whole durable chronology; their *sample* stays bounded by policy.

## Transport snapshot (300) — kept, transport-only

`datasetWindowSize = 300` stays for the default `GET /api/valorant/dataset`. It serves as the identity
bootstrap, recent display, rollback compatibility, Demo/local data, and the Matches page's first browse
block.
- `coverage.boundedMatchLimit` and `view=analytics population.snapshotWindow` are documented as
  **transport size only**. They never mean total tracked history, analysis completeness or maximum
  browsable history.
- REAL analytics never consume the snapshot as a population.
- Filter options (maps, agents, game modes) and the Dashboard tracked count and team win rate come from
  all-tracked `view=analytics` facets.

## Architecture (`server-analysis-v2`)

1. **Phase 1** is unchanged: one lightweight statement over all eligible history. The unchanged scope
   engine (`selectPerformances`, adaptive-window-v1) resolves the feature population.
2. **Phase 2** walks **every** selected match in deterministic chunks.
   - Chunks are 250 matches, 2 in parallel (`PHASE2_CHUNK_MATCHES` / `PHASE2_PARALLEL_CHUNKS`). They
     are a work unit, not a limit.
   - The 4 detail statements run per chunk.
   - Raw rounds and events are released after each chunk; only compact `MatchRecord`s are kept.
   - Evidence availability is AND-merged, which is exact because every flag is an every(...) over
     matches.
3. **Aggregation runs server-side** with the same `src/` functions as the browser:
   - **`selection-summary-v1`** (`src/analytics/summary.ts`, `summarizeSelection`) contains
     aggregateSelection (stats, community-score-v2 scores, recent 6), groupByMap, groupByAgent,
     groupByRole, per-player maps (with per-map Overall) and agents, per-account appearances, and the
     Maps 最高分類.
   - Pages consume it through `rankAnalytics`, `insufficientFromAnalytics`, `computeBadgesFromSummary`
     and `mapExtremesFromSummary`. The older selection-based functions are thin wrappers, so Demo,
     local mode and tests are unchanged.
   - **Synergy**: `buildSynergy` (duo-synergy-v1) runs server-side over the full pair population; only
     the results are returned.
4. **Response**:
   - `summary` or `synergy`, plus `scope`.
   - `forms` and `progress` windows. `dataset.matches` holds **only matches referenced by bounded
     windows**.
   - `selection` is no longer serialized. The server keeps it internally for weapon CURRENT.
   - `coverage.populationLimit: null`.
   - `coverage.populationComplete` is true only if every selected match was projected; otherwise the
     status is `partial` with reason `population_incomplete`.
   - `coverage.populationMatches` is disclosed.
5. **Fail closed**: a REAL server error is an explicit error state. It never falls back to a snapshot
   calculation. Demo computes locally and makes 0 `/api` calls.

The browser never loads all history. Analytics payload size scales with members × maps × agents × pairs.
Score traces are about 52 KB per member, independent of match count (verified in production with
39 vs 86 matches).

### Versions

| Item | Change |
|---|---|
| `server-analysis-v1` → `server-analysis-v2` | Response field meanings changed (no `selection`; `dataset` = window matches only; `populationLimit: null`; boolean `populationComplete`) |
| `selection-summary-v1` | New, composition only |
| `analytics-context-v1` | Additive identifier-free `facets` (no version bump) |
| Unchanged | community-score-v2, community-benchmarks-v1, overall-profile-v1, duo-synergy-v1, improvement-index-v1, weapon-analytics-v1, weapon-catalog-v2, adaptive-window-v1, feature-scope-policy-v2, analysis-scope-v1, schema 6, member-identity-v2 |

No migration and no new function (still 12).

**Exactness.** The server summary equals `summarizeSelection` of the selection a v1 client rebuilt,
byte-for-byte after a JSON round-trip, for every feature and context. Synergy results also equal the
local `buildSynergy` output (tests/serverAnalysis.test.ts).

## 300 audit

| Location | Old meaning | Class | Action |
|---|---|---|---|
| `server/dataset/types.ts datasetWindowSize=300` | Snapshot size | A transport | Kept; documented transport-only |
| `coverage.boundedMatchLimit` (snapshot) | Snapshot size | A | Kept; field doc = transport only; test asserts the distinction |
| `view=analytics population.snapshotWindow / snapshotCoversTrackedHistory` | Snapshot size / coverage | A | Kept, informational |
| `api/valorant/dataset.ts` header "newest-300 snapshot" | Transport | D | Clarified |
| `SynergyPage` `minimum <= 300`, `max="300"` | Arbitrary UI cap | **C** | Removed; any safe non-negative integer; `max` = trackedMatchCount when known |
| `SynergyPage` maps/modes from snapshot | Options limited to newest 300 | **C** | All-tracked facets |
| `src/data/analytics.ts` availableMaps/Agents/GameModes from snapshot | Filter options for every page | **C** | Merged with all-tracked facets |
| `DashboardPage` `activeDataset.matches.length` "N 場真實對戰" + team win rate | Snapshot as population | **C** | trackedMatchCount + all-tracked team outcome |
| `ConnectPage` "N 場可用戰績" | Snapshot count | **C** | trackedMatchCount |
| `MatchesPage` 分析範圍 "最新 300 場 分析快照", 「較舊戰績僅供瀏覽，不會改變任何分析結果」 | Snapshot presented as analysis range | **C/D** | 分析範圍 = 全部已追蹤; filters on loaded matches disclosed |
| `ScopeExplanation` 「不受瀏覽器 300 場快照限制」 | Disclosure wording | D | Rewritten (no 300) |
| `PrivacyPage` 「最多讀取…最近 300 場」 | Stale since DATA-03B.1 (history browsable) | D | Rewritten to current behaviour (privacy version unchanged: no new data category) |
| `MemberAccounts` counts from snapshot | Per-account counts limited to snapshot | **C** | REAL: per-account appearances of the page's server population (目前條件) |
| Analytics pages using `analysis.selection.entries` + `aggregateSelection` locally | Full-population payload (linear in matches) | E | Replaced by server `summary` |
| `presentation.ts transport_window_truncated / population_coverage_unverified` | Local-scope reasons | A | Kept; only used for local snapshot selections |
| Numeric 300 in tests/fixtures (ACS, damage, DB fixtures) | Metric values | B | Untouched |
| Older docs ("snapshot remains the only analytics input", "phase 2 ≤ 2000") | Stale | D | Marked SUPERSEDED with pointers here |

## 2000 audit

| Location | Old | Action |
|---|---|---|
| `SERVER_POPULATION_LIMIT = 2000` + `limit()` truncation + `server_population_limit` reason | Newest 2000 for LIFETIME/ACT/PAIR, disclosed partial | **Removed**; chunked full phase 2 |
| `coverage.populationLimit: 2000` | Cap disclosure | `null` (server-analysis-v2) |
| Tests asserting partial at > 2000 | | Now assert `available`, `populationComplete`, `populationMatches = count` |
| improvement-index-v1 docs "never touches the 2000 bound" | | Historical; the bound no longer exists |

## Page data sources (REAL)

| Page | Source | Population | 300 dependency |
|---|---|---|---|
| Dashboard | view=analysis currentStrength (summary) + view=analytics facets | Adaptive window over all tracked; counts / win rate all tracked | NO |
| Leaderboard | view=analysis (feature by period) summary + forms | Feature policy over all tracked | NO |
| Profile | view=analysis summary + forms; improvementIndex; weapon card | Feature policy; per-account = page population | NO |
| Compare | view=analysis summary | Feature policy | NO |
| Maps | view=analysis mapStats summary | All tracked (or policy) | NO |
| Agents | view=analysis agentStats summary | All tracked (or policy) | NO |
| Synergy | view=analysis synergy results | Full pair context | NO |
| Progress | view=analysis improvementIndex windows | Bounded windows, full-chronology search | NO |
| Weapons | view=analysis weaponAnalytics (aggregate SQL, unchanged) | All tracked / Act / current | NO |
| Matches | snapshot + view=history keyset pages (≤ 100 per page, starts strictly older than the snapshot) | Browse all tracked | NO (snapshot is only the first block) |

## Verification

Tests:
- `tests/fullTrackedAnalytics.test.ts`:
  - 299/300/301: snapshot ≤ 300; lifetime = n; history traversal = n with no duplicate or gap at #301.
  - 1999/2000/2001: lifetime/map/agent/Act/pair complete; pair shared matches > 300; currentStrength and
    improvement stay bounded.
  - 5000: complete; bytes flat; query count `5 + 4·⌈n/250⌉`.
  - A member entirely beyond #2000.
  - Truthful `populationComplete=false`.
- `tests/serverAnalysis.test.ts`: exact parity; benchmark 100…10,000.
- `tests/serverAnalysisUi.test.tsx`: Synergy min 310 with no 300 max; Dashboard tracked count; Maps from
  summary with all-tracked options; Demo with 0 API calls; explicit error with no fallback.

### Local benchmark (PGlite in-process WASM, 4 players; LOCAL ONLY — not production timings)

| Matches | currentStrength total | lifetime phase 2 | lifetime total | lifetime queries | lifetime chunks | lifetime bytes | synergy (Act) total |
|---|---|---|---|---|---|---|---|
| 300 | 152 ms | 526 ms | 615 ms | 13 | 2 | 91 KB | 488 ms |
| 1,000 | 272 ms | 840 ms | 1.05 s | 21 | 4 | 91 KB | 573 ms |
| 2,000 | 264 ms | 1.16 s | 1.44 s | 37 | 8 | 91 KB | 810 ms |
| 5,000 | 553 ms | 5.17 s | 5.84 s | 85 | 20 | 91 KB | 2.87 s |
| 10,000 | 1.08 s | 17.4 s | 18.8 s | 165 | 40 | 91 KB | 8.96 s |

- JS projection is 142 ms and aggregation 637 ms at 10k. Phase-2 time is SQL on PGlite.
- Functions allow `maxDuration` 60 s.
- Production Neon timing at > 2000 is **NOT VERIFIED** (production has 332).
- If 10k+ production latency approaches the budget, a later task may add caching or materialized
  aggregates. Sampling is never allowed for 全部已追蹤.

### Production read-only acceptance (2026-10-06, HEAD `df20f18`)

- **Snapshot:** schema 6 / ready / REAL / member-identity-v2; 9 members / 9 accounts; snapshot 300
  matches, `boundedMatchLimit` 300.
- **view=analytics:** `trackedMatchCount` **332** (> 300), `snapshotCoversTrackedHistory=false`.
  - Facets: 22 maps, 29 agents, 8 modes, team outcome 145/332.
  - No UUID in the context.
- **History:** started strictly before the snapshot's oldest match. One page added **32** matches beyond
  the snapshot, oldest 2026-08-14, with 0 duplicates → **332 unique browsable**.
- **Analysis:** every response was `server-analysis-v2`, `trackedMatchCount` 332, `serverHistoryUsed`
  true, `transportSnapshotUsed` false, `populationLimit` null, `populationComplete` true, 0 non-finite
  values, no leak.

  | Feature | populationMatches | Shipped matches | Size |
  |---|---|---|---|
  | lifetimeTotals / mapStats / agentStats | 332 | 0 | ~600 KB |
  | actOverview | 313 | — | — |
  | synergy | 332 (32 pairs) | — | 316 KB |
  | currentStrength + form | 117 | 117 window matches | — |
  | Profile form | 30 | — | — |
  | improvementIndex | 21 | — | — |

  Wall time was about 2.8–5.5 s per request. Weapon (all) was 200 and unchanged.
- **Browser:** desktop 1280 and mobile 375. Dashboard, Leaderboard (current/all), Profile, Compare,
  Maps (22 cards), Agents (29), Synergy (`min=310` accepted, `max=332`), Weapons, Matches (已載入 332,
  已載入全部已追蹤戰績).
  - No NaN/Infinity, no "300 場" text, no horizontal overflow, no errors.
  - Dashboard shows 「已追蹤 332 場真實對戰」 and win rate 43.7%.
- **Demo (GitHub Pages):** 0 `/api` requests; local rendering.
- **Writes:** 0 provider calls, 0 sync/bulk calls, 0 production writes, no migration.
- **DB-level integrity:** NOT VERIFIED (it would need secret access).
