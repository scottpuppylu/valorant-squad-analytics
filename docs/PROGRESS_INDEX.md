# Adaptive Improvement Index (進步指數)

TASK-PROGRESS-01 — SDD STRICT, authorized 2026-10-05. Starting HEAD
`bca4dca9a97ca5677886116b88fba0e2d4f07f6c`; checkpoint `checkpoint-before-progress-01`.
Versions: **`improvement-index-v1`** (formula) and **`improvement-benchmarks-v1`** (calibration),
policy registry **`feature-scope-policy-v2`** (v1 plus the wired `improvementIndex` entry; every
other feature is unchanged), on top of `adaptive-window-v1` and `server-analysis-v1`.

It answers 「這個玩家最近真的有進步嗎？」. It is **not** a strength score, not Riot rank/MMR/Elo,
and it never reorders the community ranking. `community-score-v2`, `community-benchmarks-v1`,
`overall-profile-v1` and `duo-synergy-v1` are unchanged.

## Four separate concepts

| Concept | Role |
|---|---|
| Performance change | **Primary** and the only component in production today |
| Rank movement | Optional future component (TASK-DATA-RANK-01); absent → unavailable, renormalized |
| Activity / sample volume | Chooses windows and confidence only. Never direction or magnitude by itself |
| Confidence | Reported separately; never multiplied into the value |

## Windows (same deterministic rules for every player)

**Current window**: adaptive-window-v1 with the `improvementIndex` policy. Competitive only. It
never crosses an Act boundary, and an unknown Act also stops it during partial coverage.
- Minimum: 5 matches, 100 rounds, 2 active days.
- Target: 200 rounds (and 10 matches, used for confidence), 4 active days.
- Maximum: 30 matches.
- Span cap 45 days once the minimum is met; lookback 90 days from the population anchor
  (never the wall clock).

Different players legitimately get different sizes, e.g. 9 matches in 4 days vs 14 matches over
40 days.

**Baseline**: starts at the next ORDER position after the current window, so it is strictly older
and exact-timestamp ties are never shared.
- Comparable sample: at least 5 matches and at least 0.8 × current rounds.
- Target: max(200, current rounds); up to 60 matches; lookback 180 days.
- It may be larger than the current window and may reach further back for low-volume players.

## Act boundary policy

1. **Same Act first.** The baseline must stay in the current window's Act.
2. **Explicit fallback.** Only if the same-Act baseline is insufficient, the resolver retries
   allowing the previous observed Act. Result: `actPolicy: previous_act_fallback`,
   `seasonCrossed: true`, reason `previous_act_fallback` + `season_crossed_in_baseline`,
   comparability × 0.7, and status at most `partial`.
3. **Unknown Act** (no Act evidence, or crossing only into unknown-season matches):
   `actPolicy: act_unknown`, comparability × 0.85, never labelled as a previous Act.

## Formula (improvement-index-v1)

1. **Performance delta (primary).** Score both windows with the unchanged community-score-v2
   engine. `rawDelta` is the overall-profile-v1-weighted mean of `current − baseline` over the
   dimensions numeric in **both** windows. When the same dimensions are available this equals
   the Overall delta exactly (same weights, same denominator), so Overall and dimensions are
   never double counted. When Overall is not numeric (production KAST/Opening evidence is
   partial), it degrades honestly to the common dimensions and reports them. Missing dimensions
   stay missing. Common-dimension weight coverage below **0.25** → `unavailable`
   (`insufficient_dimension_overlap`).
2. **Trend stability (jackknife).** Recompute the delta leaving each current match out, over the
   same dimension set. `factor = clamp(min_i(sign(Δ)·Δ₋ᵢ) / |Δ|, 0, 1)`, the worst-case share of the
   claimed change that survives dropping any single game. A one-game outlier therefore collapses
   toward 0 (`outlier_sensitive` when factor < 0.5). If fewer than 80 % of the leave-one-out runs are
   scoreable, stability is `unavailable`: it is not applied, the result is `partial`, and the
   reason is disclosed. A zero delta has factor 1.
3. **Shrinkage toward "no demonstrated change".** `rEff = rCur·rBase/(rCur+rBase)` (effective
   rounds of a difference); `shrink = rEff / (rEff + 100)`.
   `demonstratedDelta = rawDelta × shrink × trendFactor`.
4. **Signed scale.** `p = clamp(demonstratedDelta / 5, −1, 1)`; `value = 100·p`, in −100..+100.
   0 = no demonstrated change; positive = improving; negative = declining. A signed scale is
   used so nobody mistakes 50 for strength.
5. **Direction.** `|value| < 10` → `stable` (持平); otherwise `improving` / `declining`.
6. **Rank (future, optional).** Only with real `rank_observations` mean tiers inside both window
   spans: `q = clamp(rankDelta·shrink / 3 tiers, −1, 1)` and `value = 100·(0.75·p + 0.25·q)`.
   Without rank evidence the rank component is `unavailable` (`not_ingested`, or
   `no_observations_in_windows`) and the value is **performance only**. Missing rank is never 0,
   never a penalty, never a fabricated neutral observation. This is the exact contract
   TASK-DATA-RANK-01 must satisfy.

### Why volume cannot raise the value

Windows are bounded by round targets; identical play gives Δ = 0 regardless of match count
(tested at 10 and 40 matches). Shrinkage only reduces magnitude for small effective samples and
never creates a direction. More games raise confidence, not the index.

## Confidence (separate from the value)

- `sample = sqrt(min(rCur/200,1)·min(rBase/200,1))`
- `temporal` = current-window temporal confidence (activity days × freshness)
- `evidence = min(current, baseline)` share of rounds with reconstructed KAST/Opening
- `comparability = actFactor (1 / 0.85 / 0.7) × min(1, coverage / 0.75)`
- `overall = sqrt(sample·temporal) × (0.5 + 0.5·evidence) × comparability`

**Status:**
- `unavailable`: either window is insufficient or coverage < 0.25. There is no value and no
  direction.
- `partial`: a value is shown with the 部分證據 label when overall < 0.5, coverage < 0.75,
  stability is unavailable, the Act is not `same_act`, or a window is partial.
- `available`: otherwise.

## Calibration (improvement-benchmarks-v1 — product design, not population percentiles)

| Constant | Value | Why |
|---|---|---|
| performanceRange | 5 Overall points → ±100 | A sustained, shrunk 5-point gain is a large real change for this product's 0–100 dimensions |
| shrinkRounds | 100 | Two ~200-round windows (rEff 100) keep half of the raw delta; tiny samples stay near 0 |
| stableBand | 10 | Below ±0.5 demonstrated Overall points we do not claim a direction |
| minDimensionCoverage | 0.25 | A delta needs more than one minor dimension; Firepower alone (0.18) is not enough |
| fullDimensionCoverage | 0.75 | Matches overall-profile-v1's 75 % Overall gate |
| minJackknifeShare | 0.8 | Stability must be assessable on most leave-one-out runs |
| comparability | 1 / 0.85 / 0.7 | Same Act / unknown Act / explicit previous-Act fallback |
| rank weight / tierRange | 0.25 / 3 tiers | Future only; rank supports but never dominates performance |

Boundary values (±9.999 stable, ±10 directional, shrink and jackknife formulas) are unit-tested.

## Server integration and UI

`GET /api/valorant/dataset?view=analysis&feature=improvementIndex[&player=<public id>]`
- Only player context is accepted; map/agent/role/mode/act/dates/form → 400.
- The server resolves both windows over **all** durable history with the same pure resolver
  (`src/analytics/progress/windows.ts`).
- Phase 2 loads only those windows (≤ 30 + 60 matches per player): 55 matches selected from 100
  through 10,000 in fixtures. It never touches the 2000 LIFETIME/ACT/PAIR bound (DATA-03B.2C is
  deferred).
- Response `progress[]`: {playerId, actPolicy, window: current/baseline samples, match-id lists,
  boundaries, confidence, reasons}, plus `improvementVersion`.
- The browser computes the index with `computeImprovementIndex` (same engine as all other
  scores). Results match local resolution exactly in the parity tests.

**Profile** shows the 進步指數 card: signed value, direction text, status, confidence and Act
policy. 「為什麼是這個結果？」 discloses both windows (場 / 回合 / 小時 / 天 / Act), the raw and
shrunk performance change with the dimensions used, the shrink and stability factors, 排位資料
尚未取得, the confidence parts and the reasons.

- Loading and errors are explicit. There is **never** a fallback to recent10/30, the snapshot or
  lifetime.
- Demo/Pages computes locally on fictional data, with no API.
- Dashboard and Leaderboard are not changed; the ranking is never reordered by progress.

## Acceptance

Recorded in the "Production acceptance" section below after deployment.
