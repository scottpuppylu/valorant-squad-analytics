# Evidence-aware community scoring

Versions: `community-score-v2`, `community-benchmarks-v1`, `overall-profile-v1`.
This is not Riot MMR, Elo, an official rank or a replacement for ranked matchmaking. Benchmark ranges are transparent product-design calibration, not global population percentiles. Scores are calculated in the frontend from sanitized selected evidence; never persisted in Neon. Migration: NONE.

## Input populations (feature-scope-policy-v1)

This engine's formulas, weights and gates are unchanged by TASK-DATA-03B.2A. Which matches
feed them is decided by [ANALYTICS_SCOPES.md](ANALYTICS_SCOPES.md):
- Default community ranking / Score / Overall / profile population: `currentStrength`, an
  adaptive-window-v1 recent Competitive window. Players below its minimum are listed
  separately, not ranked.
- 全部已追蹤 / 指定 Act / 最近 N 場 / 自訂日期 are explicit alternatives.
- Volume selects and qualifies samples and raises confidence; it never raises a score.
- Recent form keeps `Overall(current) - Overall(baseline)` with ±2 thresholds and numeric Overall
  in both. Its windows now come from the adaptive `recentForm` policy (non-overlapping,
  Competitive, comparable baseline) instead of newest-5 / remainder. It is not an Improvement
  Index (see PROGRESS_INDEX.md).

## Result and evidence contract

Each ScoreResult has status available/partial/unavailable; value exists only if scoreable. It carries configured/available weights, their ratio, observed weighted evidence ratio, matches/rounds/relevant events, independent confidence, versions and an aggregate trace. Missing evidence never becomes a score of 0 or 50. Measured zero is different from missing: compact omitted counters may mean zero only with a complete reconstructed/derived domain status, per METRICS_RECONSTRUCTION.md.

Scoring uses only selected performances, not cached lifetime totals. Topology-dependent evidence requires event-metrics-v1, eligibleRounds = reconstructedRounds = selected match rounds, omittedRounds = 0, and a reconstructed/derived domain status. Direct economy/objectives require an aligned eligible-round denominator and complete domain status, not complete kill topology. Economy additionally requires finite aligned numerator, positive spend and a derived ratio status. Descriptive partial counts are not implicitly scoreable. A component needs >=70% observed selected-round coverage within its role group; denominator uses only observed rows. Full selected evidence means complete, otherwise partial.

Schema-4 optional KAST/Opening changes no community-score-v2 formula, weight or gate. Descriptive KAST uses only reconstructed observations; scoring retains selected-round coverage. Consistency requires paired valid ACS/KAST observations. Basic stats and Firepower can be valid while Entry, Teamplay, Round Impact, Clutch, Consistency or Role Value lack evidence. Overall remains unavailable unless unchanged 6-of-8 and 75% gates pass; no absent score becomes 0 or 50.

A dimension needs >=70% configured component weight. Available components are renormalized only after this gate; any omitted component or incomplete observed sample means partial. Consistency additionally has sample gates below. Values stay in [0,100]; no computation is rounded. Display rounding lives in format.ts / presentation.ts.

## Normalization

N(x) = clamp(100*(x-poor)/(strong-poor),0,100). Lower-is-better ranges have poor > strong. Undefined, nonfinite input or equal endpoints produces unavailable. Raw aggregation and scoring keep full floating-point precision.

Core benchmark ranges (poor → strong), retained from the initial role calibration:

| Role | ACS | ADR | K/D | KPR | APR | KAST | FKPR |
|---|---|---|---|---|---|---|---|
| Duelist | 175→275 | 120→175 | .78→1.35 | .58→.90 | .12→.32 | .64→.80 | .08→.20 |
| Initiator | 160→235 | 112→152 | .76→1.22 | .52→.76 | .24→.50 | .67→.83 | .05→.14 |
| Controller | 150→220 | 108→146 | .76→1.22 | .50→.72 | .23→.48 | .69→.85 | .035→.11 |
| Sentinel | 155→225 | 110→150 | .80→1.30 | .52→.75 | .14→.36 | .69→.85 | .035→.12 |

New context-neutral ranges, explicitly product-design calibration:

| Metric | Poor → strong | Direction |
|---|---|---|
| FDPR | .18→.02 | lower |
| disadvantage kills / reconstructed rounds | 0→.12 | higher |
| trade kills / reconstructed rounds | 0→.15 | higher |
| clutch-state kills / reconstructed rounds | 0→.15 | higher |
| multi-kill rounds / reconstructed rounds | 0→.25 | higher |
| won-round kills / reconstructed rounds | 0→.65 | higher |
| trade assists / reconstructed rounds | 0→.10 | higher |
| plants+defuses / reconstructed rounds | 0→.15 | higher |
| shrunk clutch conversion | .08→.80 | higher |
| difficulty weighted wins / reconstructed rounds | 0→.08 | higher |
| damage / 1000 spent | 25→65 | higher |
| kills / 1000 spent | .08→.32 | higher |
| ACS CV | .40→.03 | lower |
| KAST population SD | .15→.01 | lower |

All endpoints, directions and contexts are registered in src/scoring/benchmarks.ts with the benchmark version. Future calibration must change the version and documentation/tests; never claim a global percentile without representative evidence.

## Eight dimensions

Every term below is N(raw) before component weighting.

- Firepower: .35 ACS + .30 ADR + .20 KPR + .15 KD.
- Round Impact: .25 disadvantage kills/rounds + .20 trade kills/rounds + .20 clutch-state kills/rounds + .20 multi-kill rounds/rounds + .15 won-round kills/rounds. Does not rescore raw openings separately.
- Entry: .45 FKPR + .35 inverse FDPR + .20 KPR. FK/FD is descriptive only; zero deaths or first deaths yields unavailable ratios, no pseudo denominator.
- Teamplay: .35 KAST + .25 APR + .20 trade assists/rounds + .20 trade kills/rounds. No win rate.
- Clutch: .80 shrunk conversion + .20 difficulty weighted wins/rounds. Prior mean .20 and strength 5: (wins+1)/(attempts+5). Raw conversion remains wins/attempts. 1v1–1v5 difficulty weights = 1,1.25,1.5,1.75,2. No attempts → unavailable, not neutral. Trace preserves wins, attempts, prior and conversion.
- Economy: .65 damage/1000 spent + .35 kills/1000 spent. Ratios use additive totals of the same valid positive-spend tuples, not mean of match ratios. Spend/loadout/cast volume never scores.
- Consistency: .60 inverse ACS coefficient of variation + .40 inverse KAST population SD. CV = populationSD(ACS)/mean(ACS); mean must be positive. Valid paired ACS/KAST observations only; at least 70% selected observations. <5 pairs unavailable; 5–9 partial; >=10 available if complete. A single measured zero SD cannot become a perfect score.
- Role Value: observable proxy, not full utility effectiveness. Uses actual selected agent role, not stale global player role. Cast counts are context only.

Role Value weights:

| Role | Components (%) |
|---|---|
| Duelist | FKPR30, KPR25, disadvantage/round20, trade kills/round15, KAST10 |
| Initiator | APR30, KAST25, trade assists/round25, trade kills/round10, objectives/round10 |
| Controller | KAST30, APR25, trade assists/round20, objectives/round15, damage efficiency10 |
| Sentinel | KAST30, shrunk clutch20, objectives/round20, APR15, trade assists/round15 |

Mixed-role selections group performances by actual agent role, compute raw/normalized terms per group, then multiply configured weights by that group's selected-round fraction. This is equivalent to rounds-weighting complete role-group dimension results, but the missing-weight gate is applied to the full mixed selection without fabricating unobserved groups. Traces show each component's role and role-round totals. Unknown agents do not fall back to the global profile for scoring. A dominant selected role is shown for context only. Clutch component priors are per role group; the summary prior is a descriptive aggregate of complete clutch samples.

## Overall profiles and confidence

Default weights: Firepower18%, Round Impact16%, Entry12%, Teamplay16%, Clutch10%, Economy10%, Consistency10%, Role Value8%.

Profiles are validated: version required, exactly eight known dimensions, finite nonnegative weights with positive sum; weights normalized. No settings UI required. Overall needs >=6 numeric dimensions AND >=75% configured profile weight. Numeric terms are then renormalized. All eight dimensions available → available; any omission or partial dimension → partial; otherwise no numeric Overall.

Confidence = 100*sqrt(min(matches/30,1)*min(rounds/600,1))*evidenceCoverage.
Dimension evidenceCoverage is sum(available configured component weight * observed coverage)/configured weight. Overall evidenceCoverage is the profile-weighted sum of each numeric dimension's observed ratio; missing dimensions contribute no confidence. Confidence is separate from performance and does not raise or lower score.

## Product presentation

Overall rankings: available group, partial group, unavailable last without numbered rank; full-precision sorting within numeric groups. Other metrics sort numeric values then missing rows. Partial values show configured-weight coverage; trace shows observed coverage too. Eight-axis radar fixes domain 0–100 and draws only observed vertices and edges between adjacent observed vertices: Recharts' default null-to-center polygon is intentionally replaced by GapRadarShape. Missing vertices are gaps, not zero.

Profile provides eight dimensions and reusable expandable 評分依據. Aggregate-only trace includes raw/normalized inputs, denominator, directions/endpoints, configured/used weights, status, coverage, samples and versions; no identifiers, timelines or coordinates. Recent form requires valid adaptive `recentForm` current and baseline windows (each >=3 Competitive matches; see ANALYTICS_SCOPES.md) AND numeric gated Overall in both populations. Badges require numeric score and stated samples; HS badge is independent.

Demo advanced aggregates are deterministic fictional illustration, not live provider validation or real event reconstruction. Real missing evidence remains missing. Non-empty production scoring is NOT YET EXERCISED; production intentionally remains empty after the previously approved deletion. No player reconnect, no new migration and no provider call in this task.

## Separate pair-level association

TASK-SYNERGY-01 does not change any individual engine formula above. See [SYNERGY.md](SYNERGY.md) for `duo-synergy-v1` / `duo-synergy-benchmarks-v1`.
Same selected-context teammate appearances are compared with each player's own appearances without the partner; opponents are excluded.
Both member Overall lifts must exist. Mutual Overall/KAST lift is the mean of both directional deltas.
Win-rate lift is shared per-performance team win rate minus the mean of the two baseline team win rates.
Each signed delta is shrunk by n/(n+8), then mapped around 50 using ±8 Overall / ±.05 KAST / ±.15 win rate and clamped 0–100.
Weights .60/.25/.15; numeric index requires >=75% available configured weight, shared >=3, each baseline >=5 and both Overall lifts.
Shared 3–7 is partial; available requires shared >=8, both baselines >=8 and all complete components.
Confidence = 100*sqrt(min(n/15,1)*min(min(bA,bB)/20,1))*availableWeight, independently clamped 0–100.
Missing evidence never becomes 50. Direct pair trades/observed reconstructed rounds are supporting evidence, not an index component.
These are descriptive product calibrations, not causal effects, population percentiles, official ranks or a ninth player dimension.
