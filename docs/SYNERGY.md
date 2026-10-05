# Evidence-aware teammate synergy — duo-synergy-v1

Status: implementation complete; final release acceptance is recorded in TASK_SYNERGY_01_PLAN.md.
This is **descriptive association**, not causal improvement, an objectively optimal pairing,
communication-quality proof, Riot MMR/Elo or a ninth individual dimension. The existing
community-score-v2 / community-benchmarks-v1 / overall-profile-v1 engine is unchanged.

## Scope (feature-scope-policy-v1 `synergy`, PAIR)

The paired sample and both members' baselines share one explicit context selected through
`analysis-scope-v1` (`matchesInPairContext`): 全部已追蹤 or 指定 Act (public `act` URL key, only
when Act evidence exists, never guessed), plus date/map/mode. Synergy is not blindly lifetime.
The duo-synergy-v1 formula, gates and confidence are unchanged; opponents remain excluded.

## Population and same-team contract

Only current-policy public players with usable performances may enter pairs. First select an
inclusive UTC date range, map and mode. Deduplicate matches; enumerate observed same-team
members within each match. `teamGroup` is opaque A/B, stable only inside that response match;
native team keys and anonymous topology remain server-only. Unknown groups are ineligible.
Different groups are opponents, never teammates. Public pair identity is the canonical sorted
pair of public application IDs (JSON tuple), never database/provider participant identifiers.

Schema **3**, generation `dataset-read-v3`, projection `synergy-ready-projection-v1` adds optional
`teamWon`, `teamRoundsWon`, `teamRoundsLost` on each performance. Their values belong to that
player's team. Legacy MatchRecord outcome fields retain their first-visible-team compatibility
meaning; pair calculations never use that `won`. Missing team outcomes omit win-rate evidence.
Contradictory same-team outcomes are excluded. Six existing set-based queries; migration **NONE**.

## Shared sample and baselines

Shared = both visible usable members on the same known team in the selected context.
Count each match once. Shared rounds use the player's sanitized team-round totals where present,
otherwise the legacy match total. Shared wins/rate require observed per-performance outcomes.

For each member independently, baseline = usable selected-context appearances where the other
member is **absent**. Opponent appearances are excluded from both samples/baselines and counted
separately for context. Appearances with the partner present but missing/contradictory team evidence
are conservatively excluded, not mislabeled as solo. The two baseline counts can differ.

Recalculate each member's paired and baseline Overall using the unmodified community-score-v2.
If either window is unscoreable, that member's lift is absent. Both directional lifts are shown,
including when one is negative and the pair mean is positive.

KAST is round-weighted over eligible complete event-metrics-v1 observations (or explicitly supplied
legacy core observations). Require at least 70% observed selected rounds for a numeric window;
incomplete window coverage remains partial. No unknown round is scored as zero. The two member
KAST deltas must both exist. Team win rates require all sample outcomes observed.

## Formula and benchmarks

- Member Overall lift = paired Overall − own baseline Overall.
- Mutual Overall lift = mean(A lift, B lift), requiring both.
- Mutual KAST lift = mean(A paired KAST − A baseline KAST, B paired KAST − B baseline KAST).
- Baseline win-rate reference = mean(A baseline win rate, B baseline win rate).
- Win-rate lift = shared team win rate − that reference (team-outcome context, not individual value).
- Shrink factor `s = sharedMatches / (sharedMatches + 8)`; each signed delta is multiplied by s.
  Zero lift is the prior; strength 8 is a transparent product-design choice.
- Normalize `N(delta, range) = clamp(50 + 50*shrunkDelta/range, 0, 100)`.
- Registry version `duo-synergy-benchmarks-v1`: Overall range ±8 points; KAST ±.05;
  win rate ±.15. These are product calibrations, **not population percentiles**.
- Configured weights: .60 mutual Overall + .25 mutual KAST + .15 win-rate lift.
- Require both members' valid Overall windows AND at least .75 configured component weight;
  only then renormalize available weights. Missing evidence never becomes neutral 50.

## Sample gates and confidence

Numeric index requires shared >=3 and each baseline >=5. Shared 3–7 is partial. Available additionally
requires shared >=8, each baseline >=8 and all configured components available (including the reused
Overall window evidence). Partial component/window evidence keeps a numeric result partial.
Consistency's existing 10-observation complete gate can therefore keep an 8-match Overall partial.

`confidence = clamp(100*sqrt(min(shared/15,1)*min(min(baselineA,baselineB)/20,1))*availableComponentWeight,0,100)`.
Confidence stays separate; never multiply it into the index. Below sample gates, descriptive samples
and independent confidence may still display but the index has no numeric value.

## Direct pair Trade

Reuse the **same** server event-metrics-v1 retaliation classification and 5000ms window. A dies to K;
B kills K within that ordered same-round window → B traded A once. Each traded death is assigned the
earliest qualifying retaliation. A physical trade kill still counts once in individual metrics even
when it trades multiple deaths; distinct victim-directed pair edges retain the existing death semantics.
No new event version or second trade rule. Assistant-on-partner trade is not included in this v1.

The compact public per-match `synergyEvidence` has shared `ruleVersion`, `status`, `reconstructedRounds`
and `pairs` tuples `[aPerformanceIndex,bPerformanceIndex,aTradedBDeaths,bTradedADeaths]`. Indices refer
only to that match's **already public** performances, in ascending index order. They are not provider
team identifiers or internal UUIDs. An unavailable tuple has only the two indices (no fake zero counts).
The browser rejects unknown fields, out-of-range/self/repeated indices, opposite teams, malformed counts
or incomplete reconstructed tuples. IDs/coverage are expanded only in memory for analytics.

Only observed same-team visible pairs are projected, no theoretical all-pairs object. Anonymous trades
may support consenting-player KAST but never create a public pair. Missing whole-match topology omits
pair counts. When only some shared matches reconstruct, show partial counts/rate over that explicitly
reconstructed subset; no evidence yields unavailable, not zero. Complete observed no-trade evidence is
a legitimate zero. `rate = (A traded B + B traded A) / shared reconstructed rounds`.
Direct trade is supporting evidence, **not a main-index component**: no population-calibrated benchmark.

## Product, filters and trace

`#/synergy` / 搭檔分析 offers selectors, matrix, status-sorted shortlist, member details and expandable
計算依據. List order: available, partial, unavailable; numeric descending, shared count, confidence.
Missing cells say 資料不足; diagonal 不適用; two players without teammate samples show 沒有共同同隊樣本.
One player shows 至少需要兩位公開玩家才能分析搭檔. Empty REAL stays intentional REAL, never Demo fallback.
Matrix scrolls inside its region at 390px with readable button labels and non-color status text.

URL contains only public IDs and `a,b,map,mode,from,to,min`. Invalid values safely fall back; updates
write only allow-listed parameters. Date/map/mode change both paired and baseline context. The minimum
shared filter affects the shortlist, not the selected detail or sample definition. No global agent/role
filter (could remove a partner); common shared agents/roles are descriptive only. Recent10/30 is omitted
to avoid pair-window ambiguity; use an explicit date range instead.

Result/trace includes counts, each window Overall/KAST and directional delta, mutual raw/shrunk/normalized
components, configured/used weights, shrink factor, omissions, coverage and independent confidence.
No raw timeline or sensitive identifier appears. Derivation is in src/synergy, not React components.
Pair results are memory-only; no DB score/ranking persistence or browser persistent REAL cache.

## Demo and verification limits

32 deterministic fictional matches / eight players preserve 20 appearances each. Safe teams exercise
opponents, positive, near-neutral, negative and insufficient-baseline pairs. Demo trade tuples are
fictional sanitized aggregates, not claimed provider reconstructions. Production remains empty; no
Henrik request, player creation/reconnection or consent-policy change is authorized by this task.
Non-empty production Synergy: **NOT YET EXERCISED**. Fixture tests verify those paths.
