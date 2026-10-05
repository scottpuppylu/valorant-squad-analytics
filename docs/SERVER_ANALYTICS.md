# Server-side context-aware analytics

TASK-DATA-03B.2B — SDD STRICT, 2026-10-05. Starting HEAD
`e1988ee3bab28788f0627923910af4e0cf489110`; checkpoint
`checkpoint-before-data-03b2b-server-analytics`. Version `server-analysis-v1`.

The newest-300 snapshot (`GET /api/valorant/dataset`, `datasetWindowSize=300`) remains the
fast bootstrap, recent display, rollback and Demo/small-data path. It is **no longer an
analytics boundary**: every analytics page asks the server for its feature's population over
**all eligible durable history** in Neon.

## Architecture

```text
browser: page filters ─► analysisQueryFor() ─► { feature, context }        (never a match count)
GET /api/valorant/dataset?view=analysis
  Phase 1 (3 parallel statements, index-driven)
    lightweight observations for every visible player-match (no event topology):
      public match id, startedAt, queue, map, agent, Act key, team rounds, duration,
      and the projection's exact basic-evidence gate (stats observed, agent, K/D/A/score/damage,
      rounds > 0, presence in every durable round)
    + active players + analytics-context facts (season/rank/duration/queue)
  ► skeleton entries ► UNCHANGED src/ engine: selectPerformances / resolveScopeSelection /
    adaptive-window-v1 (+ recentForm windows when form=1) under feature-scope-policy-v1
  Phase 2 (4 parallel statements): full projection ONLY for the selected matches (+ every adaptive
    window's entries), via the shared DatasetProjectionService.project()
  ► re-resolve with full entries swapped in (identical selection, real evidence for confidence)
  ► sanitized response: selection per player, windows, forms, selected matches only
browser: selectionFromAnalysis() ► unchanged community-score-v2 / duo-synergy-v1 / UI code
```

There is one policy engine: the server imports the same `src/analytics/scope` and
`src/analytics/filters` modules (Node-ESM safe `.js` imports). No formula, weight or gate
changed (`community-score-v2`, `community-benchmarks-v1`, `overall-profile-v1`,
`duo-synergy-v1`).

## API contract (`view=analysis`, same Vercel Function; still 12)

Query: `feature` ∈ `currentStrength | lifetimeTotals | mapStats | agentStats | actOverview |
fixedRecent | synergy`, plus context `map, agent, role, mode, player`. Optional and
feature-gated: `recent=10|30` (fixedRecent only), `act` (actOverview, synergy; public key
only), `from/to` (lifetime features and synergy; ISO dates), `form=1` (not synergy). Anything
else is a generic 400. Clients cannot request a match count; the registry decides the
population. Same public gate as the snapshot, `no-store`, 60 requests/min per IP bucket, and a
`Server-Timing` header with phase durations only.

The response carries `analysisVersion`, `scopeRuleVersion`, `featurePolicyVersion`,
`adaptiveWindowVersion` and `scoreVersion` (plus `synergyVersion` for synergy), along with
`feature`, `status` and `reasons`. It also includes:
- `coverage` {trackedMatchCount, populationComplete:true, serverHistoryUsed:true,
  transportSnapshotUsed:false, populationLimit, lifetimeComplete:false};
- `population` {anchor, floor, seasonKeys, seasonStatus, rankStatus};
- `scope`: per-player status, sample (matches/rounds/minutes/from/to/Acts), reasons, and
  windows with confidence and match-id lists;
- `selection` {publicPlayerId: publicMatchIds[]}, `forms` (recentForm current/baseline id lists);
- `evidence` and `dataset` (selected sanitized matches only).

Only public application identifiers appear. Internal UUIDs, HMACs, provider and season IDs stay
server-side (tested).

## Feature behaviour

| Feature | Server population | Bound |
|---|---|---|
| currentStrength (Dashboard, Leaderboard, Compare, Profile default) | adaptive-window-v1 per player over all history, Competitive, Act boundary | ≤ 50 matches per player (+ recentForm ≤ 10 + 30) |
| recentForm (`form=1`) | non-overlapping current + baseline; baseline may reach far past #300 | policy bounds |
| lifetimeTotals / mapStats / agentStats | all eligible tracked matches in context (全部已追蹤, never 完整生涯) | phase 2 ≤ 2000 |
| actOverview (+ map/agent) | all tracked matches tagged with the Act; unknown Act never included; partial coverage → `partial` | phase 2 ≤ 2000 |
| fixedRecent | explicit newest 10/30 per player | 30 per player |
| synergy | one PAIR context for shared and both baselines; opponents excluded | phase 2 ≤ 2000 |
| improvementIndex (TASK-PROGRESS-01, player context only) | current + strictly older baseline per player (same Act first, explicit previous-Act fallback) | ≤ 30 + 60 per player; independent of the 2000 bound |

If a LIFETIME/ACT/PAIR population exceeds 2000 matches, the newest 2000 are used and the
response says `status: partial` with `server_population_limit`. This is a disclosed bound and
never a silent one. Beyond that size, the next step is versioned server aggregates or
materialized per-match metric facts (**DATA-03B.2C**, not started; needs measured need).

## Consistency (cron mutation safety)

Statements inside each phase run in parallel; production round trips are ~240 ms, and a
single-connection transaction cost ~3 s. This is the same per-statement snapshot semantics as
the existing bootstrap. Guarantees:
- Phase 2 reads exactly the phase-1 match-id set, so it cannot loop or expand.
- Matches are deduplicated by public id.
- Only entries whose evidence phase 2 actually loaded are scored; a match that disappears
  between phases (e.g. revocation) is dropped, never scored as a skeleton (tested).
- Every request re-evaluates current consent, so no cursor or cache grants visibility.

## Browser consumption

`useScopedAnalysis(filters, {lifetimeFeature, form})` and `useSynergyDataset(context)`
(src/hooks). The provider keeps a per-tab in-memory request cache. It is cleared on every
load/refresh and never persisted, the same retention as the snapshot. It also prefetches the
default 目前實力 request in parallel with the snapshot; Dashboard and the default Leaderboard
share it.

Failure never substitutes another scope (no ACT→lifetime, no adaptive→snapshot). Loading shows
an explicit status, and an error shows 「伺服器分析暫時無法取得…不顯示替代結果」. Demo/Pages and
clients without a loader keep local analysis. Matches stays browse-only (`view=history`). The
資料範圍 disclosure states the server source and tracked count. Results do not depend on history
pages loaded, route order or browser state (tested).

## Query strategy and indexes

No migration. The first phase-1 draft joined materialized CTEs, and the planner estimated the
`vis` CTE at 1 row (its consent sub-selects collapse estimates). The result was an O(n²)
nested loop: 19–29 M rows removed by join filter at 5k matches (23–72 s in PGlite).

The shipped statement scans `source_matches ⋈ match_participants ⋈ active players` once and uses
keyed lookups on existing unique indexes:
- `rounds(source_match_id, round_number)` for round counts;
- `round_participants(round_id, match_participant_id)` for presence;
- `match_teams(source_match_id, team_key)` for the first visible participant's team, via a
  `first_value` window.

At 5k matches EXPLAIN ANALYZE drops to ~324 ms. Player+time and season lookups need no new
index at current and projected scale.

## Measurements (disposable PGlite, 4 players, varied queues/Acts/maps/agents/duos; one run)

| Durable matches | currentStrength total | phase 1 | phase 2 | selected | bytes | lifetime total (selected) |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 71 ms | 26 ms | 41 ms | 38 | 62.8 KB | 92 ms (100) |
| 300 | 105 ms | 33 ms | 64 ms | 38 | 62.8 KB | 503 ms (300) |
| 1,000 | 180 ms | 106 ms | 50 ms | 38 | 62.8 KB | 765 ms (1,000) |
| 5,000 | 724 ms | 415 ms | 171 ms | 38 | 62.8 KB | 3.06 s (2,000, partial) |
| 10,000 | 1.56–1.91 s | 0.82–1.02 s | 0.33–0.41 s | 38 | 62.8 KB | 5.35 s (2,000, partial) |

Statement count is constant (8) and there is no N+1. currentStrength phase-2 evidence is
constant at the policy bound (38 selected matches) from 100 to 10,000.

Production (183 tracked, warm, `Server-Timing`):
- Before parallelization: phase 1 ≈ 950 ms, phase 2 ≈ 1.8–2.6 s, server total ≈ 3.2–4.0 s.
- After: phase 1 ≈ 240 ms; phase 2 ≈ 1.8–1.9 s, which is the existing projection-query cost for
  ~77 matches (the snapshot itself takes ~4.3 s for 183 matches).
- Production acceptance figures are recorded below.

## Staged switchover and production acceptance — 2026-10-05

1. Stage 1 (18af719) deployed `view=analysis` with pages still on the snapshot.
2. Read-only production parity (tracked 183 ≤ 300, snapshot complete) compared the browser
   engine on the snapshot with `view=analysis` for 10 feature/context cases. Two real
   differences were found and fixed in e764d7a: ACT selection order, and confidence for
   unavailable windows computed from skeletons. Regression tests fail without the fix.
3. Parity re-run: **10/10 PASS**, covering selection, score values/status/confidence, window
   metadata and recent-form windows. Cases: current+form, lifetime, lifetime Competitive, map,
   agent, recent10, custom range, ACT E11:A5, current+map, and Synergy.
4. Stage 2 (f93c166) switched the consumers. 9abace2 added Server-Timing, f2cf03f parallelized
   the phases, and c1841b5 added the parallel default prefetch plus the request cache.
5. Post-switch parity: **10/10 PASS**. Every response reports `serverHistoryUsed:true`,
   `transportSnapshotUsed:false` and `populationComplete:true`, with no identifier/secret
   pattern and `no-store`.
6. Warm production latency (client total): 2.0–3.8 s. Server phase 1 ≈ 240 ms; phase 2
   1.4–2.7 s, which is the existing projection-query cost (the snapshot takes ~4.3 s).
   The default Leaderboard rendered in 0.8 s from the prefetch.
7. UI: Dashboard, Leaderboard (目前實力 / 全部已追蹤 / E11:A5), Compare, Profile, Maps, Agents
   and Synergy were all server-sourced; Matches stays browse-only. There were no NaN/Infinity,
   no alerts and 0 failed requests. Profile recent-form baseline 7 matches (snapshot-era 6).
   Pages Demo: local analysis and zero `/api` requests.

Tracked history (183) did not cross 300 during acceptance. The beyond-300 behaviour (adaptive,
recentForm baseline, lifetime, Act, map, agent, pair baselines) is verified on 380-match
fixtures, where the browser snapshot holds exactly 300.

SQL-level DATA-05A health checks (duplicates, orphans, contradictions, leases): **NOT
VERIFIED**. No authorized read-only database path is available in this session; the Vercel
connector exposes no database access and secrets were not read. Public invariants hold:
183 unique public match IDs and tracked count equal to the history traversal.
