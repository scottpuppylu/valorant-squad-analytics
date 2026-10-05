# Context-aware analytics scopes

TASK-DATA-03B.2 — **Context-Aware Analytics Scope Engine** (SDD STRICT, 2026-10-05).
Starting HEAD `ddab905cddf27426ddf9b129a8a6a1d44e67e9cd`; checkpoint tag
`checkpoint-before-data-03b2-context-scope-engine`.

The earlier definition of DATA-03B.2 ("all-history analytics") is **superseded** by the
maintainer decision that different features need different analytical windows. 300 matches is
a transport / initial-snapshot optimization, never the universal analytical population.

## Two separate questions

| Question | Answered by |
|---|---|
| A. What data do we have? | All durable tracked history in Neon (DATA-05A); browsable via `view=history` (DATA-03B.1). |
| B. What data should this metric use? | `feature-scope-policy-v1` + `analysis-scope-v1` + `adaptive-window-v1` (this task). |

## Update — TASK-PROGRESS-01 (2026-10-05)

The registry is now `feature-scope-policy-v2`: the `improvementIndex` entry is wired with its
final bounds, and every other feature is unchanged. See [PROGRESS_INDEX.md](PROGRESS_INDEX.md).

## Update — TASK-DATA-03B.2B (2026-10-05)

The same engine now runs server-side over all eligible durable history (`view=analysis`,
[SERVER_ANALYTICS.md](SERVER_ANALYTICS.md)). Analytics pages use server populations;
`transport_window_truncated` remains only for local (Demo/rollback) analysis. ACT selections now
use the deterministic order of the other horizons (a parity fix; same members).

## Split

| Task | Scope | Status |
|---|---|---|
| **DATA-03B.2A** | Scope engine, policy registry, adaptive resolver, Act/rank-optional evidence, `view=analytics` facts, page wiring | **COMPLETE** |
| **DATA-03B.2B** | Server-side context-aware analytics consumption | **COMPLETE / ACCEPTED** (SERVER_ANALYTICS.md) |

DATA-03B.2B is not needed yet: production tracked history (56 matches) fits inside the
newest-300 snapshot (`snapshotCoversTrackedHistory=true`), so every scope is computed over
complete tracked evidence. When that stops being true, LIFETIME/ACT scopes report `partial` with
`transport_window_truncated`, and so do adaptive windows that run out of evidence at the
snapshot floor. They never silently mean "newest 300". DATA-03B.2B then needs its own plan
for bounded server aggregates or materialization, with measurements; see Caching below.
**All-history analytics is not claimed.**

## Architecture

```text
Neon durable evidence ──► GET /api/valorant/dataset             (schema 4 newest-300 snapshot, unchanged)
                     ├──► GET /api/valorant/dataset?view=history (browse only, DATA-03B.1)
                     └──► GET /api/valorant/dataset?view=analytics (aggregate population/evidence facts)
browser:
  snapshot + facts ─► buildAnalytics ─► ScopePopulation (anchor, floor, coverage, Act keys, rank status)
  context filters (player/map/agent/role/queue) ─► resolveScopeSelection (analysis-scope-v1)
        ├─ LIFETIME / ACT / RECENT / custom range  ─► selected entries
        └─ ADAPTIVE ─► resolveAdaptiveWindow (adaptive-window-v1, policy from the registry)
  selected entries ─► unchanged community-score-v2 / duo-synergy-v1 ─► UI + 資料範圍 disclosure
```

- One selector: `selectPerformances` → `resolveScopeSelection`; pages never pick windows.
- Map/agent/role/queue/player are orthogonal context filters, not scope kinds.
- History pages are never fed to analytics. A UI test verifies the leaderboard renders
  identically before and after the Matches page loads older pages.
- The 12-function Hobby limit is respected: `view=analytics` is a mode of the existing function.

## Versions

| Version | Meaning |
|---|---|
| `analysis-scope-v1` | Scope kinds, selection order, no cross-horizon fallback |
| `feature-scope-policy-v1` | Per-feature registry (`src/analytics/scope/policies.ts`) |
| `adaptive-window-v1` | Deterministic current/baseline resolver |
| `analytics-context-v1` | `view=analytics` aggregate facts contract |

`community-score-v2`, `community-benchmarks-v1`, `overall-profile-v1`, `event-metrics-v1`,
`duo-synergy-v1` formulas and weights are **unchanged**; only input populations are declared.

## Scope kinds

`LIFETIME` (全部已追蹤), `ACT` (指定 Act), `RECENT` (explicit 最近 N 場), `ADAPTIVE` (自適應觀察區間),
`PAIR` (搭檔情境). A custom date range is a context constraint on LIFETIME. Every result carries
`available | partial | unavailable`, explicit reasons and `fallbackUsed: false`: ACT never
becomes LIFETIME, and an unavailable adaptive window never becomes "all matches".

## Feature policy registry (feature-scope-policy-v1)

| Feature | Default scope | Sample policy | Fallback | Confidence | State |
|---|---|---|---|---|---|
| Match history | LIFETIME, all modes | none (browse, paginated) | none | n/a | wired |
| Lifetime totals | LIFETIME, all modes | descriptive | none | existing score confidence | wired |
| Agent stats | LIFETIME + agent filter | descriptive | none | matches/rounds | wired (Agents page default) |
| Map stats | LIFETIME + map filter | descriptive | none | matches/rounds | wired (Maps page default) |
| Act overview / Act agent & map | ACT (+ filters) | Act-tagged matches only | none; unavailable without Act evidence | existing score confidence | wired, **data unavailable** |
| Current ranking, eight-dimension Score, Overall, consistency, profile, compare, dashboard | ADAPTIVE `currentStrength`, Competitive | min 5 matches / 100 rounds / 2 active days; target 600 rounds (and 30 matches for confidence); max 50; span cap 60 d; lookback 120 d | extend within bounds; below minimum listed separately as 資料不足 | window confidence (sample × temporal × evidence) shown separately from the unchanged score confidence | wired |
| Recent form (近期狀態, 近期進步最多 badge) | ADAPTIVE `recentForm`, Competitive | current min 3 / 60 rounds / 2 days, target 120 rounds, max 10, span cap 21 d, lookback 60 d; baseline non-overlapping, ≥3 matches and ≥75 % of current rounds, target max(120, current rounds), lookback 180 d | extend within bounds; else 樣本不足 | both windows exposed; formula unchanged | wired (selection changed) |
| Explicit 最近 10/30 場 | RECENT fixed N per player | legacy | none | existing | wired (unchanged) |
| Trends (最近六場 chart) | RECENT fixed 6 | descriptive | none | n/a | declared |
| Synergy / pair baselines | PAIR: 全部已追蹤 or 指定 Act + date/map/mode, shared by pair sample and both baselines | duo-synergy-v1 gates unchanged | none | duo-synergy-v1 confidence | wired |
| Improvement Index (進步指數) | ADAPTIVE `improvementIndex`, Competitive; same-Act baseline first, explicit previous-Act fallback | current min 5 / 100 rounds, target 200 rounds, max 30, span 45 d; baseline ≥ 0.8× current rounds, max 60 | extend within bounds; explicit previous-Act fallback only | separate progress confidence (sample × temporal × evidence × comparability) | **wired** (feature-scope-policy-v2, PROGRESS_INDEX.md) |

Default page scopes: Dashboard, Leaderboard, Compare, Profile → 目前實力. Maps, Agents,
Matches → 全部已追蹤. Synergy → 全部已追蹤 with optional Act. Users can switch scope
explicitly. `period=all` keeps meaning 全部已追蹤, so old links keep their old meaning; the URL
default for score pages is now 目前實力.

## Evidence audit (code + production)

| Evidence | Code path | Production (`view=analytics`, 2026-10-05) |
|---|---|---|
| `source_matches.season_id` / `season_short` | **Never normalized or written** by any import/sync path (columns exist since 0001) | 0 / 56 with a public Act code (0 %), 0 with season_id only; status **unavailable** |
| `started_at` | written | 56 / 56 tracked |
| `game_length_ms` | written | 56 / 56 (100 %); status available |
| `queue_id` / `queue_name` | written; normalized by `normalizeGameMode` | Competitive 37 (66 %), Unrated 10, Swiftplay 7, Gauntlet: Glitched 1, Team Deathmatch 1; Competitive reliably separable |
| `rank_observations` | `PostgresRankRepository.recordObservation` has **no callers**; only deletion touches the table | 0 observations for visible players; status **unavailable** (`not_ingested`) |

Production values: read-only `view=analytics`, 2026-10-05, aggregate counts only. Counts are
dynamic under DATA-05A cron. Usable public performances exist for 4 of 9 public players, with
12 / 16 / 16 / 3 Competitive matches.

**Update (TASK-DATA-SEASON-01):** season is now normalized and persisted from provider
evidence; see [SEASON_EVIDENCE.md](SEASON_EVIDENCE.md) for live coverage. The table above is the
pre-task audit. At the time of this audit Act grouping was **UNAVAILABLE**. The engine and projection are ready: a
durable `season_short` normalizes to a public key (`e9a3` → `E9:A3`, `v26a1` → `V26:A1`),
`season_id` UUIDs are never exposed, and unrecognized codes stay 未分類. There is no
hardcoded Riot season calendar, and the "current official Act" is never claimed
(`currentActKnown: false`). Wording is 指定 Act / 最新有紀錄 Act, never 目前官方 Act.
Populating season evidence requires **TASK-DATA-SEASON-01**: normalize and persist
`metadata.season` from v4 payloads and backfill through existing reconciliation. That is
separately gated and not started, because it changes acquisition normalization.

Rank context is **UNAVAILABLE**: rank-aware but rank-optional. A future
**TASK-DATA-RANK-01** (rank ingestion) is separately gated and not started. No Riot API, RSO,
or new Henrik rank/MMR endpoint.

## adaptive-window-v1

Deterministic, versioned, reproducible; **not an AI decision**. Inputs are the player's
context-filtered entries, the policy, and population facts (the anchor is the newest
`playedAt` in the analytics population, never the wall clock). Ordering is `playedAt` DESC
with public match id DESC as the tie-break.

Current window: walk eligible observations (policy queues, within `maxLookbackDays` of the
anchor), newest first, and stop at the first of these:
1. `maxMatches` reached.
2. Act boundary, when Act evidence exists and the policy forbids crossing.
3. Rank-regime boundary, only with real rank evidence and once the minimum is met.
4. `maxSpanDays` exceeded, once the minimum is met.
5. Target reached: `targetRounds` AND `minMatches` AND `minActiveDays`.

If none applies, the reason is `lookback_exhausted`.

Status: `available` = target met. `partial` = minimum met, or the window was truncated by an
incomplete transport snapshot. `unavailable` = below minimum.

Baseline (policies with a baseline only): starts strictly after the current window's last
ORDER position, so ties are never shared. It walks older observations within
`baseline.maxLookbackDays` of the current window start until it holds
`max(targetRounds, currentRounds)` rounds and the minimum matches. It must reach at least
`minRoundsRatio × currentRounds` (comparable sample). A low-frequency player's baseline may
reach further back in time. Act crossing is allowed only if the policy allows it, and is
then recorded (`season_crossed_in_baseline`).

### Why match count alone is insufficient

- 30 matches in 9 days vs 30 matches over 180 days: the first reaches the 600-round target
  (available, 25 matches). The second hits the 60-day span cap at fewer matches (partial,
  lower temporal confidence).
- Long overtime games vs short games: the round target is reached with 20 × 30-round matches
  but needs 47 × 13-round matches.
- Minutes are reported (時數) and inform confidence context. Non-round queues (Team
  Deathmatch reports 168 "rounds" in production) are excluded by the Competitive policy
  rather than distorting round targets.

### Confidence (window only)

`sample = sqrt(min(matches/targetMatches,1) × min(rounds/targetRounds,1))`;
`temporal = min(activeDays/targetActiveDays,1) × freshness`, where freshness is 1 within
`freshDays` of the anchor and falls linearly to 0 at `maxLookbackDays`;
`evidence` = fraction of selected rounds with reconstructed KAST/Opening;
`overall = sqrt(sample × temporal) × (0.5 + 0.5 × evidence)`. Basic stats remain valid
without reconstructed events, so missing advanced evidence can at most halve window
confidence. An earlier geometric mean was replaced before acceptance: production KAST/Opening
evidence is partial, and it collapsed 16-match windows to 0 %. The UI shows all three components.
This window confidence is never multiplied into a score and is separate from the unchanged
community-score confidence.

### Volume is not performance

Match count, rounds and playtime choose and qualify the window and its confidence. They never
raise a score. A test shows that identical per-match play over 10 vs 40 matches gives the same
Firepower score and only higher confidence.

### Time decay

Evaluated and **not implemented** (`weighting: 'uniform'`). community-score-v2 aggregates
additive totals; recency weights would change score inputs and would require versioning the
score. Recency is expressed only through window selection and temporal confidence.

## Leaderboard fairness

The same policy version, population anchor and resolver apply to every player. Different
window sizes come only from deterministic sample rules. Players below the minimum are listed
separately (目前實力樣本不足而另列) and are not ranked with pretended certainty. Partial windows
are ranked, with their status and confidence visible in the 資料範圍 disclosure. This community
ordering is not Riot rank, MMR or Elo.

## Existing recent10 / recent30

Kept as explicit user filters (`RECENT`, unchanged legacy order). They are no longer the
concept of recent form or improvement: recent form uses `recentForm` adaptive windows.

## API

`GET /api/valorant/dataset?view=analytics` (same function, `no-store`, 30/min bucket, same
fail-closed public gate) returns `analytics-context-v1` with:
- `population`: `trackedMatchCount`, `snapshotWindow`, `snapshotCoversTrackedHistory`, `lifetimeComplete:false`
- `evidence.season`: status and counts, public Act keys/labels, `currentActKnown:false`
- `evidence.duration`, `evidence.queues`
- `evidence.rank`: status, observations count, reason
- the policy summary

Every value is an aggregate count: no player, match, season UUID, HMAC or provider ID.
`view` absent / `view=history` are unchanged. Snapshot and history matches gain an optional
`seasonKey` only when durable Act evidence exists, which is never today.

## Schema / migration / caching

No migration. No cache or materialized table: scope resolution over 10,000 lightweight
observations takes ~30–125 ms in-process, and the analytics facts are two aggregate
statements. If DATA-03B.2B later materializes aggregates, they must be derived, versioned and
non-authoritative. They must be invalidated on new durable matches, revocation/deletion, and
policy/scope/score version changes, and must never persist stale public visibility.

## Performance (local, one run; not production latency promises)

`resolveScopeSelection` over 4 synthetic players:

| Observations | current (ms) | all (ms) | recent30 (ms) | recentForm (ms) |
|---:|---:|---:|---:|---:|
| 20 | 0.11–0.13 | 0.05–0.12 | 0.03–0.04 | 0.15–0.19 |
| 100 | 0.42–0.88 | 0.23–0.24 | 0.24–0.49 | 0.74–0.94 |
| 300 | 0.82–3.23 | 0.59–1.88 | 0.27–0.36 | 0.52–0.56 |
| 1,000 | 1.39–4.78 | 2.32–3.89 | 0.45–0.66 | 0.44–1.03 |
| 10,000 | 30.9–123.1 | 31.4–57.0 | 20.7–43.9 | 1.31–2.48 |

Ranges span an isolated run and a full-suite run. `view=analytics` uses 2 SQL statements and
returns well under 2 KB. The browser never needs the full history payload. The snapshot
remains 6 statements / ≤300 matches.

## Deployment and production acceptance — 2026-10-05

Commits e05f964 (engine), 670b185 (`view=analytics`), 55ba6fb (pages), efa14ed (docs),
5168061 (window-confidence fix), then a copy/acceptance commit. GitHub CI and Pages passed;
Vercel production served the new bundle. Function count is unchanged at 12. No migration,
cron change, provider call, write, secret access or consent change.

Read-only production checks (GET only):
- `view=analytics`: 200, `no-store`, 1,890 bytes, all four versions, `trackedMatchCount` 56,
  `snapshotCoversTrackedHistory` true, `lifetimeComplete` false, the audit values above, the
  11-feature policy summary, and no UUID / 64-hex / provider / HMAC / secret pattern.
- Unchanged snapshot: schema 4 ready, no `view` field, 9 players, 56 unique matches, no
  `seasonKey` (truthful: no Act evidence). `view=history` still 56 / 56; `view=everything` 400.
- Leaderboard defaults to 目前實力 (ADAPTIVE, Competitive, partial): 3 players ranked, 1
  listed separately (3 Competitive matches / 63 rounds, below the minimum). Windows: 12 / 16 / 16
  matches, 262–349 rounds, 7.5–10.2 h, 5–28 days. Window confidence 35–37 % with
  advanced-evidence components 0–8 %, reflecting production's partial KAST/Opening evidence.
- The first deployed formula (geometric mean) showed 0 % for those windows; the fix
  (5168061) was deployed and re-verified before acceptance.
- Dashboard ranked by 目前實力 with the separate list; Profile shows 近期狀態 樣本不足 with the
  window rationale (Overall is not numeric in production). Synergy and the filter bar show
  指定 Act as disabled 「目前沒有 Act 資料」. Maps shows 全部已追蹤 · 樣本充足. Matches offers no
  adaptive scope (browse only). No NaN/Infinity.
- GitHub Pages: Demo ranked by the same engine on fictional data, zero `/api` requests, no
  console errors.
- One stale browser tab that kept pre-deploy JavaScript requested a removed lazy chunk (404)
  after the deploy. A reload fixed it. This is pre-existing SPA deployment behaviour,
  unrelated to this change.

Live concurrent cron/scope interaction is NOT VERIFIED in production (no cron write occurred
during acceptance); determinism under new matches is covered by tests O / N.

## Follow-ups (not started, separately gated)

- **TASK-DATA-SEASON-01** — persist normalized season metadata (enables ACT).
- **TASK-DATA-RANK-01** — rank observation ingestion (enables rank boundaries/rank delta).
- **TASK-PROGRESS-01** — Adaptive Improvement Index; design in [PROGRESS_INDEX.md](PROGRESS_INDEX.md).
- **DATA-03B.2B** — server aggregate consumption once tracked history exceeds the snapshot.
